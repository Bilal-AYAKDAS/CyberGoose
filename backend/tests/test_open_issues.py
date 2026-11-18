"""Açık kalan konular: çökme sonrası temizlik, saat dilimi, akışlı uzaktan uzağa kopya."""
import json
import os
import time

import pytest


# ---------------------------------------------------------------- 1. harici düzenleme artıkları

def _edit_folder(base, name, content=b"veri", signature=None):
    folder = base / name
    folder.mkdir(parents=True)
    target = folder / "ayar.ini"
    target.write_bytes(content)
    info = target.stat()
    sig = signature or [info.st_mtime, info.st_size]
    (folder / ".cg-edit.json").write_text(json.dumps({"remotePath": "/ayar.ini", "name": "ayar.ini", "signature": sig}))
    return folder


def test_cleanup_removes_unchanged_edit_folders(tmp_path):
    from services.edit_watcher import cleanup_stale

    clean = _edit_folder(tmp_path, "temiz")
    result = cleanup_stale(tmp_path)
    assert result == {"removed": 1, "kept": 0}
    assert not clean.exists()


def test_cleanup_keeps_recent_unsynced_changes_then_drops_old_ones(tmp_path):
    from services.edit_watcher import cleanup_stale

    dirty = _edit_folder(tmp_path, "kirli", signature=[1.0, 2])  # dosya imzadan farklı: yüklenmemiş kayıt
    assert cleanup_stale(tmp_path) == {"removed": 0, "kept": 1}
    assert dirty.exists()
    # 8 gün sonra artık tutulmaz.
    assert cleanup_stale(tmp_path, now=time.time() + 8 * 86400) == {"removed": 1, "kept": 0}
    assert not dirty.exists()


def test_cleanup_handles_legacy_folders_without_manifest(tmp_path):
    from services.edit_watcher import cleanup_stale

    (tmp_path / "bos").mkdir()
    legacy = tmp_path / "eski"
    legacy.mkdir()
    (legacy / "dosya.txt").write_text("x")
    old = time.time() - 30 * 86400
    os.utime(legacy / "dosya.txt", (old, old))
    assert cleanup_stale(tmp_path) == {"removed": 2, "kept": 0}


def test_watcher_cleans_on_startup_and_writes_manifest(tmp_path, client, ftp_server):
    import app as backend
    from services.edit_watcher import EditWatcher
    from tests.test_api import connect_ftp

    leftover = _edit_folder(tmp_path, "cokme")
    watcher = EditWatcher(backend.transfers, tmp_path, autostart=False)
    assert watcher.startup_cleanup["removed"] == 1 and not leftover.exists()

    (ftp_server["root"] / "manifest.txt").write_text("ilk", encoding="utf-8")
    connect_ftp(client, ftp_server["port"])
    edit = watcher.open(None, "/manifest.txt")
    manifest = json.loads((tmp_path / edit["id"] / ".cg-edit.json").read_text())
    assert manifest["remotePath"] == "/manifest.txt" and manifest["name"] == "manifest.txt"
    # Kaydedilip yüklenen dosya, yeni imzayla temiz sayılır.
    local = tmp_path / edit["id"] / "manifest.txt"
    local.write_text("ikinci sürüm", encoding="utf-8")
    assert watcher.check(edit["id"], settle=False)["uploads"] == 1
    assert cleanup_stale_after(tmp_path) == {"removed": 1, "kept": 0}


def cleanup_stale_after(base):
    from services.edit_watcher import cleanup_stale

    return cleanup_stale(base)


# ---------------------------------------------------------------- 2. saat dilimi

def _plan(rows):
    """(ad, boyut, tarih[, ek alanlar]) satırlarından karşılaştırma planı."""
    files_ = []
    for name, size, modified, *extra in rows:
        files_.append({"relativeDir": "", "name": name, "size": size, "modified": modified, **(extra[0] if extra else {})})
    return {"files": files_}


