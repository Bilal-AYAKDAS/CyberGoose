"""Yeni özelliklerin testleri (klasör karşılaştırma, harici düzenleme, çakışma kararı, içe aktarma...)."""
import time
from types import SimpleNamespace

from tests.test_api import connect_ftp, run_transfer


# ---------------------------------------------------------------- 1. klasör karşılaştırma

def test_compare_plans_classifies_files():
    import sync_service

    local = {"files": [
        {"relativeDir": "", "name": "same.txt", "size": 3, "modified": "2026-01-01T10:00:00"},
        {"relativeDir": "", "name": "diff.txt", "size": 5, "modified": "2026-01-02T10:00:00"},
        {"relativeDir": "sub", "name": "local.txt", "size": 1, "modified": None},
    ]}
    remote = {"files": [
        {"relativeDir": "", "name": "same.txt", "size": 3, "modified": "2026-01-01T10:00:01"},
        {"relativeDir": "", "name": "diff.txt", "size": 9, "modified": "2026-01-01T10:00:00"},
        {"relativeDir": "sub/deep", "name": "remote.txt", "size": 2, "modified": None},
    ]}
    result = sync_service.compare_plans(local, remote)
    by_name = {row["name"]: row for row in result["items"]}
    assert by_name["same.txt"]["status"] == "same" and by_name["same.txt"]["newer"] is None
    assert by_name["diff.txt"]["status"] == "different" and by_name["diff.txt"]["newer"] == "local"
    assert by_name["local.txt"]["status"] == "onlyLocal"
    assert by_name["remote.txt"]["status"] == "onlyRemote" and by_name["remote.txt"]["relativeDir"] == "sub/deep"
    assert result["summary"] == {"onlyLocal": 1, "onlyRemote": 1, "different": 1, "same": 1}


def test_compare_endpoint_with_real_ftp(client, ftp_server, tmp_path):
    root = ftp_server["root"] / "cmp"
    (root / "alt").mkdir(parents=True, exist_ok=True)
    (root / "ortak.txt").write_text("abc", encoding="utf-8")
    (root / "alt" / "uzak.txt").write_text("u", encoding="utf-8")
    (tmp_path / "ortak.txt").write_text("abcdef", encoding="utf-8")
    (tmp_path / "yerel.txt").write_text("y", encoding="utf-8")

    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    response = client.post("/api/compare", json={"localPath": str(tmp_path), "remotePath": "/cmp"})
    assert response.status_code == 200, response.get_json()
    statuses = {f"{row['relativeDir']}/{row['name']}".lstrip("/"): row["status"] for row in response.get_json()["items"]}
    assert statuses == {"ortak.txt": "different", "yerel.txt": "onlyLocal", "alt/uzak.txt": "onlyRemote"}


def test_compare_requires_both_paths(client):
    assert client.post("/api/compare", json={"localPath": "C:/"}).status_code == 400


# ---------------------------------------------------------------- 2. harici düzenleyici

def test_external_edit_downloads_and_uploads_on_save(client, ftp_server):
    import os
    import app as backend

    (ftp_server["root"] / "ayar.ini").write_text("eski=1\n", encoding="utf-8")
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    opened = client.post("/api/external-edits", json={"path": "/ayar.ini"})
    assert opened.status_code == 201, opened.get_json()
    edit = opened.get_json()
    with open(edit["localPath"], encoding="utf-8") as handle:
        assert handle.read() == "eski=1\n"

    # Aynı dosya ikinci kez açılınca yeni kopya indirilmez.
    assert client.post("/api/external-edits", json={"path": "/ayar.ini"}).get_json()["id"] == edit["id"]

    with open(edit["localPath"], "w", encoding="utf-8") as handle:
        handle.write("yeni=2\n")
    os.utime(edit["localPath"], (time.time() + 5, time.time() + 5))

    # İlk kontrol yazmanın bitmesini bekler, ikinci kontrol yükler.
    assert backend.external_edits.check(edit["id"])["uploads"] == 0
    assert backend.external_edits.check(edit["id"])["uploads"] == 1
    assert (ftp_server["root"] / "ayar.ini").read_text(encoding="utf-8") == "yeni=2\n"

    listed = client.get("/api/external-edits").get_json()
    assert [item["id"] for item in listed] == [edit["id"]]
    assert client.delete(f"/api/external-edits/{edit['id']}").status_code == 200
    assert not os.path.exists(edit["localPath"])
    assert client.delete(f"/api/external-edits/{edit['id']}").status_code == 404


