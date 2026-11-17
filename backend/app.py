"""CyberGoose yerel API'si (React + Electron arayüzü için).

Tüm hatalar `{"error": str, "code"?: str}` gövdesi ve uygun HTTP durum koduyla döner.
İş mantığı `services/` ve `file_service.py` katmanlarındadır; bu modül yalnızca HTTP yönlendirme yapar.
"""
import logging
import os

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from flask_sock import Sock

import file_service as files
import os_folder
import sync_service
from config import (
    API_TOKEN,
    DROPBOX_APP_KEY,
    DROPBOX_APP_SECRET,
    FLASK_DEBUG,
    FLASK_HOST,
    FLASK_PORT,
    GOOGLE_CLIENT_SECRETS_FILE,
    ONEDRIVE_CLIENT_ID,
)
from db import DbMyFtp
from services.session_manager import CLOUD_TYPES, SERVER_TYPES, SessionManager
from services.terminal_manager import TerminalManager
from services.transfer_manager import TransferManager
from services.tunnel_manager import TunnelManager
from services.edit_watcher import EditWatcher
from config import DATA_DIR

app = Flask(__name__)
sock = Sock(app)
# Yalnızca Vite geliştirme sunucusu ve paketlenmiş Electron (file:// → "null" origin).
CORS(app, origins=["http://localhost:5175", "http://127.0.0.1:5175", "null"], allow_headers=["Content-Type", "X-CyberGoose-Token"])

db = DbMyFtp()
sessions = SessionManager()
transfers = TransferManager(sessions, relay_dir=DATA_DIR / "relay")
terminals = TerminalManager(sessions)
tunnels = TunnelManager(sessions)
external_edits = EditWatcher(transfers, DATA_DIR / "edits")
sessions.register_cleanup(terminals.close_session_terminals)
sessions.register_cleanup(tunnels.close_all)
sessions.register_cleanup(transfers.close_idle)

# Test ve geriye dönük uyumluluk için takma adlar
state = sessions.state
state_lock = sessions.lock
_close_current = sessions.close_current


def error(message, status=400, code=None, extra=None):
    body = {"error": message}
    if code:
        body["code"] = code
    if extra:
        body.update(extra)
    return jsonify(body), status


def int_field(data, key, default=None, low=None, high=None, label=None):
    """JSON gövdesinden tam sayı okur; geçersizse 400 döndürecek hata yükseltir."""
    value = data.get(key)
    if value in (None, ""):
        if default is None:
            raise files.FileServiceError(f"{label or key} gerekli", 400)
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise files.FileServiceError(f"{label or key} sayı olmalı", 400)
    if (low is not None and number < low) or (high is not None and number > high):
        raise files.FileServiceError(f"{label or key} {low}-{high} arasında olmalı", 400)
    return number


def body():
    if not request.is_json:
        return None
    return request.get_json(silent=True) or {}


@app.errorhandler(files.FileServiceError)
def handle_file_error(exc):
    if exc.status >= 500:
        app.logger.warning("%s (%s)", exc.message, exc.code)
    return error(exc.message, exc.status, exc.code, exc.extra)


@app.before_request
def require_json():
    token = request.headers.get("X-CyberGoose-Token")
    if token is None and request.path.startswith("/ws/"):
        # Tarayıcı WebSocket API'si başlık gönderemez; anahtar yalnızca WS rotalarında sorgudan kabul edilir.
        token = request.args.get("token")
    if API_TOKEN and request.method != "OPTIONS" and token != API_TOKEN:
        return error("Yetkisiz istek", 401, "unauthorized")
    if request.method in ("POST", "PUT") and not request.is_json:
        return error('İçerik tipi "application/json" olmalı', 415)
    return None


# ---------------------------------------------------------------- oturum

@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/api/session")
def session():
    return jsonify(sessions.session_info())


