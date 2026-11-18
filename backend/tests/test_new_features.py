"""İkinci tur özellikler: yarım kalan bulut yüklemeleri, Drive'a akış kopyası ve diğerleri."""
import io
from types import SimpleNamespace

import pytest

import file_service as fs


@pytest.fixture(autouse=True)
def _sessions_file(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "UPLOAD_SESSIONS_FILE", str(tmp_path / "upload_sessions.json"))


def _local(tmp_path, size=20):
    folder = tmp_path / "yerel"
    folder.mkdir()
    data = bytes(range(size))
    (folder / "veri.bin").write_bytes(data)
    return folder, data


# ---------------------------------------------------------------- Dropbox

class FakeDropbox:
    def __init__(self, fail_on_append=None):
        self.sessions = {}
        self.files = {}
        self.started = 0
        self.appends = 0
        self.fail_on_append = fail_on_append

    def files_upload_session_start(self, data):
        self.started += 1
        sid = f"s{self.started}"
        self.sessions[sid] = bytearray(data)
        return SimpleNamespace(session_id=sid)

    def files_upload_session_append_v2(self, data, cursor):
        self.appends += 1
        if self.fail_on_append == self.appends:
            raise ConnectionError("bağlantı koptu")
        buf = self.sessions.get(cursor.session_id)
        if buf is None or len(buf) != cursor.offset:
            raise RuntimeError("incorrect_offset")
        buf.extend(data)

    def files_upload_session_finish(self, data, cursor, commit):
        buf = self.sessions.pop(cursor.session_id)
        assert len(buf) == cursor.offset
        buf.extend(data)
        self.files[commit.path] = bytes(buf)


def test_dropbox_upload_resumes_saved_session(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "DROPBOX_CHUNK_SIZE", 4)
    folder, data = _local(tmp_path)
    dbx = FakeDropbox(fail_on_append=2)
    conn = SimpleNamespace(dbx=dbx)
    monkeypatch.setattr(fs, "_remote_exists", lambda *a: False)
    with pytest.raises(fs.FileServiceError):
        fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True)
    assert dbx.started == 1

    result = fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True, resume=True)
    assert dbx.started == 1  # yeni oturum açılmadı
    assert result["resumedFrom"] == 8
    assert dbx.files["/veri.bin"] == data
    # Başarılı yükleme kaydı siler.
    assert fs.load_upload_session(fs.upload_resume_key("dropbox", folder / "veri.bin", "/veri.bin")) is None


def test_dropbox_restarts_when_saved_session_is_gone(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "DROPBOX_CHUNK_SIZE", 4)
    folder, data = _local(tmp_path)
    dbx = FakeDropbox()
    conn = SimpleNamespace(dbx=dbx)
    monkeypatch.setattr(fs, "_remote_exists", lambda *a: False)
    key = fs.upload_resume_key("dropbox", folder / "veri.bin", "/veri.bin")
    fs.save_upload_session(key, provider="dropbox", sessionId="suresi-dolmus", offset=8)
    result = fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True, resume=True)
    assert result["resumedFrom"] == 0
    assert dbx.files["/veri.bin"] == data


def test_saved_session_ignored_when_local_file_changed(tmp_path, monkeypatch):
    folder, _ = _local(tmp_path)
    key_before = fs.upload_resume_key("dropbox", folder / "veri.bin", "/veri.bin")
    (folder / "veri.bin").write_bytes(b"baska icerik, baska boyut")
    assert fs.upload_resume_key("dropbox", folder / "veri.bin", "/veri.bin") != key_before


def test_old_upload_sessions_expire(monkeypatch):
    fs.save_upload_session("k", provider="dropbox", sessionId="x", offset=4)
    assert fs.load_upload_session("k")
    monkeypatch.setattr(fs.time, "time", lambda: 10**12)
    assert fs.load_upload_session("k") is None


# ---------------------------------------------------------------- OneDrive

