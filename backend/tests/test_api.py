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