@app.get("/api/providers")
def providers():
    """Bulut hesaplarının ayarlanıp ayarlanmadığı (kenar çubuğunda soluk gösterilir)."""
    return jsonify({
        "dropbox": bool(DROPBOX_APP_KEY and DROPBOX_APP_SECRET),
        "googledrive": os.path.exists(GOOGLE_CLIENT_SECRETS_FILE),
        "onedrive": bool(ONEDRIVE_CLIENT_ID),
    })


@app.put("/api/session")
def update_session():
    connection_id = body().get("connectionId")
    with sessions.lock:
        if sessions.state.connection is None:
            return error("Aktif bağlantı yok", 409, "not_connected")
        sessions.state.connection_id = None if connection_id is None else str(connection_id)
    return jsonify(sessions.session_info())


def _open_connection(data):
    """İstekteki (ya da kayıtlı) bilgilerle bağlantı açar.

    Dönüş: (bağlantı, tür, bağlantı kimliği, factory) ya da hazır bir HTTP yanıtı (hata / Dropbox izni bekleniyor).
    """
    raw_type = str(data.get("type") or "").strip()
    normalized = raw_type.lower()
    connection_id = data.get("connectionId")
    host, port, username, password = data.get("host"), data.get("port"), data.get("username"), data.get("password")
    key_path = str(data.get("keyPath") or "").strip() or None
    trusted = str(data.get("trustHostKey") or "").strip() or None
    passphrase = data.get("keyPassphrase") or None
    use_agent = bool(data.get("useAgent"))

    if connection_id is not None and normalized not in CLOUD_TYPES:
        saved = db.get_connection_secret(connection_id)
        if not saved:
            return error("Kayıtlı bağlantı bulunamadı", 404)
        normalized = str(saved["type"] or "").lower()
        host, port, username = saved["host"], saved["port"], saved["username"]
        password = password or saved["password"]
        if normalized == "sftp":
            key_path = key_path or saved.get("keyPath")
            passphrase = passphrase or saved.get("passphrase")
            use_agent = use_agent or saved.get("useAgent", False)
        if not password and not (normalized == "sftp" and (key_path or use_agent)):
            return error("Bu bağlantı için parola kayıtlı değil", 400, "password_required")

    factory = None
    if normalized in SERVER_TYPES:
        conn_type = SERVER_TYPES[normalized]
        ssh = {"passphrase": passphrase, "use_agent": use_agent} if conn_type == "SFTP" else {}
        connection = sessions.connect_server(conn_type, host, port, username, password, key_path=key_path, trusted_fingerprint=trusted, **ssh)
        factory = sessions.server_factory(conn_type, host, port, username, password, key_path=key_path, **ssh)
    elif normalized == "dropbox":
        conn_type = "Dropbox"
        connection = sessions.connect_dropbox()
        if connection is None:
            return jsonify({
                "pending": True,
                "message": "Tarayıcıda Dropbox iznini verin, sonra yeniden Bağlan'a basın.",
            }), 202
    elif normalized == "googledrive":
        conn_type = "GoogleDrive"
        connection = sessions.connect_googledrive()
    elif normalized == "onedrive":
        conn_type = "OneDrive"
        connection = sessions.connect_onedrive()
    else:
        return error(f"Desteklenmeyen bağlantı türü: {raw_type or '-'}", 400)

    resolved_id = str(connection_id) if connection_id is not None else data.get("clientId")
    return connection, conn_type, resolved_id, factory


@app.post("/api/connect")
def connect():
    """Bağlantı oturum kilidi dışında kurulur: OAuth izni veya yavaş sunucu paneli kilitlemez."""
    opened = _open_connection(body())
    if not isinstance(opened, tuple) or len(opened) != 4:
        return opened
    connection, conn_type, resolved_id, factory = opened
    with sessions.lock:
        session_id = sessions.activate(connection, conn_type, resolved_id, factory=factory)
    return jsonify({"connected": True, "type": conn_type, "sessionId": session_id})