class FakeGraph:
    def __init__(self, fail_on_put=None):
        self.uploads = {}
        self.created = 0
        self.puts = 0
        self.fail_on_put = fail_on_put

    def post(self, url, json=None, timeout=None):
        self.created += 1
        upload_url = f"https://upload.example/{self.created}"
        self.uploads[upload_url] = bytearray()
        return SimpleNamespace(ok=True, status_code=200, json=lambda: {"uploadUrl": upload_url}, text="")

    def put_chunk(self, url, data=None, headers=None, timeout=None):
        self.puts += 1
        if self.fail_on_put == self.puts:
            raise ConnectionError("koptu")
        buf = self.uploads[url]
        start = int(headers["Content-Range"].split(" ")[1].split("-")[0])
        assert start == len(buf)
        buf.extend(data)
        return SimpleNamespace(ok=True, status_code=202)

    def get_status(self, url, timeout=None):
        if url not in self.uploads:
            return SimpleNamespace(ok=False, status_code=404)
        received = len(self.uploads[url])
        return SimpleNamespace(ok=True, status_code=200, json=lambda: {"nextExpectedRanges": [f"{received}-"]})


def test_onedrive_upload_resumes_from_next_expected_range(tmp_path, monkeypatch):
    import requests

    monkeypatch.setattr(fs, "ONEDRIVE_SIMPLE_LIMIT", 4)
    monkeypatch.setattr(fs, "ONEDRIVE_CHUNK_SIZE", 6)
    folder, data = _local(tmp_path)
    graph = FakeGraph(fail_on_put=3)
    monkeypatch.setattr(requests, "put", graph.put_chunk)
    monkeypatch.setattr(requests, "get", graph.get_status)
    monkeypatch.setattr(fs, "_onedrive_check", lambda resp: resp.json())
    monkeypatch.setattr(fs, "_remote_exists", lambda *a: False)
    conn = SimpleNamespace(onedrive=True, session=graph)
    with pytest.raises(fs.FileServiceError):
        fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True)
    result = fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True, resume=True)
    assert graph.created == 1
    assert result["resumedFrom"] == 12
    assert bytes(graph.uploads["https://upload.example/1"]) == data


# ---------------------------------------------------------------- Google Drive

class FakeResp:
    def __init__(self, status, headers=None):
        self.status_code = status
        self.headers = headers or {}


class FakeDriveHttp:
    def __init__(self, fail_on_put=None, short_once=False):
        self.sessions = {}
        self.started = 0
        self.puts = 0
        self.fail_on_put = fail_on_put
        self.short_once = short_once
        self.done = {}

    def _start(self, name, headers):
        self.started += 1
        uri = f"https://upload.example/drive/{self.started}"
        self.sessions[uri] = {"data": bytearray(), "size": int(headers["X-Upload-Content-Length"]), "name": name}
        return FakeResp(200, {"Location": uri})

    def post(self, url, json=None, headers=None, timeout=None):
        return self._start(json["name"], headers)

    def patch(self, url, json=None, headers=None, timeout=None):
        return self._start(url.rsplit("/", 1)[1].split("?")[0], headers)

    def _status(self, sess):
        received = len(sess["data"])
        if received == sess["size"]:
            self.done[sess["name"]] = bytes(sess["data"])
            return FakeResp(200)
        return FakeResp(308, {"Range": f"bytes=0-{received - 1}"} if received else {})

    def put(self, uri, data=b"", headers=None, timeout=None):
        sess = self.sessions.get(uri)
        if sess is None:
            return FakeResp(404)
        rng = headers["Content-Range"]
        if rng.startswith("bytes */"):
            return self._status(sess)
        self.puts += 1
        if self.fail_on_put == self.puts:
            raise ConnectionError("koptu")
        start = int(rng.split(" ")[1].split("-")[0])
        assert start == len(sess["data"])
        if self.short_once:
            self.short_once = False
            data = data[: len(data) // 2]
        sess["data"].extend(data)
        return self._status(sess)


def _drive_conn(http, monkeypatch, existing=None):
    monkeypatch.setattr(fs, "_drive_resolve_folder", lambda service, path: "kok")
    monkeypatch.setattr(fs, "_drive_find_file", lambda service, folder, name: existing)
    return SimpleNamespace(service=object(), authorized_session=http)


def test_drive_upload_resumes_and_rewinds_partial_chunks(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "DRIVE_CHUNK_SIZE", 6)
    folder, data = _local(tmp_path)
    http = FakeDriveHttp(fail_on_put=3, short_once=True)
    conn = _drive_conn(http, monkeypatch)
    with pytest.raises(fs.FileServiceError):
        fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True)
    result = fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True, resume=True)
    assert http.started == 1
    assert result["resumedFrom"] == 9  # 3 bayt (yarım parça) + 6 bayt
    assert http.done["veri.bin"] == data


