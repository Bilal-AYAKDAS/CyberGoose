"""Uzaktan uzağa aktarım: sol panelde ikinci bağlantı ve iki oturum arasında kopya."""
import os

import pytest

from tests.test_api import connect_ftp, run_transfer


def side_connect(client, port, password="password"):
    return client.post("/api/side/connect", json={
        "type": "FTP", "host": "127.0.0.1", "port": str(port), "username": "demo", "password": password,
    })


@pytest.fixture()
def two_sessions(client, ftp_server):
    root = ftp_server["root"]
    for name in ("kaynak", "hedef"):
        (root / name).mkdir(exist_ok=True)
        for item in (root / name).iterdir():
            item.unlink()
    right = connect_ftp(client, ftp_server["port"]).get_json()["sessionId"]
    left_response = side_connect(client, ftp_server["port"])
    assert left_response.status_code == 200, left_response.get_json()
    left = left_response.get_json()["sessionId"]
    yield {"left": left, "right": right, "root": root}
    client.post("/api/side/disconnect", json={"sessionId": left})


def copy(client, sessions, name, source_session, target_session, **extra):
    return run_transfer(client, {
        "direction": "copy", "name": name,
        "sourceDir": "/kaynak", "targetDir": "/hedef",
        "sourceSessionId": sessions[source_session], "sessionId": sessions[target_session], **extra,
    })


def test_side_session_lists_independently_of_active_session(client, two_sessions):
    (two_sessions["root"] / "kaynak" / "a.txt").write_text("A", encoding="utf-8")
    assert two_sessions["left"] != two_sessions["right"]
    listed = client.post("/api/remote/list", json={"path": "/kaynak", "sessionId": two_sessions["left"]})
    assert listed.status_code == 200, listed.get_json()
    assert [entry["name"] for entry in listed.get_json()["entries"]] == ["a.txt"]
    # Sağ paneldeki etkin oturum değişmedi.
    assert client.get("/api/session").get_json()["sessionId"] == two_sessions["right"]


def test_copy_between_sessions_and_cleans_relay(client, two_sessions):
    import app as backend

    payload = os.urandom(300_000)
    (two_sessions["root"] / "kaynak" / "veri.bin").write_bytes(payload)
    status = copy(client, two_sessions, "veri.bin", "left", "right")
    assert status["status"] == "completed", status
    assert status["result"]["size"] == len(payload)
    assert status["transferred"] == status["total"] == len(payload)
    assert (two_sessions["root"] / "hedef" / "veri.bin").read_bytes() == payload
    relay = backend.transfers._relay_dir
    assert not relay.exists() or not any(relay.iterdir())


def test_copy_conflict_policies(client, two_sessions):
    root = two_sessions["root"]
    (root / "kaynak" / "rapor.txt").write_text("yeni", encoding="utf-8")
    (root / "hedef" / "rapor.txt").write_text("eski", encoding="utf-8")

    failed = copy(client, two_sessions, "rapor.txt", "right", "left")
    assert failed["status"] == "error" and failed["errorCode"] == "exists"

    skipped = copy(client, two_sessions, "rapor.txt", "right", "left", conflict="skip")
    assert skipped["status"] == "completed" and skipped["result"]["skipped"] is True
    assert (root / "hedef" / "rapor.txt").read_text(encoding="utf-8") == "eski"

    renamed = copy(client, two_sessions, "rapor.txt", "right", "left", conflict="rename")
    assert renamed["status"] == "completed", renamed
    assert (root / "hedef" / "rapor (1).txt").read_text(encoding="utf-8") == "yeni"

    overwritten = copy(client, two_sessions, "rapor.txt", "right", "left", conflict="overwrite")
    assert overwritten["status"] == "completed", overwritten
    assert (root / "hedef" / "rapor.txt").read_text(encoding="utf-8") == "yeni"


def test_copy_reports_missing_source(client, two_sessions):
    status = copy(client, two_sessions, "yok.txt", "left", "right")
    assert status["status"] == "error"
    assert not (two_sessions["root"] / "hedef" / "yok.txt").exists()


def test_copy_validates_request(client, two_sessions):
    missing = client.post("/api/transfers", json={"direction": "copy", "name": "a", "sourceDir": "/", "targetDir": "/"})
    assert missing.status_code == 400
    bad_policy = client.post("/api/transfers", json={
        "direction": "copy", "name": "a", "sourceDir": "/", "targetDir": "/",
        "sourceSessionId": two_sessions["left"], "sessionId": two_sessions["right"], "conflict": "hepsi",
    })
    assert bad_policy.status_code == 400


def test_side_rename_mkdir_delete(client, two_sessions):
    root = two_sessions["root"]
    (root / "kaynak" / "eski.txt").write_text("x", encoding="utf-8")
    left = two_sessions["left"]
    assert client.post("/api/rename", json={"side": "remote", "path": "/kaynak/eski.txt", "name": "yeni.txt", "sessionId": left}).status_code == 200
    assert (root / "kaynak" / "yeni.txt").is_file()
    assert client.post("/api/mkdir", json={"side": "remote", "path": "/kaynak", "name": "alt", "sessionId": left}).status_code == 201
    assert client.post("/api/delete", json={"side": "remote", "path": "/kaynak/yeni.txt", "sessionId": left}).status_code == 200
    assert not (root / "kaynak" / "yeni.txt").exists()
    (root / "kaynak" / "alt").rmdir()


def test_side_disconnect_closes_only_that_session(client, ftp_server):
    right = connect_ftp(client, ftp_server["port"]).get_json()["sessionId"]
    left = side_connect(client, ftp_server["port"]).get_json()["sessionId"]
    assert client.post("/api/side/disconnect", json={"sessionId": left}).status_code == 200
    closed = client.post("/api/remote/list", json={"path": "/", "sessionId": left})
    assert closed.status_code == 409 and closed.get_json()["code"] == "session_closed"
    assert client.post("/api/remote/list", json={"path": "/", "sessionId": right}).status_code == 200
    # Sağ paneldeki oturum kapatılamaz bu uçla.
    client.post("/api/side/disconnect", json={"sessionId": right})
    assert client.get("/api/session").get_json()["connected"] is True


def test_side_connect_reports_wrong_password(client, ftp_server):
    response = side_connect(client, ftp_server["port"], password="yanlis")
    assert response.status_code in (401, 403), response.get_json()
    assert response.get_json()["error"]


def test_side_connect_needs_dropbox_authorisation_first(client, monkeypatch):
    import app as backend

    monkeypatch.setattr(backend.sessions, "connect_dropbox", lambda: None)
    response = client.post("/api/side/connect", json={"type": "dropbox"})
    assert response.status_code == 409
    assert response.get_json()["code"] == "auth_required"


def test_side_session_survives_many_reconnects_on_the_right():
    from services.session_manager import MAX_SNAPSHOTS, SessionManager

    manager = SessionManager()
    side_id = manager.open_side(object(), "FTP", None, factory=lambda: object())
    for _ in range(MAX_SNAPSHOTS + 5):
        with manager.lock:
            manager.activate(object(), "FTP", None, factory=lambda: object())
    assert manager.snapshot(side_id).side is True
    assert manager.close_side(side_id) == side_id
    with pytest.raises(Exception):
        manager.snapshot(side_id)