@app.post("/api/side/connect")
def side_connect():
    """Sol panel için ikinci bir uzak bağlantı (uzaktan uzağa aktarım).

    Sağ paneldeki etkin oturumu değiştirmez. Listeleme ve dosya işlemleri `sessionId` ile
    aktarım bağlantı havuzu üzerinden yapılır.
    """
    data = body()
    opened = _open_connection(data)
    if not isinstance(opened, tuple) or len(opened) != 4:
        if isinstance(opened, tuple) and len(opened) == 2 and opened[1] == 202:
            return error(
                "Dropbox izni henüz verilmemiş. Önce sağ panelden Dropbox'a bir kez bağlanıp izin verin.",
                409, "auth_required",
            )
        return opened
    connection, conn_type, resolved_id, factory = opened
    session_id = sessions.open_side(connection, conn_type, resolved_id, factory=factory)
    return jsonify({"connected": True, "type": conn_type, "sessionId": session_id})


@app.post("/api/side/disconnect")
def side_disconnect():
    data = body()
    closed = sessions.close_side(data.get("sessionId"))
    if closed:
        transfers.pool.close_session(closed)
    return jsonify({"connected": False})


@app.post("/api/disconnect")
def disconnect():
    with sessions.lock:
        sessions.close_current(forget_credentials=True)
    return jsonify({"connected": False})


# ---------------------------------------------------------------- yerel dosyalar

@app.get("/api/local/home")
def local_home():
    return jsonify({"path": files.home_directory()})


@app.get("/api/local/drives")
def local_drives():
    return jsonify({"drives": files.list_local_drives()})


@app.post("/api/local/list")
def local_list():
    return jsonify(files.list_local(body().get("path")))


@app.post("/api/local/stat")
def local_stat():
    return jsonify(files.local_stat(body().get("path")))


@app.post("/api/local/info")
def local_info():
    filepath = body().get("path")
    if not filepath:
        return error("Dosya yolu gerekli", 400)
    try:
        return jsonify(os_folder.inspect_file(filepath))
    except FileNotFoundError:
        return error("Dosya bulunamadı", 404)
    except IsADirectoryError:
        return error("Bu yol bir klasör", 400)
    except PermissionError:
        return error("Bu dosyayı okuma izniniz yok", 403)


def _text_write_args(data):
    filepath, content = data.get("path"), data.get("content")
    if not filepath or not isinstance(content, str):
        raise files.FileServiceError("Dosya yolu ve içerik gerekli", 400)
    encoding = str(data.get("encoding") or "utf-8")
    newline = "\r\n" if data.get("newline") == "\r\n" else "\n"
    return filepath, content, encoding, newline


def _sheet_write_args(data):
    filepath, sheets = data.get("path"), data.get("sheets")
    if not filepath or not isinstance(sheets, list):
        raise files.FileServiceError("Dosya yolu ve sayfa verisi gerekli", 400)
    delimiter = str(data.get("delimiter") or ",")
    encoding = str(data.get("encoding") or "utf-8")
    newline = "\r\n" if data.get("newline") == "\r\n" else "\n"
    return filepath, sheets, delimiter, encoding, newline


def _preview_response(data: bytes, mimetype: str):
    response = Response(data, mimetype=mimetype)
    # Önizleme yalnızca uygulama içinde gösterilir; tarayıcı içerik türünü tahmin etmesin.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/local/preview")
def local_preview():
    filepath = body().get("path")
    if not filepath:
        return error("Dosya yolu gerekli", 400)
    return _preview_response(*files.read_local_preview(filepath))


@app.post("/api/remote/preview")
def remote_preview():
    """Uzak resim/PDF önizlemesi; aktarım bağlantısıyla okunur, panel kilitlenmez."""
    data = body()
    if not data.get("path"):
        return error("Dosya yolu gerekli", 400)
    return _preview_response(*transfers.run_with_connection(
        data.get("sessionId"), lambda conn: files.read_remote_preview(conn, data["path"]),
    ))