def test_external_edit_reports_upload_error(client, ftp_server, monkeypatch):
    import os
    import app as backend
    import file_service as files

    (ftp_server["root"] / "kilitli.txt").write_text("a", encoding="utf-8")
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    edit = client.post("/api/external-edits", json={"path": "/kilitli.txt"}).get_json()
    with open(edit["localPath"], "w", encoding="utf-8") as handle:
        handle.write("bb")

    def refuse(*_a, **_k):
        raise files.FileServiceError("Hedef klasöre yazma izniniz yok", 403)

    monkeypatch.setattr(files, "upload", refuse)
    synced = client.post(f"/api/external-edits/{edit['id']}/sync", json={}).get_json()
    assert synced["error"] == "Hedef klasöre yazma izniniz yok" and synced["uploads"] == 0
    backend.external_edits.close(edit["id"])
    assert not os.path.exists(edit["localPath"])


# ---------------------------------------------------------------- 4. çakışma kararı

def _upload(client, local_dir, name, conflict):
    return run_transfer(client, {"direction": "upload", "name": name, "localDir": str(local_dir), "remoteDir": "/cak", "conflict": conflict})


def test_upload_conflict_policies(client, ftp_server, tmp_path):
    import os

    remote_dir = ftp_server["root"] / "cak"
    remote_dir.mkdir(exist_ok=True)
    (remote_dir / "a.txt").write_text("sunucu", encoding="utf-8")
    (tmp_path / "a.txt").write_text("yerel-yeni", encoding="utf-8")
    assert connect_ftp(client, ftp_server["port"]).status_code == 200

    failed = _upload(client, tmp_path, "a.txt", None)
    assert failed["status"] == "error" and failed["errorCode"] == "exists"

    skipped = _upload(client, tmp_path, "a.txt", "skip")
    assert skipped["status"] == "completed" and skipped["result"]["skipped"] is True
    assert (remote_dir / "a.txt").read_text(encoding="utf-8") == "sunucu"

    # Yerel dosya sunucudakinden eski: "daha yeniyse" atlar.
    old = time.time() - 3600
    os.utime(tmp_path / "a.txt", (old, old))
    newer = _upload(client, tmp_path, "a.txt", "newer")
    assert newer["result"]["skipped"] is True and "daha yeni" in newer["result"]["skipReason"]

    # Yerel dosya daha yeni: üzerine yazılır.
    future = time.time() + 3600
    os.utime(tmp_path / "a.txt", (future, future))
    newer = _upload(client, tmp_path, "a.txt", "newer")
    assert newer["status"] == "completed" and not newer["result"].get("skipped")
    assert (remote_dir / "a.txt").read_text(encoding="utf-8") == "yerel-yeni"

    renamed = _upload(client, tmp_path, "a.txt", "rename")
    assert renamed["result"]["renamedTo"] == "a (1).txt"
    assert (remote_dir / "a (1).txt").read_text(encoding="utf-8") == "yerel-yeni"
    assert _upload(client, tmp_path, "a.txt", "rename")["result"]["renamedTo"] == "a (2).txt"

    assert client.post("/api/transfers", json={
        "direction": "upload", "name": "a.txt", "localDir": str(tmp_path), "remoteDir": "/cak", "conflict": "belki",
    }).status_code == 400


def test_download_conflict_rename_and_skip(client, ftp_server, tmp_path):
    (ftp_server["root"] / "rapor.pdf").write_bytes(b"uzak")
    (tmp_path / "rapor.pdf").write_bytes(b"yerel")
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    base = {"direction": "download", "name": "rapor.pdf", "localDir": str(tmp_path), "remoteDir": "/"}
    assert run_transfer(client, base | {"conflict": "skip"})["result"]["skipped"] is True
    assert (tmp_path / "rapor.pdf").read_bytes() == b"yerel"
    renamed = run_transfer(client, base | {"conflict": "rename"})
    assert renamed["result"]["renamedTo"] == "rapor (1).pdf"
    assert (tmp_path / "rapor (1).pdf").read_bytes() == b"uzak"
    assert run_transfer(client, base | {"conflict": "overwrite"})["status"] == "completed"
    assert (tmp_path / "rapor.pdf").read_bytes() == b"uzak"


def test_numbered_names_keep_extension():
    import file_service as files

    names = files._numbered_names("arsiv.tar")
    assert next(names) == "arsiv (1).tar"
    assert next(files._numbered_names(".env")) == ".env (1)"


# ---------------------------------------------------------------- 5. FileZilla içe aktarma ve gruplar

