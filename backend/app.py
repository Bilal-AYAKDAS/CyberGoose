"""CyberGoose yerel API'si (React + Electron arayüzü için).

Tüm hatalar `{"error": str, "code"?: str}` gövdesi ve uygun HTTP durum koduyla döner.
Uzak bağlantı şimdilik süreç başına tektir (`state.connection`); oturum bazlı
ConnectionManager roadmap'te.
"""
import threading
from dataclasses import dataclass

from flask import Flask, jsonify, request
from flask_cors import CORS

import file_service as files
import os_folder
from config import API_TOKEN, FLASK_DEBUG, FLASK_HOST, FLASK_PORT
from db import DbMyFtp

app = Flask(__name__)
# Yalnızca Vite geliştirme sunucusu ve paketlenmiş Electron (file:// → "null" origin).
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173", "null"], allow_headers=["Content-Type", "X-CyberGoose-Token"])

db = DbMyFtp()

SERVER_TYPES = {"ftp": "FTP", "ftps": "FTPS", "sftp": "SFTP"}
CLOUD_TYPES = {"dropbox": "Dropbox", "googledrive": "GoogleDrive"}


@dataclass
class ConnectionState:
    connection: object = None
    type: str | None = None
    connection_id: str | None = None
    pending_dropbox: object = None


state = ConnectionState()
state_lock = threading.Lock()


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
    if API_TOKEN and request.method != "OPTIONS" and request.headers.get("X-CyberGoose-Token") != API_TOKEN:
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
    return jsonify({
        "connected": state.connection is not None,
        "type": state.type,
        "connectionId": state.connection_id,
    })


def _close_current():
    if state.connection is not None and hasattr(state.connection, "close"):
        try:
            state.connection.close()
        except Exception:
            app.logger.exception("Önceki bağlantı kapatılamadı")
    state.connection, state.type, state.connection_id = None, None, None


def _connect_server(conn_type, host, port, username, password):
    if not (host and port and username and password):
        raise files.FileServiceError("Sunucu, port, kullanıcı adı ve parola gerekli", 400, "missing_fields")
    try:
        port_number = int(port)
    except (TypeError, ValueError):
        raise files.FileServiceError("Port sayı olmalı", 400)
    if not 1 <= port_number <= 65535:
        raise files.FileServiceError("Port 1-65535 arasında olmalı", 400)
    try:
        if conn_type == "FTP":
            from providers.ftp import FTPOperations
            return FTPOperations(host, port_number, username, password)
        if conn_type == "FTPS":
            from providers.ftp import FTPOperations
            return FTPOperations(host, port_number, username, password, tls=True)
        from providers.sftp import SFTPOperations
        return SFTPOperations(host, port_number, username, password)
    except Exception as exc:
        app.logger.warning("%s bağlantısı kurulamadı: %s", conn_type, type(exc).__name__)
        raise files.FileServiceError(
            f"{host} bağlantısı kurulamadı. Sunucu, port ve parolayı kontrol edin.", 502, type(exc).__name__
        ) from exc


def _connect_dropbox():
    """Dropbox OAuth tarayıcıda tamamlanır. İzin bekleniyorsa 202 + pending döner."""
    from providers.dropbox_oauth import DropboxOperations

    pending = state.pending_dropbox
    if pending is not None and getattr(pending, "dbx", None) is not None:
        state.pending_dropbox = None
        return pending
    if pending is not None:
        return None
    try:
        connection = DropboxOperations()
    except Exception as exc:
        raise files.FileServiceError("Dropbox bağlantısı başlatılamadı. .env ayarlarını kontrol edin.", 502, type(exc).__name__) from exc
    if getattr(connection, "dbx", None) is None:
        state.pending_dropbox = connection
        return None
    return connection