@app.post("/api/local/read")
def local_read():
    filepath = body().get("path")
    if not filepath:
        return error("Dosya yolu gerekli", 400)
    return jsonify(files.read_local_text(filepath))


@app.post("/api/local/write")
def local_write():
    filepath, content, encoding, newline = _text_write_args(body())
    return jsonify(files.write_local_text(filepath, content, encoding, newline))


@app.post("/api/local/sheet/read")
def local_sheet_read():
    filepath = body().get("path")
    if not filepath:
        return error("Dosya yolu gerekli", 400)
    return jsonify(files.read_local_sheet(filepath))


@app.post("/api/local/sheet/write")
def local_sheet_write():
    filepath, sheets, delimiter, encoding, newline = _sheet_write_args(body())
    return jsonify(files.write_local_sheet(filepath, sheets, delimiter, encoding, newline))


# ---------------------------------------------------------------- uzak dosyalar

def _with_session(data, func):
    """`sessionId` verilmişse (sol paneldeki ikinci bağlantı) aktarım bağlantısıyla, yoksa paneldeki
    etkin bağlantıyla `func(conn)` çalıştırır."""
    if data.get("sessionId") not in (None, ""):
        return transfers.run_with_connection(data["sessionId"], func)
    with sessions.lock:
        return func(sessions.state.connection)


@app.post("/api/remote/list")
def remote_list():
    data = body()
    return jsonify(_with_session(data, lambda conn: files.list_remote(conn, data.get("path"))))


@app.post("/api/remote/info")
def remote_info():
    with sessions.lock:
        return jsonify(files.remote_details(sessions.state.connection, body().get("path")))


@app.post("/api/remote/chmod")
def remote_chmod():
    data = body()
    with sessions.lock:
        files.chmod_remote(sessions.state.connection, data.get("path"), data.get("mode"))
        return jsonify(files.remote_details(sessions.state.connection, data.get("path")))


@app.post("/api/remote/read")
def remote_read():
    filepath = body().get("path")
    if not filepath:
        return error("Dosya yolu gerekli", 400)
    with sessions.lock:
        return jsonify(files.read_remote_text(sessions.state.connection, filepath))


@app.post("/api/remote/write")
def remote_write():
    filepath, content, encoding, newline = _text_write_args(body())
    with sessions.lock:
        return jsonify(files.write_remote_text(sessions.state.connection, filepath, content, encoding, newline))


@app.post("/api/remote/sheet/read")
def remote_sheet_read():
    filepath = body().get("path")
    if not filepath:
        return error("Dosya yolu gerekli", 400)
    with sessions.lock:
        return jsonify(files.read_remote_sheet(sessions.state.connection, filepath))


@app.post("/api/remote/sheet/write")
def remote_sheet_write():
    filepath, sheets, delimiter, encoding, newline = _sheet_write_args(body())
    with sessions.lock:
        return jsonify(files.write_remote_sheet(sessions.state.connection, filepath, sheets, delimiter, encoding, newline))


# ---------------------------------------------------------------- aktarım ve dosya işlemleri