FILEZILLA_XML = """<?xml version="1.0" encoding="UTF-8"?>
<FileZilla3 version="3.66.0" platform="windows">
  <Servers>
    <Server>
      <Host>ftp.ornek.com</Host><Port>21</Port><Protocol>0</Protocol><Type>0</Type>
      <User>bilal</User><Pass encoding="base64">Z2l6bGk=</Pass><Logontype>1</Logontype>
      <Name>Kişisel site</Name>
    </Server>
    <Folder expanded="1">Müşteriler
      <Folder>ACME
        <Server>
          <Host>sftp.acme.com</Host><Port>2222</Port><Protocol>1</Protocol>
          <User>deploy</User><Keyfile>C:\\keys\\acme.ppk</Keyfile><Logontype>5</Logontype>
          <Name>ACME prod</Name>
        </Server>
      </Folder>
      <Server>
        <Host>s3.amazonaws.com</Host><Protocol>5</Protocol><User>x</User><Name>S3 kovası</Name>
      </Server>
      <Server>
        <Host>ftps.beta.com</Host><Protocol>4</Protocol><User>u</User>
        <Pass encoding="crypt">abc</Pass><Logontype>1</Logontype><Name>Beta</Name>
      </Server>
    </Folder>
  </Servers>
</FileZilla3>
"""


def test_parse_filezilla_sitemanager():
    import filezilla_import

    sites, warnings = filezilla_import.parse_sitemanager(FILEZILLA_XML)
    by_name = {site["name"]: site for site in sites}
    assert set(by_name) == {"Kişisel site", "ACME prod", "Beta"}
    assert by_name["Kişisel site"] | {} == {
        "name": "Kişisel site", "type": "FTP", "host": "ftp.ornek.com", "port": 21, "username": "bilal",
        "password": "gizli", "keyPath": None, "group": None,
    }
    assert by_name["ACME prod"]["type"] == "SFTP" and by_name["ACME prod"]["port"] == 2222
    assert by_name["ACME prod"]["keyPath"] == "C:\\keys\\acme.ppk" and by_name["ACME prod"]["group"] == "Müşteriler/ACME"
    assert by_name["Beta"]["type"] == "FTPS" and by_name["Beta"]["password"] is None and by_name["Beta"]["port"] == 21
    assert any("S3 kovası" in warning for warning in warnings)
    assert any("Beta" in warning and "ana parola" in warning for warning in warnings)


def test_filezilla_rejects_other_files():
    import pytest
    import file_service as files
    import filezilla_import

    with pytest.raises(files.FileServiceError):
        filezilla_import.parse_sitemanager("<html></html>")
    with pytest.raises(files.FileServiceError):
        filezilla_import.parse_sitemanager('<!DOCTYPE x [<!ENTITY a "b">]><FileZilla3><Servers/></FileZilla3>')


def test_import_endpoint_saves_groups_and_skips_duplicates(client, monkeypatch):
    import db as db_mod

    secrets = {}
    monkeypatch.setattr(db_mod, "_set_secret", lambda cid, pw: secrets.__setitem__(cid, pw) or True)
    monkeypatch.setattr(db_mod, "_get_secret", lambda cid: secrets.get(cid))

    first = client.post("/api/connections/import/filezilla", json={"xml": FILEZILLA_XML})
    assert first.status_code == 201
    assert first.get_json()["imported"] == 3
    listed = {item["name"]: item for item in client.get("/api/connections").get_json()}
    assert listed["ACME prod"]["group"] == "Müşteriler/ACME"
    assert listed["Kişisel site"]["hasPassword"] is True

    again = client.post("/api/connections/import/filezilla", json={"xml": FILEZILLA_XML}).get_json()
    assert again["imported"] == 0 and set(again["skipped"]) == {"Kişisel site", "ACME prod", "Beta"}

    # Grup düzenleme
    acme = listed["ACME prod"]
    updated = client.put(f"/api/connections/{acme['id']}", json={
        "name": "ACME prod", "type": "SFTP", "host": "sftp.acme.com", "port": "2222", "username": "deploy", "group": "Arşiv",
    }).get_json()
    assert updated["group"] == "Arşiv"
    for item in client.get("/api/connections").get_json():
        client.delete(f"/api/connections/{item['id']}")
    assert client.post("/api/connections/import/filezilla", json={"xml": ""}).status_code == 400


# ---------------------------------------------------------------- 6. anahtar parolası ve SSH agent