def test_compare_detects_server_timezone_shift():
    from sync_service import compare_plans

    local = _plan([("a.txt", 1, "2026-11-17T10:00:00"), ("b.txt", 2, "2026-11-17T11:30:05"), ("c.txt", 3, "2026-11-16T09:00:00"), ("d.txt", 9, "2026-11-17T12:00:00")])
    # Sunucu 3 saat ileride yazıyor; d.txt gerçekten değişmiş (boyut farklı).
    remote = _plan([("a.txt", 1, "2026-11-17T13:00:00"), ("b.txt", 2, "2026-11-17T14:30:05"), ("c.txt", 3, "2026-11-16T12:00:00"), ("d.txt", 4, "2026-11-17T18:00:00")])
    result = compare_plans(local, remote)
    assert result["timeOffsetMinutes"] == 180 and result["timeOffsetDetected"] is True
    rows = {row["name"]: row for row in result["items"]}
    assert rows["a.txt"]["newer"] is None and rows["b.txt"]["newer"] is None
    assert rows["d.txt"]["newer"] == "remote" and rows["d.txt"]["status"] == "different"


def test_compare_does_not_guess_from_random_differences():
    from sync_service import compare_plans

    local = _plan([("a", 1, "2026-11-17T10:00:00"), ("b", 1, "2026-11-17T10:00:00"), ("c", 1, "2026-11-17T10:00:00")])
    remote = _plan([("a", 1, "2026-11-17T13:00:00"), ("b", 1, "2026-11-17T10:07:13"), ("c", 1, "2026-11-15T01:02:03")])
    result = compare_plans(local, remote)
    assert result["timeOffsetMinutes"] == 0 and result["timeOffsetDetected"] is False


def test_compare_manual_offset_and_list_precision():
    from sync_service import compare_plans

    local = _plan([("a", 1, "2026-11-17T10:00:40")])
    remote = _plan([("a", 1, "2026-11-17T08:00:00", {"mtimePrecision": 60})])
    # Elle -120 dk: sunucu 2 saat geride. LIST dakika hassasiyetinde olduğu için 40 sn fark "aynı".
    assert compare_plans(local, remote, -120)["items"][0]["newer"] is None
    assert compare_plans(local, remote, 0)["items"][0]["newer"] == "local"


def test_compare_api_validates_offset(client, tmp_path, ftp_server):
    from tests.test_api import connect_ftp

    connect_ftp(client, ftp_server["port"])
    bad = client.post("/api/compare", json={"localPath": str(tmp_path), "remotePath": "/", "timeOffsetMinutes": 99999})
    assert bad.status_code == 400
    ok = client.post("/api/compare", json={"localPath": str(tmp_path), "remotePath": "/pub", "timeOffsetMinutes": "60"})
    assert ok.status_code == 200 and ok.get_json()["timeOffsetMinutes"] == 60


def test_dropbox_listing_converts_utc_to_local_time():
    from datetime import datetime, timezone
    from types import SimpleNamespace

    import file_service as files

    stamp = datetime(2026, 7, 1, 12, 0, 0)  # Dropbox SDK: saat dilimi olmayan UTC
    item = SimpleNamespace(name="r.pdf", size=5, server_modified=stamp, path_display="/r.pdf")
    dbx = SimpleNamespace(files_list_folder=lambda _p: SimpleNamespace(entries=[item], has_more=False))
    entry = files._list_dropbox(SimpleNamespace(dbx=dbx), "/")[0]
    expected = stamp.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None).isoformat(timespec="seconds")
    assert entry["modified"] == expected


@pytest.mark.filterwarnings("error::DeprecationWarning")
def test_ftp_list_fallback_marks_precision():
    from types import SimpleNamespace

    import file_service as files

    lines = ["-rw-r--r-- 1 u g 10 Nov 16 14:32 yeni.txt", "-rw-r--r-- 1 u g 10 Nov 16  2024 eski.txt"]

    def mlsd(*_a, **_k):
        raise Exception("500 MLSD not understood")

    ftp = SimpleNamespace(mlsd=mlsd, dir=lambda _p, cb: [cb(line) for line in lines])
    entries = {e["name"]: e for e in files._list_ftp(SimpleNamespace(ftp=ftp), "/")}
    assert entries["yeni.txt"]["mtimePrecision"] == 60
    assert entries["eski.txt"]["mtimePrecision"] == 86400



# ---------------------------------------------------------------- 3. sol paneldeki uzak bağlantı