@app.post("/api/transfers")
def start_transfer():
    data = body()
    direction, name = data.get("direction"), data.get("name")
    if data.get("conflict") and data["conflict"] not in files.CONFLICT_POLICIES:
        return error("Çakışma kararı " + ", ".join(files.CONFLICT_POLICIES) + " olmalı", 400)
    if direction == "copy":
        # Uzaktan uzağa: kaynak oturumdan indirilip hedef oturuma yüklenir.
        source_dir, target_dir = data.get("sourceDir"), data.get("targetDir")
        if not (name and source_dir and target_dir):
            return error("Dosya adı, kaynak ve hedef klasör gerekli", 400)
        if data.get("sourceSessionId") in (None, "") or data.get("sessionId") in (None, ""):
            return error("Kaynak ve hedef oturum gerekli", 400)
        job = transfers.start_copy(
            name, source_dir, target_dir,
            source_session_id=data["sourceSessionId"], target_session_id=data["sessionId"],
            overwrite=bool(data.get("overwrite")),
            conflict=str(data["conflict"]) if data.get("conflict") else None,
        )
        return jsonify(job.to_dict()), 202
    local_dir, remote_dir = data.get("localDir"), data.get("remoteDir")
    if not (name and local_dir and remote_dir):
        return error("Dosya adı, yerel ve uzak klasör gerekli", 400)
    if direction not in ("upload", "download"):
        return error("Yön 'upload', 'download' veya 'copy' olmalı", 400)
    job = transfers.start(
        direction, name, local_dir, remote_dir,
        overwrite=bool(data.get("overwrite")),
        session_id=data.get("sessionId"),
        resume=bool(data.get("resume")),
        conflict=str(data["conflict"]) if data.get("conflict") else None,
    )
    return jsonify(job.to_dict()), 202


@app.get("/api/transfers/<job_id>")
def get_transfer(job_id):
    job = transfers.get(job_id)
    if not job:
        return error("Aktarım işi bulunamadı", 404, "job_not_found")
    return jsonify(job.to_dict())


@app.post("/api/transfers/<job_id>/cancel")
def cancel_transfer(job_id):
    job = transfers.cancel(job_id)
    if not job:
        return error("Aktarım işi bulunamadı", 404, "job_not_found")
    return jsonify(job.to_dict())


@app.post("/api/transfer/plan")
def plan_transfer():
    """Klasör aktarımı için dosya listesi. Uzak taraf aktarım bağlantısıyla gezilir; panel kilitlenmez."""
    data = body()
    side, path = data.get("side"), data.get("path")
    if not path:
        return error("Klasör yolu gerekli", 400)
    if side == "local":
        return jsonify(files.plan_local_folder(path))
    if side == "remote":
        plan = transfers.run_with_connection(data.get("sessionId"), lambda conn: files.plan_remote_folder(conn, path))
        return jsonify(plan)
    return error("Taraf 'local' veya 'remote' olmalı", 400)


@app.post("/api/compare")
def compare_folders():
    """Yerel ve uzak klasörü alt klasörleriyle karşılaştırır (eşitleme planı)."""
    data = body()
    local_path, remote_path = data.get("localPath"), data.get("remotePath")
    if not (local_path and remote_path):
        return error("Yerel ve uzak klasör gerekli", 400)
    result = sync_service.compare_folders(
        local_path,
        lambda: transfers.run_with_connection(data.get("sessionId"), lambda conn: files.plan_remote_folder(conn, remote_path)),
    )
    return jsonify(result)


@app.post("/api/search")
def search():
    """Klasörü alt klasörleriyle birlikte ada göre arar."""
    data = body()
    side, path, query = data.get("side"), data.get("path"), str(data.get("query") or "")
    if not path:
        return error("Klasör yolu gerekli", 400)
    if side == "local":
        return jsonify(sync_service.search_local(path, query))
    if side == "remote":
        return jsonify(transfers.run_with_connection(data.get("sessionId"), lambda conn: sync_service.search_remote(conn, path, query)))
    return error("Taraf 'local' veya 'remote' olmalı", 400)


@app.post("/api/archive")
def create_archive():
    data = body()
    side, parent_dir = data.get("side"), data.get("parentDir")
    names, archive_name = data.get("names") or [], str(data.get("name") or "")
    if side != "local":
        return error("Arşivleme yalnızca yerel panelde desteklenir", 400)
    if not (parent_dir and archive_name.strip()):
        return error("Klasör yolu ve arşiv adı gerekli", 400)
    return jsonify(files.create_local_zip(parent_dir, list(names), archive_name)), 201


