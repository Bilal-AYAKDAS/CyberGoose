"""Denetimde bulunan hataların regresyon testleri."""
import socket
from types import SimpleNamespace


def _fake_ssh(monkeypatch, calls):
    from providers import sftp as sftp_mod

    class FakeSSH:
        def load_host_keys(self, _p):
            pass

        def set_missing_host_key_policy(self, _p):
            pass

        def connect(self, *args, **kwargs):
            calls.append(kwargs)

        def get_transport(self):
            return SimpleNamespace(set_keepalive=lambda _s: None, is_active=lambda: True)

        def open_sftp(self):
            return SimpleNamespace(close=lambda: None)

        def close(self):
            pass

    monkeypatch.setattr(sftp_mod.paramiko, "SSHClient", FakeSSH)


def test_saved_sftp_key_path_is_persisted_and_used(client, monkeypatch):
    calls = []
    _fake_ssh(monkeypatch, calls)
    created = client.post("/api/connections", json={
        "name": "Anahtarlı", "type": "SFTP", "host": "sftp.example.com", "port": "22", "username": "u",
        "keyPath": r"C:\Users\u\.ssh\id_ed25519",
    })
    assert created.status_code == 201
    body = created.get_json()
    assert body["keyPath"] == r"C:\Users\u\.ssh\id_ed25519" and body["hasPassword"] is False

    # Parola sorulmadan kayıtlı anahtarla bağlanır.
    response = client.post("/api/connect", json={"type": "SFTP", "connectionId": body["id"]})
    assert response.status_code == 200, response.get_json()
    assert calls[-1]["key_filename"] == r"C:\Users\u\.ssh\id_ed25519"

    # Tür FTP'ye çevrilince anahtar yolu atılır.
    updated = client.put(f"/api/connections/{body['id']}", json={
        "name": "Anahtarlı", "type": "FTP", "host": "h", "port": "21", "username": "u", "keyPath": "/x",
    }).get_json()
    assert updated["keyPath"] == ""
    client.delete(f"/api/connections/{body['id']}")


def test_schema_upgrade_adds_key_path(tmp_path):
    import sqlite3
    from db import SCHEMA_VERSION, DbMyFtp

    path = tmp_path / "old.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE CONNECTIONS (ID INTEGER PRIMARY KEY AUTOINCREMENT, NAME TEXT NOT NULL, TYPE TEXT NOT NULL,
                HOST TEXT NOT NULL, PORT INTEGER NOT NULL, USERNAME TEXT NOT NULL, PASSWORD TEXT);
            CREATE TABLE FOLDER_BOOKMARKS (ID INTEGER PRIMARY KEY AUTOINCREMENT, NAME TEXT NOT NULL, CONNECTION_ID INTEGER, PATH TEXT NOT NULL);
            INSERT INTO CONNECTIONS (NAME, TYPE, HOST, PORT, USERNAME) VALUES ('Eski', 'SFTP', 'h', 22, 'u');
            PRAGMA user_version = 2;
            """
        )
    store = DbMyFtp(path)
    assert store.list_connections()[0]["keyPath"] == ""
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def test_ftp_editor_read_stops_at_limit_and_keeps_connection_usable(client, ftp_server, monkeypatch):
    import file_service as files
    from tests.test_api import connect_ftp

    (ftp_server["root"] / "big.log").write_bytes(b"x" * (400 * 1024))
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    # SIZE desteklemeyen sunucu: boyut önceden bilinmez.
    monkeypatch.setattr(files, "_remote_size", lambda *_a, **_k: None)
    response = client.post("/api/remote/read", json={"path": "/big.log"})
    assert response.status_code == 400 and response.get_json()["code"] == "too_large"
    # Panel bağlantısı bozulmadı.
    listing = client.post("/api/remote/list", json={"path": "/"})
    assert listing.status_code == 200
    assert any(entry["name"] == "big.log" for entry in listing.get_json()["entries"])


def test_dropbox_pending_reopens_authorization_page(monkeypatch):
    from services.session_manager import SessionManager

    opened = []
    manager = SessionManager()
    manager.state.pending_dropbox = SimpleNamespace(dbx=None, get_access_token=lambda: opened.append(True))
    assert manager.connect_dropbox() is None
    assert opened == [True]


def test_dropbox_callback_rejects_wrong_state(monkeypatch):
    from providers import dropbox_oauth

    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "APP_KEY", "key")
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "APP_SECRET", "secret")
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "TOKEN_FILE", "/nonexistent/token.json")
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "start_server", lambda self: None)
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "get_access_token", lambda self: None)
    ops = dropbox_oauth.DropboxOperations()
    assert "state=" in ops.authorize_url()
    with ops.app.test_client() as web:
        assert web.get("/oauth2/callback?code=abc&state=sahte").status_code == 400
    assert ops.dbx is None


def test_onedrive_refreshes_token_per_request(monkeypatch, tmp_path):
    from providers import onedrive

    tokens = iter(["ilk", "yenilenmis"])

    class FakePCA:
        def __init__(self, *_a, **_k):
            pass

        def get_accounts(self):
            return [{"username": "u"}]

        def acquire_token_silent(self, *_a, **_k):
            return {"access_token": next(tokens)}

    monkeypatch.setattr(onedrive.msal, "PublicClientApplication", FakePCA)
    service = onedrive.OneDriveService(client_id="id", token_file=str(tmp_path / "t.json"))
    request = SimpleNamespace(headers={})
    service.session.auth(request)
    assert request.headers["Authorization"] == "Bearer yenilenmis"


def test_tunnel_reports_busy_port(client, monkeypatch):
    import app as backend

    transport = SimpleNamespace(is_active=lambda: True, open_channel=lambda *a, **k: None)
    with backend.state_lock:
        backend.state.connection = SimpleNamespace(client=SimpleNamespace(get_transport=lambda: transport), sftp=object())
        backend.state.type = "SFTP"
    busy = socket.socket()
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        busy.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    busy.bind(("127.0.0.1", 0))
    busy.listen(1)
    try:
        port = busy.getsockname()[1]
        response = client.post("/api/tunnels", json={"localPort": port, "remoteHost": "127.0.0.1", "remotePort": 5432})
        assert response.status_code == 409 and response.get_json()["code"] == "port_in_use"
    finally:
        busy.close()
        with backend.state_lock:
            backend.state.connection = None
            backend.state.type = None