@app.post("/api/connect")
def connect():
    data = body()
    raw_type = str(data.get("type") or "").strip()
    normalized = raw_type.lower()
    connection_id = data.get("connectionId")
    host, port, username, password = data.get("host"), data.get("port"), data.get("username"), data.get("password")

    if connection_id is not None and normalized not in CLOUD_TYPES:
        saved = db.get_connection_secret(connection_id)
        if not saved:
            return error("Kayıtlı bağlantı bulunamadı", 404)
        normalized = str(saved["type"] or "").lower()
        host, port, username = saved["host"], saved["port"], saved["username"]
        password = password or saved["password"]
        if not password:
            return error("Bu bağlantı için parola kayıtlı değil", 400, "password_required")

    with state_lock:
        if normalized in SERVER_TYPES:
            connection = _connect_server(SERVER_TYPES[normalized], host, port, username, password)
            conn_type = SERVER_TYPES[normalized]
        elif normalized == "dropbox":
            connection = _connect_dropbox()
            conn_type = "Dropbox"
            if connection is None:
                return jsonify({
                    "pending": True,
                    "message": "Tarayıcıda Dropbox iznini verin, sonra yeniden Bağlan'a basın.",
                }), 202
        elif normalized == "googledrive":
            try:
                from providers.google_drive import DriveService
                connection = DriveService()
            except Exception as exc:
                raise files.FileServiceError("Google Drive bağlantısı kurulamadı. credentials.json dosyasını kontrol edin.", 502, type(exc).__name__) from exc
            conn_type = "GoogleDrive"
        else:
            return error(f"Desteklenmeyen bağlantı türü: {raw_type or '-'}", 400)

        _close_current()
        state.connection, state.type = connection, conn_type
        state.connection_id = str(connection_id) if connection_id is not None else data.get("clientId")
    return jsonify({"connected": True, "type": conn_type})


@app.post("/api/disconnect")
def disconnect():
    with state_lock:
        _close_current()
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
    return jsonify(files.list_remote(state.connection, body().get("path")))


@app.post("/api/remote/info")
def remote_info():
    return jsonify(files.remote_details(state.connection, body().get("path")))


@app.post("/api/remote/chmod")
def remote_chmod():
    data = body()
    files.chmod_remote(state.connection, data.get("path"), data.get("mode"))
    return jsonify(files.remote_details(state.connection, data.get("path")))


# ---------------------------------------------------------------- aktarım ve silme

@app.post("/api/transfer")
def transfer():
    """Senkron aktarım: yanıt aktarım bitince döner. İlerleme/iptal için job API roadmap'te."""
    data = body()
    direction = data.get("direction")
    name = data.get("name")
    local_dir = data.get("localDir")
    remote_dir = data.get("remoteDir")
    overwrite = bool(data.get("overwrite"))
    if not (name and local_dir and remote_dir):
        return error("Dosya adı, yerel ve uzak klasör gerekli", 400)
    with state_lock:
        if direction == "upload":
            result = files.upload(state.connection, local_dir, name, remote_dir, overwrite)
        elif direction == "download":
            result = files.download(state.connection, remote_dir, name, local_dir, overwrite)
        else:
            return error("Yön 'upload' veya 'download' olmalı", 400)
    return jsonify(result)


@app.post("/api/delete")
def delete():
    data = body()
    side, path = data.get("side"), data.get("path")
    if not path:
        return error("Yol gerekli", 400)
    if side == "local":
        files.delete_local(path)
    elif side == "remote":
        with state_lock:
            files.delete_remote(state.connection, path)
    else:
        return error("Taraf 'local' veya 'remote' olmalı", 400)
    return jsonify({"deleted": path})


# ---------------------------------------------------------------- kayıtlı bağlantılar

def _connection_fields(data):
    conn_type = SERVER_TYPES.get(str(data.get("type") or "").lower())
    if not conn_type:
        raise files.FileServiceError("Yalnızca FTP ve SFTP bağlantıları kaydedilebilir", 400)
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
    connection_id = db.insert_connection(*_connection_fields(body()))
    created = next(item for item in db.list_connections() if item["id"] == connection_id)
    return jsonify(created), 201


@app.put("/api/connections/<int:connection_id>")
def update_connection(connection_id):
    if not db.update_connection(connection_id, *_connection_fields(body())):
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