@app.post("/api/extract")
def extract_archive():
    """Yerel zip arşivini yanındaki klasöre açar."""
    data = body()
    if data.get("side", "local") != "local":
        return error("Arşiv açma yalnızca yerel panelde desteklenir", 400)
    if not data.get("path"):
        return error("Arşiv yolu gerekli", 400)
    return jsonify(files.extract_local_zip(data["path"])), 201


@app.post("/api/mkdir")
def mkdir():
    data = body()
    side, path, name = data.get("side"), data.get("path"), str(data.get("name") or "")
    if not (path and name.strip()):
        return error("Üst klasör yolu ve yeni klasör adı gerekli", 400)
    if side == "local":
        return jsonify(files.create_local_folder(path, name)), 201
    if side == "remote":
        if data.get("sessionId") not in (None, ""):
            # Klasör aktarımı: hedef klasörler aktarımın kendi oturumunda açılır.
            created = transfers.run_with_connection(data["sessionId"], lambda conn: files.create_remote_folder(conn, path, name))
            return jsonify(created), 201
        with sessions.lock:
            return jsonify(files.create_remote_folder(sessions.state.connection, path, name)), 201
    return error("Taraf 'local' veya 'remote' olmalı", 400)


@app.post("/api/rename")
def rename():
    data = body()
    side, path, name = data.get("side"), data.get("path"), str(data.get("name") or "")
    if not (path and name.strip()):
        return error("Yol ve yeni ad gerekli", 400)
    if side == "local":
        return jsonify(files.rename_local(path, name))
    if side == "remote":
        return jsonify(_with_session(data, lambda conn: files.rename_remote(conn, path, name)))
    return error("Taraf 'local' veya 'remote' olmalı", 400)


@app.post("/api/delete")
def delete():
    data = body()
    side, path = data.get("side"), data.get("path")
    if not path:
        return error("Yol gerekli", 400)
    if side == "local":
        result = files.delete_local(path, permanent=bool(data.get("permanent")))
        return jsonify({"deleted": path, **result})
    if side == "remote":
        _with_session(data, lambda conn: files.delete_remote(conn, path))
        return jsonify({"deleted": path, "trashed": False})
    return error("Taraf 'local' veya 'remote' olmalı", 400)


# ---------------------------------------------------------------- harici düzenleyici

@app.get("/api/external-edits")
def list_external_edits():
    return jsonify(external_edits.list())


@app.post("/api/external-edits")
def open_external_edit():
    """Uzak dosyayı geçici klasöre indirir; arayüz onu varsayılan uygulamayla açar."""
    data = body()
    if not data.get("path"):
        return error("Dosya yolu gerekli", 400)
    return jsonify(external_edits.open(data.get("sessionId"), data["path"])), 201


@app.post("/api/external-edits/<edit_id>/sync")
def sync_external_edit(edit_id):
    """Kaydedilen değişikliği beklemeden hemen yükler."""
    result = external_edits.check(edit_id, settle=False)
    if result is None:
        return error("Düzenleme bulunamadı", 404)
    return jsonify(result)


@app.delete("/api/external-edits/<edit_id>")
def close_external_edit(edit_id):
    if not external_edits.close(edit_id):
        return error("Düzenleme bulunamadı", 404)
    return jsonify({"closed": edit_id})


# ---------------------------------------------------------------- kayıtlı bağlantılar

def _connection_fields(data):
    conn_type = SERVER_TYPES.get(str(data.get("type") or "").lower())
    if not conn_type:
        raise files.FileServiceError("Yalnızca FTP, FTPS ve SFTP bağlantıları kaydedilebilir", 400)
    name, host, username = (str(data.get(key) or "").strip() for key in ("name", "host", "username"))
    port = str(data.get("port") or "").strip()
    if not (name and host and port and username):
        raise files.FileServiceError("Ad, sunucu, port ve kullanıcı adı gerekli", 400)
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        raise files.FileServiceError("Port 1-65535 arasında olmalı", 400)
    # Özel anahtar yalnızca SFTP'de anlamlıdır; diğer türlerde saklanmaz.
    key_path = str(data.get("keyPath") or "").strip() if conn_type == "SFTP" else ""
    return name, conn_type, host, int(port), username, key_path or None


