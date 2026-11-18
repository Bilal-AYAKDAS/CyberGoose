"""Denetim raporundaki düzeltmelerin testleri: eşzamanlılık, güvenlik ve veri bütünlüğü."""
import json
import threading
import time
from types import SimpleNamespace

import pytest

from test_api import connect_ftp, run_transfer


# ---------------------------------------------------------------- terminal WebSocket (paketli sunucu)

def test_terminal_websocket_works_on_packaged_server_and_keeps_utf8(monkeypatch):
    """Paketli uygulamanın kullandığı Werkzeug sunucusunda WebSocket açılır; bölünmüş UTF-8 bozulmaz."""
    simple_websocket = pytest.importorskip("simple_websocket")
    from werkzeug.serving import make_server

    import app as backend

    text = "çağrı ğüşıö ✓\n".encode("utf-8")
    chunks = [text[:2], text[2:3], text[3:9], text[9:]]  # "ç" ve "ğ" baytları iki okumaya bölünür

    class FakeChannel:
        def __init__(self):
            self.sent = []

        def exit_status_ready(self):
            return not chunks

        def recv_ready(self):
            return bool(chunks)

        def recv(self, _size):
            return chunks.pop(0) if chunks else b""

        def send(self, data):
            self.sent.append(data)

        def resize_pty(self, **_kw):
            pass

        def close(self):
            pass

    channel = FakeChannel()
    fake_conn = SimpleNamespace(client=SimpleNamespace(invoke_shell=lambda **_kw: channel))
    monkeypatch.setattr(backend.sessions, "state", SimpleNamespace(connection=fake_conn, type="SFTP", connection_id="1", session_id=None, pending_dropbox=None))

    server = make_server("127.0.0.1", 0, backend.app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with backend.app.test_client() as client:
            term_id = client.post("/api/terminal/open", json={"cols": 80, "rows": 24}).get_json()["id"]
        ws = simple_websocket.Client.connect(f"ws://127.0.0.1:{server.server_port}/ws/terminal/{term_id}")
        received = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            message = json.loads(ws.receive(timeout=5))
            if message["type"] == "output":
                received += message["data"]
            if message["type"] == "exit":
                break
        try:
            ws.close()
        except simple_websocket.ConnectionClosed:
            pass  # Sunucu kabuk bitince bağlantıyı zaten kapatmış olabilir.
        assert received == text.decode("utf-8")
        assert "�" not in received
    finally:
        server.shutdown()


def test_token_in_query_is_only_accepted_for_websocket_routes(client, monkeypatch):
    import app as backend

    monkeypatch.setattr(backend, "API_TOKEN", "gizli")
    assert client.get("/api/session?token=gizli").status_code == 401
    assert client.get("/api/session", headers={"X-CyberGoose-Token": "gizli"}).status_code == 200


# ---------------------------------------------------------------- aktarımlar

def test_transfer_does_not_lock_the_panel(client, ftp_server, tmp_path, monkeypatch):
    """Aktarım sürerken uzak listeleme beklemeden yanıt verir (eskiden kilit aktarım boyunca tutuluyordu)."""
    import file_service

    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    release = threading.Event()
    entered = threading.Event()
    original = file_service.download

    def slow_download(*args, **kwargs):
        entered.set()
        release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(file_service, "download", slow_download)
    started = client.post("/api/transfers", json={"direction": "download", "name": "readme.txt", "localDir": str(tmp_path), "remoteDir": "/"})
    assert started.status_code == 202
    assert entered.wait(2)

    begun = time.time()
    listing = client.post("/api/remote/list", json={"path": "/"})
    assert listing.status_code == 200
    assert time.time() - begun < 1.5
    release.set()

    job_id = started.get_json()["id"]
    for _ in range(100):
        status = client.get(f"/api/transfers/{job_id}").get_json()
        if status["status"] != "transferring":
            break
        time.sleep(0.02)
    assert status["status"] == "completed"


def test_queued_transfer_goes_to_its_own_session_after_switching(client, ftp_server, tmp_path):
    """Kullanıcı başka bağlantıya geçse de iş, eklendiği oturumun sunucusuna gider."""
    first = connect_ftp(client, ftp_server["port"]).get_json()["sessionId"]
    second = connect_ftp(client, ftp_server["port"]).get_json()["sessionId"]
    assert second != first

    (tmp_path / "eski.txt").write_text("eski oturum", encoding="utf-8")
    status = run_transfer(client, {"direction": "upload", "name": "eski.txt", "localDir": str(tmp_path), "remoteDir": "/pub", "sessionId": first})
    assert status["status"] == "completed" and status["sessionId"] == first
    assert (ftp_server["root"] / "pub" / "eski.txt").read_text(encoding="utf-8") == "eski oturum"

    unknown = client.post("/api/transfers", json={"direction": "upload", "name": "eski.txt", "localDir": str(tmp_path), "remoteDir": "/pub", "sessionId": 99999})
    assert unknown.status_code == 409 and unknown.get_json()["code"] == "session_closed"


def test_ftp_download_resumes_from_partial_file(client, ftp_server, tmp_path):
    payload = bytes(range(256)) * 400  # 100 KB
    (ftp_server["root"] / "buyuk.bin").write_bytes(payload)
    (tmp_path / "buyuk.bin.cgpart").write_bytes(payload[:40_000])

    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    status = run_transfer(client, {"direction": "download", "name": "buyuk.bin", "localDir": str(tmp_path), "remoteDir": "/", "resume": True})
    assert status["status"] == "completed"
    assert status["result"]["resumedFrom"] == 40_000
    assert (tmp_path / "buyuk.bin").read_bytes() == payload
    assert not (tmp_path / "buyuk.bin.cgpart").exists()


def test_ftp_upload_resumes_by_appending(client, ftp_server, tmp_path):
    payload = b"0123456789" * 5000
    (tmp_path / "yarim.bin").write_bytes(payload)
    (ftp_server["root"] / "pub" / "yarim.bin").write_bytes(payload[:12_345])

    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    status = run_transfer(client, {"direction": "upload", "name": "yarim.bin", "localDir": str(tmp_path), "remoteDir": "/pub", "resume": True})
    assert status["status"] == "completed" and status["result"]["resumedFrom"] == 12_345
    assert (ftp_server["root"] / "pub" / "yarim.bin").read_bytes() == payload


def test_transfer_validation_rejects_bad_direction(client):
    response = client.post("/api/transfers", json={"direction": "sideways", "name": "a", "localDir": "/", "remoteDir": "/"})
    assert response.status_code == 400


# ---------------------------------------------------------------- SFTP sunucu anahtarı

def test_unknown_sftp_host_key_requires_confirmation(client, monkeypatch, tmp_path):
    import paramiko

    from providers import sftp as sftp_mod

    server_key = paramiko.RSAKey.generate(1024)
    known_hosts = tmp_path / "known_hosts"
    monkeypatch.setattr(sftp_mod, "DATA_DIR", str(tmp_path))

    class FakeSSH:
        def __init__(self):
            self._keys = paramiko.HostKeys()
            self._policy = None

        def load_host_keys(self, path):
            self._keys.load(path)

        def set_missing_host_key_policy(self, policy):
            self._policy = policy

        def get_host_keys(self):
            return self._keys

        def connect(self, hostname, *_a, **_kw):
            if self._keys.lookup(hostname) is None:
                self._policy.missing_host_key(self, hostname, server_key)

        def get_transport(self):
            return SimpleNamespace(set_keepalive=lambda _s: None, is_active=lambda: True)

        def open_sftp(self):
            return SimpleNamespace(close=lambda: None)

        def close(self):
            pass

    monkeypatch.setattr(sftp_mod.paramiko, "SSHClient", FakeSSH)
    request = {"type": "SFTP", "host": "yeni.example.com", "port": "22", "username": "u", "password": "p"}

    first = client.post("/api/connect", json=request)
    assert first.status_code == 409
    body = first.get_json()
    assert body["code"] == "host_key_unknown"
    fingerprint = body["hostKey"]["fingerprint"]
    assert fingerprint.startswith("SHA256:") and fingerprint == sftp_mod.fingerprint(server_key)
    assert not known_hosts.exists()

    wrong = client.post("/api/connect", json={**request, "trustHostKey": "SHA256:yanlis"})
    assert wrong.status_code == 409

    accepted = client.post("/api/connect", json={**request, "trustHostKey": fingerprint})
    assert accepted.status_code == 200
    assert "yeni.example.com" in known_hosts.read_text()

    again = client.post("/api/connect", json=request)
    assert again.status_code == 200


# ---------------------------------------------------------------- silme, parola deposu, şema

def test_local_delete_goes_to_recycle_bin_by_default(client, tmp_path, monkeypatch):
    import send2trash

    trashed = []
    monkeypatch.setattr(send2trash, "send2trash", lambda path: trashed.append(path))
    target = tmp_path / "rapor.txt"
    target.write_text("x", encoding="utf-8")

    response = client.post("/api/delete", json={"side": "local", "path": str(target)})
    assert response.status_code == 200 and response.get_json()["trashed"] is True
    assert trashed == [str(target)]

    def broken(_path):
        raise OSError("çöp kutusu yok")

    monkeypatch.setattr(send2trash, "send2trash", broken)
    failed = client.post("/api/delete", json={"side": "local", "path": str(target)})
    assert failed.status_code == 409 and failed.get_json()["code"] == "trash_failed"
    assert target.exists()

    permanent = client.post("/api/delete", json={"side": "local", "path": str(target), "permanent": True})
    assert permanent.status_code == 200 and permanent.get_json()["trashed"] is False
    assert not target.exists()


def test_password_store_failure_is_reported(client, monkeypatch):
    import db as db_mod

    monkeypatch.setattr(db_mod, "_set_secret", lambda _cid, _pwd: False)
    created = client.post("/api/connections", json={
        "name": "Depo yok", "type": "SFTP", "host": "example.com", "port": "22", "username": "demo", "password": "x",
    })
    assert created.status_code == 201
    body = created.get_json()
    assert body["hasPassword"] is False
    assert "kaydedilemedi" in body["warning"]
    assert client.delete(f"/api/connections/{body['id']}").status_code == 200


def test_legacy_database_is_migrated_with_ids_preserved(tmp_path, monkeypatch):
    import sqlite3

    import db as db_mod

    vault = {}
    monkeypatch.setattr(db_mod, "_set_secret", lambda cid, pwd: vault.__setitem__(str(cid), pwd) or True)
    monkeypatch.setattr(db_mod, "_get_secret", lambda cid: vault.get(str(cid)))
    path = tmp_path / "eski.db"
    with sqlite3.connect(path) as legacy:
        legacy.executescript(
            """
            CREATE TABLE BOOKMARKS (CONNECTION_TYPE TEXT, ID INTEGER NOT NULL UNIQUE, HOSTNAME TEXT, PORT INTEGER,
                USERNAME NUMERIC, PASSWORD TEXT, CONNECTION_NAME TEXT, PRIMARY KEY(ID AUTOINCREMENT));
            INSERT INTO BOOKMARKS VALUES ('SFTP', 7, 'web-01', 22, 'deploy', 'eski-parola', 'Web');
            INSERT INTO BOOKMARKS VALUES ('FTP', 12, 'silinecek', 21, 'u', NULL, 'Silinen');
            DELETE FROM BOOKMARKS WHERE ID = 12;
            """
        )
    store = db_mod.DbMyFtp(path)
    items = store.list_connections()
    assert items == [{"id": 7, "name": "Web", "type": "SFTP", "host": "web-01", "port": "22", "username": "deploy", "hasPassword": True, "keyPath": "", "group": "", "useAgent": False, "hasPassphrase": False, "compareOffset": None}]
    assert vault["7"] == "eski-parola"
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db_mod.SCHEMA_VERSION
        assert conn.execute("SELECT PASSWORD FROM CONNECTIONS WHERE ID = 7").fetchone()[0] is None
    new_id, _ = store.insert_connection("Yeni", "FTP", "h", 21, "u")
    # Silinmiş eski kimlik (12) yeniden kullanılmaz: keyring kayıtları kimliğe bağlıdır.
    assert new_id > 12


# ---------------------------------------------------------------- uzak metin düzenleyici

def test_editor_keeps_encoding_and_line_endings(client, ftp_server):
    original = "Satır bir: çğüşıö\r\nSatır iki\r\n".encode("cp1254")
    (ftp_server["root"] / "eski.ini").write_bytes(original)
    assert connect_ftp(client, ftp_server["port"]).status_code == 200

    read = client.post("/api/remote/read", json={"path": "/eski.ini"}).get_json()
    assert read["encoding"] == "cp1254" and read["newline"] == "\r\n"
    assert read["content"] == "Satır bir: çğüşıö\nSatır iki\n"

    saved = client.post("/api/remote/write", json={
        "path": "/eski.ini", "content": read["content"] + "Satır üç\n", "encoding": read["encoding"], "newline": read["newline"],
    })
    assert saved.status_code == 200
    assert (ftp_server["root"] / "eski.ini").read_bytes() == original + "Satır üç\r\n".encode("cp1254")
    assert not (ftp_server["root"] / ".eski.ini.cgtmp").exists()


def test_editor_rejects_binary_and_large_files_before_download(client, ftp_server, monkeypatch):
    (ftp_server["root"] / "resim.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00")
    (ftp_server["root"] / "dev.log").write_bytes(b"a" * (300 * 1024))
    assert connect_ftp(client, ftp_server["port"]).status_code == 200

    binary = client.post("/api/remote/read", json={"path": "/resim.png"})
    assert binary.status_code == 415 and binary.get_json()["code"] == "binary_file"

    import app as backend
    retrieved = []
    ftp = backend.sessions.state.connection.ftp
    original = ftp.retrbinary
    monkeypatch.setattr(ftp, "retrbinary", lambda *a, **kw: retrieved.append(a[0]) or original(*a, **kw))
    large = client.post("/api/remote/read", json={"path": "/dev.log"})
    assert large.status_code == 400 and large.get_json()["code"] == "too_large"
    assert retrieved == []


# ---------------------------------------------------------------- yardımcı uç noktalar

def test_local_stat_providers_and_hidden_flag(client, tmp_path):
    (tmp_path / ".gizli").write_text("x", encoding="utf-8")
    (tmp_path / "klasor").mkdir()

    folder = client.post("/api/local/stat", json={"path": str(tmp_path / "klasor")}).get_json()
    assert folder["kind"] == "folder" and folder["parent"] == str(tmp_path)
    assert client.post("/api/local/stat", json={"path": str(tmp_path / "yok")}).status_code == 404

    entries = {e["name"]: e for e in client.post("/api/local/list", json={"path": str(tmp_path)}).get_json()["entries"]}
    assert entries[".gizli"]["hidden"] is True and entries["klasor"]["hidden"] is False

    providers = client.get("/api/providers").get_json()
    assert set(providers) == {"dropbox", "googledrive", "onedrive"}


def test_terminal_and_tunnel_reject_invalid_numbers(client):
    assert client.post("/api/terminal/open", json={"cols": "abc", "rows": 24}).status_code == 400
    assert client.post("/api/tunnels", json={"localPort": 0, "remoteHost": "db", "remotePort": "x"}).status_code == 400
    assert client.post("/api/tunnels", json={"localPort": 70000, "remoteHost": "db", "remotePort": 5432}).status_code == 400


# ---------------------------------------------------------------- inceleme düzeltmeleri

class _FakeFtp:
    """RNTO'yu var olan dosyanın üzerine reddeden FTP sunucusu taklidi."""

    def __init__(self, files, refuse_rename_over=True, refuse_all_renames=False):
        self.files = files
        self.refuse_rename_over = refuse_rename_over
        self.refuse_all_renames = refuse_all_renames

    def storbinary(self, cmd, fp):
        self.files[cmd.split(" ", 1)[1]] = fp.read()

    def rename(self, src, dst):
        import ftplib

        if self.refuse_all_renames and not dst.endswith(".cgbak") and not src.endswith(".cgbak"):
            raise ftplib.error_perm("550 rename refused")
        if self.refuse_rename_over and dst in self.files:
            raise ftplib.error_perm("550 exists")
        self.files[dst] = self.files.pop(src)

    def delete(self, name):
        self.files.pop(name)


def test_ftp_editor_save_replaces_file_without_losing_it():
    import file_service as files

    fake = _FakeFtp({"/a.txt": b"eski"})
    files._write_ftp_atomic(SimpleNamespace(ftp=fake), "/a.txt", b"yeni")
    assert fake.files == {"/a.txt": b"yeni"}


def test_ftp_editor_save_keeps_original_when_rename_is_refused():
    import ftplib

    import file_service as files

    fake = _FakeFtp({"/a.txt": b"eski"}, refuse_all_renames=True)
    with pytest.raises(ftplib.error_perm):
        files._write_ftp_atomic(SimpleNamespace(ftp=fake), "/a.txt", b"yeni")
    assert fake.files == {"/a.txt": b"eski"}


def test_cp1254_undefined_bytes_survive_an_unchanged_save():
    import file_service as files

    raw = b"ba\x81k \xe7\xfd\r\n"
    text, encoding = files._decode_text(raw)
    assert encoding == "cp1254"
    payload = json.loads(json.dumps({"content": text}))["content"]
    assert payload.encode("cp1254", errors="surrogateescape") == raw


def test_partial_and_temp_files_are_hidden():
    import file_service as files

    assert files._entry("rapor.pdf.cgpart", "file", 1, None, "/x")["hidden"] is True
    assert files._entry("rapor.pdf", "file", 1, None, "/x")["hidden"] is False


def test_switching_connections_marks_snapshot_closed_before_cleanup():
    from services.session_manager import SessionManager

    manager = SessionManager()
    seen = []
    manager.register_cleanup(lambda: seen.append(manager._snapshots[1].closed))
    manager.activate(SimpleNamespace(), "FTP", "1", factory=lambda: SimpleNamespace())
    manager.activate(SimpleNamespace(), "FTP", "2", factory=lambda: SimpleNamespace())
    assert seen[-1] is True
    # Bağlantı değişince eski işler için factory kalır; açıkça kesince parola içeren factory atılır.
    assert manager._snapshots[1].factory is not None
    manager.close_current(forget_credentials=True)
    assert manager._snapshots[2].factory is None


def test_ftp_sessions_cap_parallel_transfer_connections():
    from services.session_manager import SessionManager

    manager = SessionManager()
    sid = manager.activate(SimpleNamespace(), "FTP", "1", factory=lambda: SimpleNamespace())
    assert manager.snapshot(sid).limit is not None
    sid = manager.activate(SimpleNamespace(), "SFTP", "2", factory=lambda: SimpleNamespace())
    assert manager.snapshot(sid).limit is None