def test_drive_existing_file_is_updated_through_patch(tmp_path, monkeypatch):
    folder, data = _local(tmp_path)
    http = FakeDriveHttp()
    conn = _drive_conn(http, monkeypatch, existing={"id": "dosya-1"})
    fs.upload(conn, str(folder), "veri.bin", "/", overwrite=True)
    assert http.done["dosya-1"] == data


def test_drive_accepts_streamed_copies_of_known_size(monkeypatch):
    assert fs.can_stream_to("drive", 10)
    assert not fs.can_stream_to("drive", None)
    monkeypatch.setattr(fs, "DRIVE_CHUNK_SIZE", 6)
    http = FakeDriveHttp()
    conn = _drive_conn(http, monkeypatch)
    monkeypatch.setattr(fs, "_remote_file_exists", lambda *a: False)
    data = b"akistan gelen veri 123"
    result = fs.stream_upload(conn, io.BytesIO(data), len(data), "/", "akis.bin", "overwrite")
    assert result["streamed"] is True
    assert http.done["akis.bin"] == data


def test_drive_stream_fails_when_server_drops_part_of_a_chunk(monkeypatch):
    monkeypatch.setattr(fs, "DRIVE_CHUNK_SIZE", 6)
    http = FakeDriveHttp(short_once=True)
    conn = _drive_conn(http, monkeypatch)
    monkeypatch.setattr(fs, "_remote_file_exists", lambda *a: False)
    with pytest.raises(fs.FileServiceError):
        fs.stream_upload(conn, io.BytesIO(b"x" * 20), 20, "/", "akis.bin", "overwrite")


def test_drive_stream_rejects_source_longer_than_announced(monkeypatch):
    http = FakeDriveHttp()
    conn = _drive_conn(http, monkeypatch)
    monkeypatch.setattr(fs, "_remote_file_exists", lambda *a: False)
    with pytest.raises(fs.FileServiceError) as info:
        fs.stream_upload(conn, io.BytesIO(b"x" * 25), 20, "/", "akis.bin", "overwrite")
    assert info.value.code == "incomplete"


# ---------------------------------------------------------------- karşılaştırma saat farkı

def test_compare_offset_is_saved_per_connection(client):
    created = client.post("/api/connections", json={
        "name": "Saat", "type": "FTP", "host": "ftp.example.com", "port": "21", "username": "demo",
    }).get_json()
    assert created["compareOffset"] is None
    url = f"/api/connections/{created['id']}/compare-offset"
    assert client.put(url, json={"minutes": 180}).get_json()["compareOffset"] == 180
    listed = next(item for item in client.get("/api/connections").get_json() if item["id"] == created["id"])
    assert listed["compareOffset"] == 180
    # Bağlantı düzenlenince kayıtlı fark korunur.
    client.put(f"/api/connections/{created['id']}", json={
        "name": "Saat 2", "type": "FTP", "host": "ftp.example.com", "port": "21", "username": "demo",
    })
    listed = next(item for item in client.get("/api/connections").get_json() if item["id"] == created["id"])
    assert listed["compareOffset"] == 180
    assert client.put(url, json={"minutes": 20 * 60}).status_code == 400
    assert client.put(url, json={"minutes": None}).get_json()["compareOffset"] is None
    assert client.put("/api/connections/999999/compare-offset", json={"minutes": 60}).status_code == 404
    client.delete(f"/api/connections/{created['id']}")
