"""Yerel API testleri. FTP testleri gerçek bir pyftpdlib sunucusuna bağlanır."""


def connect_ftp(client, port, password="password"):
    return client.post("/api/connect", json={
        "type": "FTP", "host": "127.0.0.1", "port": str(port), "username": "demo", "password": password,
    })


def test_health(client):
    assert client.get("/api/health").get_json() == {"ok": True}


def test_rejects_non_json_posts(client):
    response = client.post("/api/local/list", data="x")
    assert response.status_code == 415


def test_token_is_required_when_configured(client, monkeypatch):
    import app as backend

    monkeypatch.setattr(backend, "API_TOKEN", "gizli-anahtar")
    assert client.get("/api/health").status_code == 401
    assert client.get("/api/health", headers={"X-CyberGoose-Token": "gizli-anahtar"}).status_code == 200


def test_lists_a_real_local_folder(client, tmp_path):
    (tmp_path / "klasor").mkdir()
    (tmp_path / "rapor.txt").write_text("selam", encoding="utf-8")
    listing = client.post("/api/local/list", json={"path": str(tmp_path)}).get_json()
    names = {entry["name"]: entry for entry in listing["entries"]}
    assert names["klasor"]["kind"] == "folder"
    assert names["rapor.txt"]["kind"] == "file" and names["rapor.txt"]["size"] == 5
    assert listing["parent"] is not None


def test_local_errors_are_reported(client, tmp_path):
    response = client.post("/api/local/list", json={"path": str(tmp_path / "yok")})
    assert response.status_code == 404
    assert "error" in response.get_json()
    info = client.post("/api/local/info", json={"path": str(tmp_path / "yok.txt")})
    assert info.status_code == 404


def test_local_info_has_hash_and_preview(client, tmp_path):
    target = tmp_path / "not.txt"
    target.write_text("merhaba", encoding="utf-8")
    info = client.post("/api/local/info", json={"path": str(target)}).get_json()
    assert info["preview"] == "merhaba"
    assert len(info["sha256"]) == 64


def test_remote_list_without_connection_is_an_error(client):
    response = client.post("/api/remote/list", json={"path": "/"})
    assert response.status_code >= 400
    assert response.get_json()["error"]


def test_saved_connections_never_return_passwords(client):
    created = client.post("/api/connections", json={
        "name": "Rebex", "type": "SFTP", "host": "test.rebex.net", "port": "22", "username": "demo",
    })
    assert created.status_code == 201
    body = created.get_json()
    assert body["hasPassword"] is False and "password" not in body
    listed = client.get("/api/connections").get_json()
    assert all("password" not in item for item in listed)
    assert client.delete(f"/api/connections/{body['id']}").status_code == 200


def test_saved_connection_without_password_asks_for_one(client):
    created = client.post("/api/connections", json={
        "name": "Parolasız", "type": "FTP", "host": "127.0.0.1", "port": "21", "username": "demo",
    }).get_json()
    response = client.post("/api/connect", json={"type": "FTP", "connectionId": created["id"]})
    assert response.status_code == 400
    assert response.get_json()["code"] == "password_required"


def test_bookmarks_crud(client, tmp_path):
    created = client.post("/api/bookmarks", json={"name": "Proje", "path": str(tmp_path), "connectionId": None})
    assert created.status_code == 201
    bookmark = created.get_json()
    assert any(item["id"] == bookmark["id"] for item in client.get("/api/bookmarks").get_json())
    assert client.delete(f"/api/bookmarks/{bookmark['id']}").status_code == 200
    assert client.delete(f"/api/bookmarks/{bookmark['id']}").status_code == 404


def test_wrong_ftp_password_returns_a_real_error(client, ftp_server):
    response = connect_ftp(client, ftp_server["port"], password="yanlis")
    assert response.status_code == 502
    assert "bağlantısı kurulamadı" in response.get_json()["error"]