def test_side_session_supports_editor_details_and_zip(client, ftp_server):
    import io
    import zipfile

    from tests.test_api import connect_ftp
    from tests.test_remote_to_remote import side_connect

    root = ftp_server["root"]
    (root / "sol").mkdir(exist_ok=True)
    (root / "sol" / "not.txt").write_text("merhaba", encoding="utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as bundle:
        bundle.writestr("icerik/a.txt", "A")
        bundle.writestr("b.txt", "B")
        bundle.writestr("../kacak.txt", "X")
    (root / "sol" / "paket.zip").write_bytes(buf.getvalue())

    connect_ftp(client, ftp_server["port"])
    left = side_connect(client, ftp_server["port"]).get_json()["sessionId"]
    try:
        read = client.post("/api/remote/read", json={"path": "/sol/not.txt", "sessionId": left})
        assert read.status_code == 200 and read.get_json()["content"] == "merhaba"
        wrote = client.post("/api/remote/write", json={"path": "/sol/not.txt", "content": "yeni", "sessionId": left})
        assert wrote.status_code == 200
        assert (root / "sol" / "not.txt").read_text(encoding="utf-8") == "yeni"
        info = client.post("/api/remote/info", json={"path": "/sol/not.txt", "sessionId": left})
        assert info.status_code == 200
        preview = client.post("/api/remote/preview", json={"path": "/sol/not.txt", "sessionId": left})
        assert preview.status_code in (200, 415)

        extracted = client.post("/api/extract", json={"side": "remote", "path": "/sol/paket.zip", "sessionId": left})
        assert extracted.status_code == 201, extracted.get_json()
        body = extracted.get_json()
        assert body["name"] == "paket" and body["files"] == 2 and body["skipped"] == 1
        assert (root / "sol" / "paket" / "icerik" / "a.txt").read_text() == "A"
        assert not (root / "kacak.txt").exists()
        # İkinci kez açınca var olan klasörün üzerine yazılmaz.
        again = client.post("/api/extract", json={"side": "remote", "path": "/sol/paket.zip", "sessionId": left})
        assert again.get_json()["name"] == "paket (1)"
        import app as backend
        relay = backend.transfers._relay_dir
        assert not relay.exists() or not any(relay.iterdir())
    finally:
        client.post("/api/side/disconnect", json={"sessionId": left})


def test_compare_between_two_remote_sessions(client, ftp_server):
    from tests.test_api import connect_ftp
    from tests.test_remote_to_remote import side_connect

    root = ftp_server["root"]
    for name in ("cmp-sol", "cmp-sag"):
        (root / name).mkdir(exist_ok=True)
    (root / "cmp-sol" / "ortak.txt").write_text("123", encoding="utf-8")
    (root / "cmp-sag" / "ortak.txt").write_text("12345", encoding="utf-8")
    (root / "cmp-sol" / "sadece-sol.txt").write_text("x", encoding="utf-8")
    right = connect_ftp(client, ftp_server["port"]).get_json()["sessionId"]
    left = side_connect(client, ftp_server["port"]).get_json()["sessionId"]
    try:
        compared = client.post("/api/compare", json={
            "localPath": "/cmp-sol", "leftSessionId": left, "remotePath": "/cmp-sag", "sessionId": right,
        })
        assert compared.status_code == 200, compared.get_json()
        body = compared.get_json()
        assert body["localPath"] == "/cmp-sol"
        statuses = {row["name"]: row["status"] for row in body["items"]}
        assert statuses == {"ortak.txt": "different", "sadece-sol.txt": "onlyLocal"}
    finally:
        client.post("/api/side/disconnect", json={"sessionId": left})


# ---------------------------------------------------------------- 4. akışlı uzaktan uzağa kopya

def test_stream_pipe_is_bounded_and_reports_source_errors():
    import threading

    import file_service as files

    pipe = files.StreamPipe(max_chunks=2)
    pipe.write(b"ab")
    pipe.write(b"cd")
    blocked = threading.Event()

    def writer():
        try:
            pipe.write(b"ef")  # kuyruk dolu: okuyan alana kadar bekler
            blocked.set()
            pipe.fail(ValueError("kaynak koptu"))
        except Exception:
            pass

    thread = threading.Thread(target=writer, daemon=True)
    thread.start()
    thread.join(0.3)
    assert not blocked.is_set()
    assert pipe.read(3) == b"abc"
    thread.join(2)
    assert blocked.is_set()
    assert pipe.read(1) == b"d"
    assert pipe.read(2) == b"ef"
    with pytest.raises(files.SourceFailed) as caught:
        pipe.read(1)
    assert isinstance(caught.value.original, ValueError)


def test_stream_pipe_abort_stops_writer():
    import file_service as files

    pipe = files.StreamPipe(max_chunks=1)
    pipe.write(b"x")
    pipe.abort()
    with pytest.raises(files._PipeAborted):
        pipe.write(b"y")


@pytest.fixture()
def copy_sessions(client, ftp_server):
    from tests.test_api import connect_ftp
    from tests.test_remote_to_remote import side_connect

    root = ftp_server["root"]
    for name in ("akis-kaynak", "akis-hedef"):
        (root / name).mkdir(exist_ok=True)
        for item in (root / name).iterdir():
            item.unlink()
    right = connect_ftp(client, ftp_server["port"]).get_json()["sessionId"]
    left = side_connect(client, ftp_server["port"]).get_json()["sessionId"]
    yield {"left": left, "right": right, "root": root}
    client.post("/api/side/disconnect", json={"sessionId": left})


def _copy(client, sessions, name, src="akis-kaynak", dst="akis-hedef", reverse=False, **extra):
    from tests.test_api import run_transfer

    source, target = ("right", "left") if reverse else ("left", "right")
    return run_transfer(client, {
        "direction": "copy", "name": name, "sourceDir": f"/{src}", "targetDir": f"/{dst}",
        "sourceSessionId": sessions[source], "sessionId": sessions[target], **extra,
    }, timeout=15)


def test_copy_streams_without_touching_disk(client, copy_sessions, monkeypatch):
    import file_service as files

    def no_disk(*_a, **_k):
        raise AssertionError("akışlı kopya yerel diske indirmemeli")

    monkeypatch.setattr(files, "download", no_disk)
    payload = os.urandom(3 * 1024 * 1024 + 17)
    (copy_sessions["root"] / "akis-kaynak" / "buyuk.bin").write_bytes(payload)
    status = _copy(client, copy_sessions, "buyuk.bin")
    assert status["status"] == "completed", status
    assert status["result"]["streamed"] is True
    assert status["transferred"] == status["total"] == len(payload)
    assert (copy_sessions["root"] / "akis-hedef" / "buyuk.bin").read_bytes() == payload

    (copy_sessions["root"] / "akis-kaynak" / "buyuk.bin").write_bytes(b"degisti")
    renamed = _copy(client, copy_sessions, "buyuk.bin", conflict="rename")
    assert renamed["status"] == "completed", renamed
    assert (copy_sessions["root"] / "akis-hedef" / "buyuk (1).bin").read_bytes() == b"degisti"


def test_copy_falls_back_to_relay_when_target_cannot_stream(client, copy_sessions, monkeypatch):
    import file_service as files

    monkeypatch.setattr(files, "can_stream_to", lambda _provider, _size: False)
    (copy_sessions["root"] / "akis-kaynak" / "drive.txt").write_text("drive", encoding="utf-8")
    status = _copy(client, copy_sessions, "drive.txt")
    assert status["status"] == "completed", status
    assert "streamed" not in status["result"]
    assert (copy_sessions["root"] / "akis-hedef" / "drive.txt").read_text(encoding="utf-8") == "drive"


def test_copy_reports_source_failure_mid_stream(client, copy_sessions, monkeypatch):
    import file_service as files

    real = files.open_stream_source

    def broken(conn, remote_dir, name):
        plan = real(conn, remote_dir, name)

        def run(source, sink, cancel_event):
            sink.write(b"yarim")
            raise files.FileServiceError("Kaynak bağlantısı koptu", 502, "network")

        return {**plan, "run": run}

    monkeypatch.setattr(files, "open_stream_source", broken)
    (copy_sessions["root"] / "akis-kaynak" / "kopuk.bin").write_bytes(b"x" * 1000)
    status = _copy(client, copy_sessions, "kopuk.bin")
    assert status["status"] == "error" and status["errorCode"] == "network", status


def test_copy_can_be_cancelled_mid_stream(client, copy_sessions, monkeypatch):
    import threading

    import app as backend
    import file_service as files

    real = files.open_stream_source
    release = threading.Event()

    def slow(conn, remote_dir, name):
        plan = real(conn, remote_dir, name)

        def run(source, sink, cancel_event):
            sink.write(b"a" * 1024)
            release.wait(5)
            files._check_cancel(cancel_event)
            sink.write(b"b" * 1024)

        return {**plan, "run": run}

    monkeypatch.setattr(files, "open_stream_source", slow)
    (copy_sessions["root"] / "akis-kaynak" / "iptal.bin").write_bytes(b"z" * 4096)
    started = client.post("/api/transfers", json={
        "direction": "copy", "name": "iptal.bin", "sourceDir": "/akis-kaynak", "targetDir": "/akis-hedef",
        "sourceSessionId": copy_sessions["left"], "sessionId": copy_sessions["right"],
    }).get_json()
    assert client.post(f"/api/transfers/{started['id']}/cancel", json={}).status_code == 200
    release.set()
    deadline = time.time() + 10
    while time.time() < deadline:
        status = backend.transfers.get(started["id"]).to_dict()
        if status["status"] != "transferring":
            break
        time.sleep(0.05)
    assert status["status"] == "cancelled", (status["error"], status["errorCode"])


def test_opposite_copies_do_not_deadlock(client, copy_sessions):
    import app as backend

    root = copy_sessions["root"]
    names = [f"f{i}.bin" for i in range(4)]
    for name in names:
        (root / "akis-kaynak" / name).write_bytes(os.urandom(200_000))
        (root / "akis-hedef" / f"r-{name}").write_bytes(os.urandom(200_000))
    jobs = []
    for name in names:
        jobs.append(client.post("/api/transfers", json={
            "direction": "copy", "name": name, "sourceDir": "/akis-kaynak", "targetDir": "/akis-hedef",
            "sourceSessionId": copy_sessions["left"], "sessionId": copy_sessions["right"],
        }).get_json()["id"])
        jobs.append(client.post("/api/transfers", json={
            "direction": "copy", "name": f"r-{name}", "sourceDir": "/akis-hedef", "targetDir": "/akis-kaynak",
            "sourceSessionId": copy_sessions["right"], "sessionId": copy_sessions["left"],
        }).get_json()["id"])
    deadline = time.time() + 30
    pending = set(jobs)
    while pending and time.time() < deadline:
        pending = {job for job in pending if backend.transfers.get(job).status == "transferring"}
        time.sleep(0.05)
    assert not pending, "ters yönlü kopyalar kilitlendi"
    assert all(backend.transfers.get(job).status == "completed" for job in jobs), [backend.transfers.get(j).to_dict() for j in jobs]


# ---------------------------------------------------------------- tarama: Dropbox indirme ilerlemesi/iptal

def test_dropbox_download_reports_progress_and_cancels(tmp_path):
    import threading
    from types import SimpleNamespace

    import file_service as files

    chunks = [b"a" * 10, b"b" * 10, b"c" * 10]
    closed = []

    class Response:
        def iter_content(self, chunk_size):
            yield from chunks

        def close(self):
            closed.append(True)

    dbx = SimpleNamespace(files_download=lambda _path: (SimpleNamespace(size=30), Response()))
    conn = SimpleNamespace(dbx=dbx)
    seen = []
    result = files.download(conn, "/", "veri.bin", str(tmp_path), progress_cb=lambda done, total: seen.append((done, total)))
    assert result["size"] == 30 and (tmp_path / "veri.bin").read_bytes() == b"a" * 10 + b"b" * 10 + b"c" * 10
    assert seen[0] == (10, 30) and closed

    cancel = threading.Event()

    def stop_after_first(done, _total):
        if done >= 10:
            cancel.set()

    with pytest.raises(files.TransferCancelled):
        files.download(conn, "/", "veri.bin", str(tmp_path), overwrite=True, progress_cb=stop_after_first, cancel_event=cancel)
    assert not (tmp_path / "veri.bin.cgpart").exists()


def test_api_token_is_checked(client, monkeypatch):
    import app as backend

    monkeypatch.setattr(backend, "API_TOKEN", "gizli")
    assert client.get("/api/health").status_code == 401
    assert client.get("/api/health", headers={"X-CyberGoose-Token": "yanlis"}).status_code == 401
    assert client.get("/api/health", headers={"X-CyberGoose-Token": "gizli"}).status_code == 200


# ---------------------------------------------------------------- yeni özellik 1: FTPS sertifika sabitleme

def _self_signed(tmp_path, name="ftps.test"):
    import datetime

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=30)).sign(key, hashes.SHA256()))
    cert_path, key_path = tmp_path / f"{name}.crt", tmp_path / f"{name}.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return cert_path, key_path, cert.public_bytes(serialization.Encoding.DER)


