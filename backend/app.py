"""CyberGoose yerel API'si (React + Electron arayüzü için).

Tüm hatalar `{"error": str, "code"?: str}` gövdesi ve uygun HTTP durum koduyla döner.
İş mantığı `services/` ve `file_service.py` katmanlarındadır; bu modül yalnızca HTTP yönlendirme yapar.
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock

import file_service as files
import os_folder
from config import API_TOKEN, FLASK_DEBUG, FLASK_HOST, FLASK_PORT
from db import DbMyFtp
from services.session_manager import CLOUD_TYPES, SERVER_TYPES, SessionManager
from services.terminal_manager import TerminalManager
from services.transfer_manager import TransferManager

app = Flask(__name__)
sock = Sock(app)
# Yalnızca Vite geliştirme sunucusu ve paketlenmiş Electron (file:// → "null" origin).
CORS(app, origins=["http://localhost:5175", "http://127.0.0.1:5175", "null"], allow_headers=["Content-Type", "X-CyberGoose-Token"])

db = DbMyFtp()
sessions = SessionManager()
transfers = TransferManager(sessions)
terminals = TerminalManager(sessions)

# Test ve geriye dönük uyumluluk için takma adlar
state = sessions.state
state_lock = sessions.lock
_close_current = sessions.close_current


def error(message, status=400, code=None):
    body = {"error": message}
    if code:
        body["code"] = code
    return jsonify(body), status


def body():
    if not request.is_json:
        return None
    return request.get_json(silent=True) or {}


@app.errorhandler(files.FileServiceError)
def handle_file_error(exc):
    if exc.status >= 500:
        app.logger.warning("%s (%s)", exc.message, exc.code)
    return error(exc.message, exc.status, exc.code)


@app.before_request
def require_json():
    token = request.headers.get("X-CyberGoose-Token") or request.args.get("token")
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


@app.put("/api/session")
def update_session():
    connection_id = body().get("connectionId")
    with sessions.lock:
        if sessions.state.connection is None:
            return error("Aktif bağlantı yok", 409, "not_connected")
        sessions.state.connection_id = None if connection_id is None else str(connection_id)
    return jsonify(sessions.session_info())


@app.post("/api/connect")
def connect():
    data = body()
    raw_type = str(data.get("type") or "").strip()
    normalized = raw_type.lower()
    connection_id = data.get("connectionId")
    host, port, username, password = data.get("host"), data.get("port"), data.get("username"), data.get("password")
    key_path = str(data.get("keyPath") or "").strip() or None

    if connection_id is not None and normalized not in CLOUD_TYPES:
        saved = db.get_connection_secret(connection_id)
        if not saved:
            return error("Kayıtlı bağlantı bulunamadı", 404)
        normalized = str(saved["type"] or "").lower()
        host, port, username = saved["host"], saved["port"], saved["username"]
        password = password or saved["password"]
        if not password and not (normalized == "sftp" and key_path):
            return error("Bu bağlantı için parola kayıtlı değil", 400, "password_required")

    with sessions.lock:
        if normalized in SERVER_TYPES:
            conn_type = SERVER_TYPES[normalized]
            connection = sessions.connect_server(conn_type, host, port, username, password, key_path=key_path)
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
        sessions.activate(connection, conn_type, resolved_id)
    return jsonify({"connected": True, "type": conn_type})


@app.post("/api/disconnect")
def disconnect():
    with sessions.lock:
        sessions.close_current()
    return jsonify({"connected": False})


# ---------------------------------------------------------------- yerel dosyalar

@app.get("/api/local/home")
def local_home():
    return jsonify({"path": files.home_directory()})


@app.post("/api/local/list")
def local_list():
    return jsonify(files.list_local(body().get("path")))


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


# ---------------------------------------------------------------- uzak dosyalar

@app.post("/api/remote/list")
def remote_list():
    with sessions.lock:
        return jsonify(files.list_remote(sessions.state.connection, body().get("path")))


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


# ---------------------------------------------------------------- aktarım ve dosya işlemleri

@app.post("/api/transfers")
def start_transfer():
    data = body()
    direction, name = data.get("direction"), data.get("name")
    local_dir, remote_dir = data.get("localDir"), data.get("remoteDir")
    overwrite = bool(data.get("overwrite"))
    if not (name and local_dir and remote_dir):
        return error("Dosya adı, yerel ve uzak klasör gerekli", 400)
    if direction not in ("upload", "download"):
        return error("Yön 'upload' veya 'download' olmalı", 400)
    job = transfers.start(direction, name, local_dir, remote_dir, overwrite)
    return jsonify(job.to_dict()), 202


@app.get("/api/transfers/<job_id>")
def get_transfer(job_id):
    job = transfers.get(job_id)
    if not job:
        return error("Aktarım işi bulunamadı", 404)
    return jsonify(job.to_dict())


@app.post("/api/transfers/<job_id>/cancel")
def cancel_transfer(job_id):
    job = transfers.cancel(job_id)
    if not job:
        return error("Aktarım işi bulunamadı", 404)
    return jsonify(job.to_dict())


@app.post("/api/transfer")
def transfer():
    """Senkron aktarım (geriye dönük uyumluluk)."""
    data = body()
    direction, name = data.get("direction"), data.get("name")
    local_dir, remote_dir = data.get("localDir"), data.get("remoteDir")
    overwrite = bool(data.get("overwrite"))
    if not (name and local_dir and remote_dir):
        return error("Dosya adı, yerel ve uzak klasör gerekli", 400)
    with sessions.lock:
        if direction == "upload":
            result = files.upload(sessions.state.connection, local_dir, name, remote_dir, overwrite)
        elif direction == "download":
            result = files.download(sessions.state.connection, remote_dir, name, local_dir, overwrite)
        else:
            return error("Yön 'upload' veya 'download' olmalı", 400)
    return jsonify(result)


@app.post("/api/mkdir")
def mkdir():
    data = body()
    side, path, name = data.get("side"), data.get("path"), str(data.get("name") or "")
    if not (path and name.strip()):
        return error("Üst klasör yolu ve yeni klasör adı gerekli", 400)
    if side == "local":
        return jsonify(files.create_local_folder(path, name)), 201
    if side == "remote":
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
        with sessions.lock:
            return jsonify(files.rename_remote(sessions.state.connection, path, name))
    return error("Taraf 'local' veya 'remote' olmalı", 400)


@app.post("/api/delete")
def delete():
    data = body()
    side, path = data.get("side"), data.get("path")
    if not path:
        return error("Yol gerekli", 400)
    if side == "local":
        files.delete_local(path)
    elif side == "remote":
        with sessions.lock:
            files.delete_remote(sessions.state.connection, path)
    else:
        return error("Taraf 'local' veya 'remote' olmalı", 400)
    return jsonify({"deleted": path})


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
    return name, conn_type, host, int(port), username


@app.get("/api/connections")
def list_connections():
    return jsonify(db.list_connections())


@app.post("/api/connections")
def create_connection():
    data = body()
    password = data.get("password") or None
    connection_id = db.insert_connection(*_connection_fields(data), password=password)
    created = next(item for item in db.list_connections() if item["id"] == connection_id)
    return jsonify(created), 201


@app.put("/api/connections/<int:connection_id>")
def update_connection(connection_id):
    data = body()
    password = data.get("password") or None
    if not db.update_connection(connection_id, *_connection_fields(data), password=password):
        return error("Kayıtlı bağlantı bulunamadı", 404)
    return jsonify(next(item for item in db.list_connections() if item["id"] == connection_id))


@app.delete("/api/connections/<int:connection_id>")
def delete_connection(connection_id):
    if not db.delete_connection(connection_id):
        return error("Kayıtlı bağlantı bulunamadı", 404)
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


# ---------------------------------------------------------------- ssh terminal (PuTTY benzeri)

@app.post("/api/terminal/open")
def open_terminal():
    data = body()
    cols = int(data.get("cols") or 80)
    rows = int(data.get("rows") or 24)
    term = terminals.open_from_session(cols=cols, rows=rows)
    return jsonify({"id": term.id}), 201


@app.post("/api/terminal/connect")
def connect_terminal():
    data = body()
    cols = int(data.get("cols") or 80)
    rows = int(data.get("rows") or 24)
    connection_id = data.get("connectionId")
    host, port, username, password = data.get("host"), data.get("port") or 22, data.get("username"), data.get("password")
    key_path = str(data.get("keyPath") or "").strip() or None
    if connection_id is not None:
        saved = db.get_connection_secret(connection_id)
        if not saved:
            return error("Kayıtlı bağlantı bulunamadı", 404)
        host, port, username = saved["host"], saved["port"], saved["username"]
        password = password or saved["password"]
    term = terminals.open_direct(host, port, username, password=password, key_path=key_path, cols=cols, rows=rows)
    return jsonify({"id": term.id}), 201


@app.delete("/api/terminal/<terminal_id>")
def close_terminal(terminal_id):
    if not terminals.close(terminal_id):
        return error("Terminal oturumu bulunamadı", 404)
    return jsonify({"closed": terminal_id})


@sock.route("/ws/terminal/<terminal_id>")
def terminal_ws(ws, terminal_id):
    terminals.attach_websocket(ws, terminal_id)


def main():
    """Geliştirmede Flask sunucusu (debug), paketlenmiş uygulamada waitress kullanılır."""
    if FLASK_DEBUG:
        app.run(host=FLASK_HOST, port=FLASK_PORT, debug=True)
        return
    from waitress import serve

    print(f"CyberGoose API http://{FLASK_HOST}:{FLASK_PORT} adresinde çalışıyor", flush=True)
    serve(app, host=FLASK_HOST, port=FLASK_PORT, threads=8, ident="CyberGoose")


if __name__ == "__main__":
    main()