def test_ftp_list_upload_download_delete(client, ftp_server, tmp_path):
    assert connect_ftp(client, ftp_server["port"]).get_json() == {"connected": True, "type": "FTP"}

    listing = client.post("/api/remote/list", json={"path": "/"}).get_json()
    names = {entry["name"]: entry["kind"] for entry in listing["entries"]}
    assert names == {"pub": "folder", "readme.txt": "file"}

    local_dir = tmp_path / "yerel"
    local_dir.mkdir()
    download = {"direction": "download", "name": "readme.txt", "localDir": str(local_dir), "remoteDir": "/"}
    assert client.post("/api/transfer", json=download).status_code == 200
    assert (local_dir / "readme.txt").read_text(encoding="utf-8") == "Merhaba FTP\n"

    again = client.post("/api/transfer", json=download)
    assert again.status_code == 409 and again.get_json()["code"] == "exists"
    assert client.post("/api/transfer", json={**download, "overwrite": True}).status_code == 200

    (local_dir / "yeni.txt").write_text("yukle", encoding="utf-8")
    upload = {"direction": "upload", "name": "yeni.txt", "localDir": str(local_dir), "remoteDir": "/pub"}
    assert client.post("/api/transfer", json=upload).status_code == 200
    assert (ftp_server["root"] / "pub" / "yeni.txt").read_text(encoding="utf-8") == "yukle"

    assert client.post("/api/delete", json={"side": "remote", "path": "/pub/yeni.txt"}).status_code == 200
    assert not (ftp_server["root"] / "pub" / "yeni.txt").exists()

    assert client.post("/api/disconnect", json={}).get_json() == {"connected": False}
    assert client.get("/api/session").get_json()["connected"] is False


def test_put_session_updates_connection_id(client, ftp_server):
    assert client.put("/api/session", json={"connectionId": "5"}).status_code == 409
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    updated = client.put("/api/session", json={"connectionId": "42"})
    assert updated.status_code == 200
    assert updated.get_json() == {"connected": True, "type": "FTP", "connectionId": "42"}


def test_dropbox_expired_token_falls_back_to_oauth(tmp_path, monkeypatch):
    from dropbox.exceptions import AuthError
    from providers import dropbox_oauth

    token_file = tmp_path / "dropboxtoken.json"
    token_file.write_text('{"access_token": "stale", "refresh_token": null}', encoding="utf-8")

    class FakeDbx:
        def users_get_current_account(self):
            raise AuthError("req-1", "expired_access_token")

    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "TOKEN_FILE", str(token_file))
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "APP_KEY", "key")
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "APP_SECRET", "secret")
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "_client", lambda self: FakeDbx())
    started = {"server": False, "browser": False}
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "start_server", lambda self: started.__setitem__("server", True))
    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "get_access_token", lambda self: started.__setitem__("browser", True))

    op = dropbox_oauth.DropboxOperations()
    assert op.dbx is None
    assert not token_file.exists()
    assert started == {"server": True, "browser": True}


def test_google_drive_refresh_error_reauthenticates(tmp_path, monkeypatch):
    from google.auth.exceptions import RefreshError
    from providers import google_drive

    secrets_file = tmp_path / "credentials.json"
    secrets_file.write_text("{}", encoding="utf-8")
    token_file = tmp_path / "token.json"
    token_file.write_text("{}", encoding="utf-8")

    class StaleCreds:
        valid = False
        expired = True
        refresh_token = "old-refresh"

        def refresh(self, _request):
            raise RefreshError("Token has been expired or revoked.")

    class FreshCreds:
        valid = True

        def to_json(self):
            return '{"token": "fresh"}'

    class FakeFlow:
        def run_local_server(self, port=0):
            return FreshCreds()

    monkeypatch.setattr(google_drive.Credentials, "from_authorized_user_file", lambda *_a, **_kw: StaleCreds())
    monkeypatch.setattr(google_drive.InstalledAppFlow, "from_client_secrets_file", lambda *_a, **_kw: FakeFlow())
    monkeypatch.setattr(google_drive, "build", lambda *_a, **_kw: "fake-drive-service")

    drive = google_drive.DriveService(client_secrets_file=str(secrets_file), token_file=str(token_file))
    assert drive.service == "fake-drive-service"
    assert token_file.read_text(encoding="utf-8") == '{"token": "fresh"}'


def test_google_workspace_file_download_returns_400(tmp_path, monkeypatch):
    import pytest
    import file_service

    class FakeConn:
        service = object()

    monkeypatch.setattr(file_service, "_drive_resolve_folder", lambda _s, _p: "root")
    monkeypatch.setattr(
        file_service,
        "_drive_find_file",
        lambda _s, _f, _n: {"id": "doc-1", "mimeType": "application/vnd.google-apps.document"},
    )

    with pytest.raises(file_service.FileServiceError) as exc:
        file_service.download(FakeConn(), "/", "Notlar", str(tmp_path))
    assert exc.value.status == 400
    assert exc.value.code == "google_workspace_file"