class _TinyFtpsServer:
    """Yalnızca AUTH TLS + giriş + PROT P konuşan küçük FTPS sunucusu (sertifika testleri için)."""

    def __init__(self, cert_path, key_path):
        import socket
        import ssl
        import threading

        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(cert_path, key_path)
        self.logins = []
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        import threading

        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        def send(line):
            conn.sendall((line + "\r\n").encode())

        reader = None
        try:
            send("220 hazir")
            reader = conn.makefile("rb")
            while True:
                line = reader.readline().decode().strip()
                if not line:
                    return
                cmd = line.split(" ")[0].upper()
                if cmd == "AUTH":
                    send("234 TLS")
                    conn = self.context.wrap_socket(conn, server_side=True)
                    reader = conn.makefile("rb")
                elif cmd == "USER":
                    send("331 parola")
                elif cmd == "PASS":
                    self.logins.append(line[5:])
                    send("230 tamam")
                elif cmd in ("PBSZ", "PROT"):
                    send("200 tamam")
                elif cmd == "QUIT":
                    send("221 gule gule")
                    return
                else:
                    send("502 yok")
        except Exception:
            return
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def close(self):
        self.sock.close()


def test_ftps_self_signed_certificate_is_pinned_after_confirmation(tmp_path, monkeypatch):
    from providers import ftp as ftp_provider
    from providers.sftp import UnknownHostKeyError

    monkeypatch.setattr(ftp_provider, "DATA_DIR", tmp_path)
    cert, key, der = _self_signed(tmp_path)
    server = _TinyFtpsServer(cert, key)
    try:
        expected = ftp_provider.cert_fingerprint(der)
        with pytest.raises(UnknownHostKeyError) as unknown:
            ftp_provider.FTPOperations("127.0.0.1", server.port, "demo", "gizli", tls=True)
        assert unknown.value.fingerprint == expected and unknown.value.key_type == "TLS"
        assert server.logins == []  # Parola onaydan önce gönderilmedi.

        conn = ftp_provider.FTPOperations("127.0.0.1", server.port, "demo", "gizli", tls=True, trusted_fingerprint=expected)
        conn.close()
        # Onaylanan parmak izi kaydedildi: sonraki bağlantılar (aktarım havuzu) sormadan açılır.
        ftp_provider.FTPOperations("127.0.0.1", server.port, "demo", "gizli", tls=True).close()
        assert server.logins == ["gizli", "gizli"]
    finally:
        server.close()

    cert2, key2, _ = _self_signed(tmp_path, "baska.test")
    other = _TinyFtpsServer(cert2, key2)
    try:
        pins = json.loads((tmp_path / "ftps_certs.json").read_text())
        pins[f"127.0.0.1:{other.port}"] = expected  # aynı adreste eski sertifika kayıtlı
        (tmp_path / "ftps_certs.json").write_text(json.dumps(pins))
        with pytest.raises(ftp_provider.CertificateChangedError):
            ftp_provider.FTPOperations("127.0.0.1", other.port, "demo", "gizli", tls=True, trusted_fingerprint=expected)
        assert other.logins == []
    finally:
        other.close()


def test_ftps_errors_map_to_host_key_flow():
    from providers.ftp import CertificateChangedError
    from providers.sftp import UnknownHostKeyError
    from services.session_manager import describe_connect_error

    unknown = describe_connect_error(UnknownHostKeyError("h", "TLS", "SHA256:AA"), "h", "FTPS")
    assert unknown.status == 409 and unknown.code == "host_key_unknown" and unknown.extra["hostKey"]["type"] == "TLS"
    changed = describe_connect_error(CertificateChangedError("h", "a", "b"), "h", "FTPS")
    assert changed.status == 502 and changed.code == "host_key_changed"