def _save_args(data):
    *fields, key_path = _connection_fields(data)
    group = str(data.get("group") or "").strip()[:60] or None
    sftp = fields[1] == "SFTP"
    return fields, {
        "password": data.get("password") or None,
        "key_path": key_path,
        "group": group,
        "use_agent": sftp and bool(data.get("useAgent")),
        "passphrase": (data.get("keyPassphrase") or None) if sftp and key_path else None,
    }


@app.get("/api/connections")
def list_connections():
    return jsonify(db.list_connections())


PASSWORD_NOT_SAVED = (
    "Parola Windows Kimlik Bilgisi Yöneticisi'ne kaydedilemedi. Bağlantı parolasız kaydedildi; "
    "bağlanırken parola sorulacak."
)


def _connection_response(connection_id, password_saved):
    item = next(entry for entry in db.list_connections() if entry["id"] == connection_id)
    if password_saved is False:
        item = {**item, "warning": PASSWORD_NOT_SAVED}
    return item


@app.post("/api/connections")
def create_connection():
    fields, extra = _save_args(body())
    connection_id, password_saved = db.insert_connection(*fields, **extra)
    return jsonify(_connection_response(connection_id, password_saved)), 201


@app.post("/api/connections/import/filezilla")
def import_filezilla():
    """FileZilla Site Yöneticisi dışa aktarımını (sitemanager.xml) kayıtlı bağlantılara ekler."""
    import filezilla_import

    xml_text = body().get("xml")
    if not isinstance(xml_text, str) or not xml_text.strip():
        return error("FileZilla dosyasının içeriği gerekli", 400)
    sites, warnings = filezilla_import.parse_sitemanager(xml_text)
    imported, skipped = [], []
    for site in sites:
        if db.find_connection(site["type"], site["host"], site["port"], site["username"]):
            skipped.append(site["name"])
            continue
        connection_id, password_saved = db.insert_connection(
            site["name"], site["type"], site["host"], site["port"], site["username"],
            password=site["password"], key_path=site["keyPath"], group=site["group"],
        )
        if password_saved is False:
            warnings.append(f"{site['name']}: parola Windows Kimlik Bilgileri'ne kaydedilemedi.")
        imported.append(connection_id)
    return jsonify({"imported": len(imported), "skipped": skipped, "warnings": warnings}), 201


@app.put("/api/connections/<int:connection_id>")
def update_connection(connection_id):
    fields, extra = _save_args(body())
    updated, password_saved = db.update_connection(connection_id, *fields, **extra)
    if not updated:
        return error("Kayıtlı bağlantı bulunamadı", 404)
    return jsonify(_connection_response(connection_id, password_saved))


@app.delete("/api/connections/<int:connection_id>")
def delete_connection(connection_id):
    if not db.delete_connection(connection_id):
        return error("Kayıtlı bağlantı bulunamadı", 404)
    sessions.forget_connection(connection_id)
    return jsonify({"deleted": connection_id})


# ---------------------------------------------------------------- klasör yer imleri

@app.get("/api/bookmarks")
def list_bookmarks():
    return jsonify(db.list_folder_bookmarks())


@app.post("/api/bookmarks")
def create_bookmark():
    data = body()
    name, path = str(data.get("name") or "").strip(), str(data.get("path") or "").strip()
    if not (name and path):
        return error("Ad ve yol gerekli", 400)
    connection_id = data.get("connectionId")
    bookmark_id = db.insert_folder_bookmark(name, None if connection_id in (None, "") else str(connection_id), path)
    return jsonify(next(item for item in db.list_folder_bookmarks() if item["id"] == bookmark_id)), 201