def test_connection_password_stored_in_keyring_not_sqlite(client, monkeypatch):
    import db as db_mod

    vault = {}
    monkeypatch.setattr(db_mod, "_set_secret", lambda cid, pwd: vault.__setitem__(str(cid), pwd) or True)
    monkeypatch.setattr(db_mod, "_get_secret", lambda cid: vault.get(str(cid)))
    monkeypatch.setattr(db_mod, "_delete_secret", lambda cid: vault.pop(str(cid), None))

    created = client.post("/api/connections", json={
        "name": "Gizli", "type": "SFTP", "host": "example.com", "port": "22", "username": "demo", "password": "s3cr3t",
    })
    assert created.status_code == 201
    body = created.get_json()
    assert body["hasPassword"] is True
    assert "password" not in body
    assert vault[str(body["id"])] == "s3cr3t"

    import app as backend
    secret = backend.db.get_connection_secret(body["id"])
    assert secret["password"] == "s3cr3t"
    with backend.db._connect() as conn:
        raw = conn.execute("SELECT PASSWORD FROM BOOKMARKS WHERE ID = ?", (body["id"],)).fetchone()
    assert raw[0] is None

    assert client.delete(f"/api/connections/{body['id']}").status_code == 200
    assert str(body["id"]) not in vault


def test_local_and_ftp_mkdir_rename_and_folder_delete(client, ftp_server, tmp_path):
    # Yerel klasör oluşturma, yeniden adlandırma ve özyinelemeli silme
    assert client.post("/api/mkdir", json={"side": "local", "path": str(tmp_path), "name": "deneme"}).status_code == 201
    assert (tmp_path / "deneme").is_dir()
    (tmp_path / "deneme" / "ic.txt").write_text("1", encoding="utf-8")
    assert client.post("/api/rename", json={"side": "local", "path": str(tmp_path / "deneme"), "name": "yeni_ad"}).status_code == 200
    assert (tmp_path / "yeni_ad" / "ic.txt").is_file()
    assert client.post("/api/delete", json={"side": "local", "path": str(tmp_path / "yeni_ad")}).status_code == 200
    assert not (tmp_path / "yeni_ad").exists()

    # Uzak FTP klasör oluşturma, yeniden adlandırma ve özyinelemeli silme
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    assert client.post("/api/mkdir", json={"side": "remote", "path": "/", "name": "alt"}).status_code == 201
    assert (ftp_server["root"] / "alt").is_dir()
    (ftp_server["root"] / "alt" / "dosya.txt").write_text("ftp", encoding="utf-8")
    assert client.post("/api/rename", json={"side": "remote", "path": "/alt", "name": "alt2"}).status_code == 200
    assert (ftp_server["root"] / "alt2" / "dosya.txt").is_file()
    assert client.post("/api/delete", json={"side": "remote", "path": "/alt2"}).status_code == 200
    assert not (ftp_server["root"] / "alt2").exists()


def test_async_transfer_job_and_cancel(client, ftp_server, tmp_path):
    import time

    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    local_dir = tmp_path / "async_dl"
    local_dir.mkdir()
    started = client.post("/api/transfers", json={
        "direction": "download", "name": "readme.txt", "localDir": str(local_dir), "remoteDir": "/",
    })
    assert started.status_code == 202
    job_id = started.get_json()["id"]

    status = None
    for _ in range(30):
        status = client.get(f"/api/transfers/{job_id}").get_json()
        if status["status"] != "transferring":
            break
        time.sleep(0.05)
    assert status["status"] == "completed"
    assert (local_dir / "readme.txt").read_text(encoding="utf-8") == "Merhaba FTP\n"
    assert status["transferred"] == (local_dir / "readme.txt").stat().st_size

    cancelled = client.post(f"/api/transfers/{job_id}/cancel", json={})
    assert cancelled.status_code == 200


def test_local_info_rejects_directory(client, tmp_path):
    response = client.post("/api/local/info", json={"path": str(tmp_path)})
    assert response.status_code == 400


def test_ftps_connect_uses_tls_and_utf8(client, monkeypatch):
    from providers import ftp as ftp_mod

    calls = []

    class FakeFTP:
        def __init__(self, timeout=20):
            self.encoding = None

        def connect(self, host, port):
            calls.append(("connect", host, port))

        def login(self, user, pwd):
            calls.append(("login", user, pwd))

        def prot_p(self):
            calls.append(("prot_p",))

        def quit(self):
            calls.append(("quit",))

    monkeypatch.setattr(ftp_mod, "FTP_TLS", FakeFTP)
    resp = client.post("/api/connect", json={"type": "FTPS", "host": "ftps.example.com", "port": "21", "username": "u", "password": "p"})
    assert resp.status_code == 200
    assert resp.get_json() == {"connected": True, "type": "FTPS"}
    assert ("prot_p",) in calls