def _fake_ssh(monkeypatch, calls, fail=None):
    from providers import sftp as sftp_mod

    class FakeSSH:
        def load_host_keys(self, _p):
            pass

        def set_missing_host_key_policy(self, _p):
            pass

        def connect(self, *args, **kwargs):
            calls.append(kwargs)
            if fail is not None:
                raise fail

        def get_transport(self):
            return SimpleNamespace(set_keepalive=lambda _s: None, is_active=lambda: True)

        def open_sftp(self):
            return SimpleNamespace(close=lambda: None)

        def close(self):
            pass

    monkeypatch.setattr(sftp_mod.paramiko, "SSHClient", FakeSSH)


def _memory_keyring(monkeypatch):
    import db as db_mod

    secrets = {}
    monkeypatch.setattr(db_mod, "_set_secret", lambda cid, pw: secrets.__setitem__(str(cid), pw) or True)
    monkeypatch.setattr(db_mod, "_get_secret", lambda cid: secrets.get(str(cid)))
    monkeypatch.setattr(db_mod, "_delete_secret", lambda cid: secrets.pop(str(cid), None))
    return secrets


def test_saved_agent_connection_needs_no_password(client, monkeypatch):
    calls = []
    _fake_ssh(monkeypatch, calls)
    _memory_keyring(monkeypatch)
    created = client.post("/api/connections", json={
        "name": "Pageant", "type": "SFTP", "host": "h", "port": "22", "username": "u", "useAgent": True,
    }).get_json()
    assert created["useAgent"] is True and created["hasPassword"] is False
    response = client.post("/api/connect", json={"type": "SFTP", "connectionId": created["id"]})
    assert response.status_code == 200, response.get_json()
    assert calls[-1]["allow_agent"] is True and calls[-1]["password"] is None
    client.delete(f"/api/connections/{created['id']}")


def test_key_passphrase_is_stored_and_used(client, monkeypatch):
    calls = []
    _fake_ssh(monkeypatch, calls)
    secrets = _memory_keyring(monkeypatch)
    created = client.post("/api/connections", json={
        "name": "Şifreli anahtar", "type": "SFTP", "host": "h", "port": "22", "username": "u",
        "keyPath": "C:/k/id_ed25519", "keyPassphrase": "anahtar-parolasi",
    }).get_json()
    assert created["hasPassphrase"] is True
    assert secrets[f"{created['id']}:passphrase"] == "anahtar-parolasi"
    assert client.post("/api/connect", json={"type": "SFTP", "connectionId": created["id"]}).status_code == 200
    assert calls[-1]["passphrase"] == "anahtar-parolasi" and calls[-1]["key_filename"] == "C:/k/id_ed25519"
    client.delete(f"/api/connections/{created['id']}")
    assert f"{created['id']}:passphrase" not in secrets


def test_encrypted_key_without_passphrase_asks_for_it(client, monkeypatch):
    import paramiko

    _fake_ssh(monkeypatch, [], fail=paramiko.PasswordRequiredException("Private key file is encrypted"))
    response = client.post("/api/connect", json={"type": "SFTP", "host": "h", "port": "22", "username": "u", "keyPath": "C:/k/id"})
    assert response.status_code == 401
    assert response.get_json()["code"] == "key_passphrase_required"


def test_agent_without_keys_reports_clear_error(client, monkeypatch):
    import paramiko

    _fake_ssh(monkeypatch, [], fail=paramiko.AuthenticationException("Authentication failed."))
    response = client.post("/api/connect", json={"type": "SFTP", "host": "h", "port": "22", "username": "u", "useAgent": True})
    assert response.status_code == 401
    body = response.get_json()
    assert body["code"] == "agent_failed" and "Pageant" in body["error"]


# ---------------------------------------------------------------- 7. alt klasörlerde arama

def test_local_search_finds_nested_files(client, tmp_path):
    (tmp_path / "a" / "b").mkdir(parents=True)
    (tmp_path / "a" / "b" / "Rapor-2026.pdf").write_bytes(b"x")
    (tmp_path / "rapor.txt").write_text("y", encoding="utf-8")
    (tmp_path / "raporlar").mkdir()
    (tmp_path / "diger.txt").write_text("z", encoding="utf-8")
    response = client.post("/api/search", json={"side": "local", "path": str(tmp_path), "query": "RAPOR"})
    assert response.status_code == 200
    hits = {hit["name"]: hit for hit in response.get_json()["results"]}
    assert set(hits) == {"Rapor-2026.pdf", "rapor.txt", "raporlar"}
    assert hits["raporlar"]["kind"] == "folder"
    assert hits["Rapor-2026.pdf"]["parent"] == str(tmp_path / "a" / "b") and hits["Rapor-2026.pdf"]["size"] == 1
    assert client.post("/api/search", json={"side": "local", "path": str(tmp_path), "query": "  "}).status_code == 400