@app.delete("/api/bookmarks/<int:bookmark_id>")
def delete_bookmark(bookmark_id):
    if not db.delete_folder_bookmark(bookmark_id):
        return error("Yer imi bulunamadı", 404)
    return jsonify({"deleted": bookmark_id})


# ---------------------------------------------------------------- ssh terminal

@app.post("/api/terminal/open")
def open_terminal():
    data = body()
    term = terminals.open_from_session(cols=data.get("cols"), rows=data.get("rows"))
    return jsonify({"id": term.id}), 201


@app.post("/api/terminal/connect")
def connect_terminal():
    data = body()
    cols, rows = data.get("cols"), data.get("rows")
    connection_id = data.get("connectionId")
    host, port, username, password = data.get("host"), data.get("port") or 22, data.get("username"), data.get("password")
    key_path = str(data.get("keyPath") or "").strip() or None
    passphrase = data.get("keyPassphrase") or None
    use_agent = bool(data.get("useAgent"))
    if connection_id is not None:
        saved = db.get_connection_secret(connection_id)
        if not saved:
            return error("Kayıtlı bağlantı bulunamadı", 404)
        host, port, username = saved["host"], saved["port"], saved["username"]
        password = password or saved["password"]
        key_path = key_path or saved.get("keyPath")
        passphrase = passphrase or saved.get("passphrase")
        use_agent = use_agent or saved.get("useAgent", False)
    trusted = str(data.get("trustHostKey") or "").strip() or None
    term = terminals.open_direct(
        host, port, username, password=password, key_path=key_path, cols=cols, rows=rows, trusted_fingerprint=trusted,
        passphrase=passphrase, use_agent=use_agent,
    )
    return jsonify({"id": term.id}), 201


@app.delete("/api/terminal/<terminal_id>")
def close_terminal(terminal_id):
    if not terminals.close(terminal_id):
        return error("Terminal oturumu bulunamadı", 404)
    return jsonify({"closed": terminal_id})


@sock.route("/ws/terminal/<terminal_id>")
def terminal_ws(ws, terminal_id):
    terminals.attach_websocket(ws, terminal_id)


# ---------------------------------------------------------------- ssh tünelleri (port forwarding)

@app.get("/api/tunnels")
def list_tunnels():
    return jsonify(tunnels.list())


@app.post("/api/tunnels")
def create_tunnel():
    data = body()
    remote_host = str(data.get("remoteHost") or "").strip()
    if not remote_host:
        return error("Uzak sunucu gerekli", 400)
    local_port = int_field(data, "localPort", default=0, low=0, high=65535, label="Yerel port")
    remote_port = int_field(data, "remotePort", low=1, high=65535, label="Uzak port")
    return jsonify(tunnels.open(local_port, remote_host, remote_port)), 201


@app.delete("/api/tunnels/<tunnel_id>")
def delete_tunnel(tunnel_id):
    if not tunnels.close(tunnel_id):
        return error("Tünel bulunamadı", 404)
    return jsonify({"closed": tunnel_id})


def main():
    """Yerel API'yi çok iş parçacıklı Werkzeug sunucusuyla çalıştırır.

    waitress, WebSocket için gereken ham soketi uygulamaya vermez; terminal (flask-sock) bu
    yüzden paketli uygulamada çalışmıyordu. Sunucu yalnızca 127.0.0.1'i dinler ve her istek
    Electron'un verdiği anahtarı taşır; tek kullanıcılı yerel uygulama için yeterlidir.
    """
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    # Werkzeug istek günlüğü WebSocket adresindeki ?token= değerini ve her durum sorgusunu yazar.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    if FLASK_DEBUG:
        app.run(host=FLASK_HOST, port=FLASK_PORT, debug=True, threaded=True)
        return
    from werkzeug.serving import make_server

    server = make_server(FLASK_HOST, FLASK_PORT, app, threaded=True)
    print(f"CyberGoose API http://{FLASK_HOST}:{FLASK_PORT} adresinde çalışıyor", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