def test_sftp_connect_and_chmod_and_details(client, monkeypatch):
    import stat as stat_mod
    from types import SimpleNamespace
    from providers import sftp as sftp_mod

    chmod_calls = []

    class FakeSFTP:
        def stat(self, _path):
            return SimpleNamespace(st_mode=stat_mod.S_IFREG | 0o644)

        def chmod(self, path, mode):
            chmod_calls.append((path, oct(mode)))

        def close(self):
            pass

    class FakeTransport:
        def set_keepalive(self, _sec):
            pass

    class FakeSSH:
        def load_host_keys(self, _p):
            pass

        def set_missing_host_key_policy(self, _p):
            pass

        def connect(self, *a, **kw):
            pass

        def get_transport(self):
            return FakeTransport()

        def open_sftp(self):
            return FakeSFTP()

        def close(self):
            pass

    monkeypatch.setattr(sftp_mod.paramiko, "SSHClient", FakeSSH)
    assert client.post("/api/connect", json={"type": "SFTP", "host": "sftp.example.com", "port": "22", "username": "u", "keyPath": "/tmp/id_ed25519"}).status_code == 200

    details = client.post("/api/remote/info", json={"path": "/app.py"})
    assert details.status_code == 200
    assert details.get_json() == {"path": "/app.py", "permissions": "644", "canChmod": True}

    chmod_resp = client.post("/api/remote/chmod", json={"path": "/app.py", "mode": "755"})
    assert chmod_resp.status_code == 200
    assert chmod_calls == [("/app.py", "0o755")]


def test_onedrive_operations(client, monkeypatch, tmp_path):
    from types import SimpleNamespace
    import app as backend

    class FakeResp:
        def __init__(self, status_code=200, data=None, content=b"", headers=None):
            self.status_code = status_code
            self._data = data
            self.content = content or (b"{}" if data is not None else b"")
            self.headers = headers or {}
            self.ok = 200 <= status_code < 300

        def json(self):
            return self._data

        def iter_content(self, chunk_size=65536):
            yield self.content

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class FakeSession:
        def get(self, url, **_kw):
            if url.endswith("/children"):
                return FakeResp(200, {"value": [{"name": "not.txt", "size": 7, "lastModifiedDateTime": "2026-11-16T10:00:00Z"}]})
            if url.endswith("/content"):
                return FakeResp(200, content=b"merhaba", headers={"Content-Length": "7"})
            return FakeResp(404)

        def post(self, _url, **_kw):
            return FakeResp(201, {"id": "folder-1"})

        def put(self, _url, **_kw):
            return FakeResp(200, {"id": "file-1"})

        def patch(self, _url, **_kw):
            return FakeResp(200, {"id": "file-1"})

        def delete(self, _url, **_kw):
            return FakeResp(204)

        def close(self):
            pass

    monkeypatch.setattr(backend.sessions, "connect_onedrive", lambda: SimpleNamespace(onedrive=True, session=FakeSession(), close=lambda: None))
    assert client.post("/api/connect", json={"type": "OneDrive"}).get_json() == {"connected": True, "type": "OneDrive"}

    listing = client.post("/api/remote/list", json={"path": "/"}).get_json()
    assert listing["entries"][0]["name"] == "not.txt"
    assert client.post("/api/mkdir", json={"side": "remote", "path": "/", "name": "Klasor"}).status_code == 201
    assert client.post("/api/rename", json={"side": "remote", "path": "/not.txt", "name": "not2.txt"}).status_code == 200

    local_dir = tmp_path / "od"
    local_dir.mkdir()
    assert client.post("/api/transfer", json={"direction": "download", "name": "not.txt", "localDir": str(local_dir), "remoteDir": "/"}).status_code == 200
    assert (local_dir / "not.txt").read_text(encoding="utf-8") == "merhaba"
    assert client.post("/api/transfer", json={"direction": "upload", "name": "not.txt", "localDir": str(local_dir), "remoteDir": "/"}).status_code == 200
    assert client.post("/api/delete", json={"side": "remote", "path": "/not.txt"}).status_code == 200


def test_ssh_terminal_open_and_close(client, monkeypatch):
    from types import SimpleNamespace
    import app as backend

    assert client.post("/api/terminal/open", json={"cols": 80, "rows": 24}).status_code == 409

    closed_channels = []

    class FakeChannel:
        def close(self):
            closed_channels.append(True)

    class FakeClient:
        def invoke_shell(self, **_kw):
            return FakeChannel()

    monkeypatch.setattr(backend.sessions, "state", SimpleNamespace(connection=SimpleNamespace(client=FakeClient()), type="SFTP", connection_id="1", pending_dropbox=None))
    opened = client.post("/api/terminal/open", json={"cols": 100, "rows": 30})
    assert opened.status_code == 201
    term_id = opened.get_json()["id"]

    assert client.delete(f"/api/terminal/{term_id}").status_code == 200
    assert closed_channels == [True]
    assert client.delete(f"/api/terminal/{term_id}").status_code == 404