def test_remote_search_walks_subfolders(client, ftp_server):
    root = ftp_server["root"] / "ara"
    (root / "x" / "y").mkdir(parents=True, exist_ok=True)
    (root / "x" / "y" / "config.php").write_text("<?php", encoding="utf-8")
    (root / "config.bak").write_text("b", encoding="utf-8")
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    response = client.post("/api/search", json={"side": "remote", "path": "/ara", "query": "config"})
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    paths = sorted(hit["path"] for hit in body["results"])
    assert paths == ["/ara/config.bak", "/ara/x/y/config.php"]
    assert body["truncated"] is False


def test_search_stops_at_result_limit(tmp_path, monkeypatch):
    import sync_service

    for index in range(5):
        (tmp_path / f"log{index}.txt").write_text("", encoding="utf-8")
    monkeypatch.setattr(sync_service, "MAX_SEARCH_RESULTS", 3)
    result = sync_service.search_local(str(tmp_path), "log")
    assert len(result["results"]) == 3 and result["truncated"] is True


# ---------------------------------------------------------------- 8. zip açma

def _make_zip(path, entries):
    import zipfile

    with zipfile.ZipFile(path, "w") as bundle:
        for name, data in entries.items():
            bundle.writestr(name, data)


def test_extract_zip_next_to_archive(client, tmp_path):
    archive = tmp_path / "site.zip"
    _make_zip(archive, {"index.html": "<h1>", "css/app.css": "body{}", "img/": ""})
    response = client.post("/api/extract", json={"path": str(archive)})
    assert response.status_code == 201, response.get_json()
    body = response.get_json()
    assert body["name"] == "site" and body["files"] == 2 and body["skipped"] == 0
    assert (tmp_path / "site" / "css" / "app.css").read_text(encoding="utf-8") == "body{}"
    assert (tmp_path / "site" / "img").is_dir()
    # Klasör varsa yeni adla açılır.
    assert client.post("/api/extract", json={"path": str(archive)}).get_json()["name"] == "site (1)"


def test_extract_blocks_zip_slip(client, tmp_path):
    archive = tmp_path / "kotu.zip"
    _make_zip(archive, {"../disari.txt": "x", "/mutlak.txt": "y", "icerde.txt": "z"})
    body = client.post("/api/extract", json={"path": str(archive)}).get_json()
    assert body["files"] == 1 and body["skipped"] == 2
    assert not (tmp_path / "disari.txt").exists()
    assert (tmp_path / "kotu" / "icerde.txt").exists()


def test_extract_rejects_non_zip(client, tmp_path):
    fake = tmp_path / "degil.zip"
    fake.write_text("zip değil", encoding="utf-8")
    response = client.post("/api/extract", json={"path": str(fake)})
    assert response.status_code == 400 and response.get_json()["code"] == "bad_zip"
    assert client.post("/api/extract", json={"path": str(tmp_path / "yok.zip")}).status_code == 404


# ---------------------------------------------------------------- 9. resim ve PDF önizleme

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4"
    "0000000049454e44ae426082"
)


def test_local_image_preview(client, tmp_path):
    image = tmp_path / "logo.PNG"
    image.write_bytes(PNG_1PX)
    response = client.post("/api/local/preview", json={"path": str(image)})
    assert response.status_code == 200
    assert response.mimetype == "image/png" and response.data == PNG_1PX
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_preview_rejects_other_types_and_large_files(client, tmp_path, monkeypatch):
    import file_service as files

    text = tmp_path / "not.txt"
    text.write_text("x", encoding="utf-8")
    response = client.post("/api/local/preview", json={"path": str(text)})
    assert response.status_code == 415 and response.get_json()["code"] == "unsupported_preview"
    pdf = tmp_path / "buyuk.pdf"
    pdf.write_bytes(b"%PDF-1.4" + b"0" * 100)
    monkeypatch.setattr(files, "MAX_LOCAL_PREVIEW_BYTES", 10)
    assert client.post("/api/local/preview", json={"path": str(pdf)}).status_code == 413


def test_remote_pdf_preview_over_ftp(client, ftp_server):
    (ftp_server["root"] / "kilavuz.pdf").write_bytes(b"%PDF-1.4 test")
    assert connect_ftp(client, ftp_server["port"]).status_code == 200
    response = client.post("/api/remote/preview", json={"path": "/kilavuz.pdf"})
    assert response.status_code == 200
    assert response.mimetype == "application/pdf" and response.data == b"%PDF-1.4 test"
