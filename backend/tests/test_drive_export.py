"""Google Drive indirmesi: Google belgelerinin dışa aktarılması, Windows'ta geçersiz adlar, hata ayrıntısı."""
import pytest

import file_service


class FakeRequest:
    def __init__(self, kind, file_id, mime=None, payload=b"veri"):
        self.kind, self.file_id, self.mime, self.payload = kind, file_id, mime, payload


class FakeFiles:
    def __init__(self):
        self.calls = []

    def export_media(self, fileId, mimeType):
        self.calls.append(("export", fileId, mimeType))
        return FakeRequest("export", fileId, mimeType, b"PK-docx")

    def get_media(self, fileId):
        self.calls.append(("get", fileId))
        return FakeRequest("get", fileId, None, b"ham-veri")


class FakeService:
    def __init__(self):
        self._files = FakeFiles()

    def files(self):
        return self._files


class FakeDownload:
    def __init__(self, handle, request):
        if isinstance(request.payload, Exception):
            raise request.payload
        self.handle, self.request = handle, request

    def next_chunk(self):
        self.handle.write(self.request.payload)
        return None, True


class FakeDrive:
    def __init__(self):
        self.service = FakeService()


@pytest.fixture()
def drive(monkeypatch):
    import googleapiclient.http

    monkeypatch.setattr(googleapiclient.http, "MediaIoBaseDownload", FakeDownload)
    monkeypatch.setattr(file_service, "provider_of", lambda _conn: "drive")
    monkeypatch.setattr(file_service, "_drive_resolve_folder", lambda _s, _p: "root")
    conn = FakeDrive()
    return conn


def _found(monkeypatch, mime, file_id="f1"):
    monkeypatch.setattr(file_service, "_drive_find_file", lambda _s, _f, _n: {"id": file_id, "mimeType": mime})


@pytest.mark.parametrize("mime, ext", [
    ("application/vnd.google-apps.document", ".docx"),
    ("application/vnd.google-apps.spreadsheet", ".xlsx"),
    ("application/vnd.google-apps.presentation", ".pptx"),
    ("application/vnd.google-apps.drawing", ".pdf"),
])
def test_google_documents_are_exported(drive, monkeypatch, tmp_path, mime, ext):
    _found(monkeypatch, mime)
    result = file_service.download(drive, "/", "SOAP 1.2 örnek istek", str(tmp_path))
    target = tmp_path / f"SOAP 1.2 örnek istek{ext}"
    assert target.read_bytes() == b"PK-docx"
    assert result["to"] == str(target)
    assert result["renamedTo"] == target.name
    assert result["exportedAs"] == ext.lstrip(".")
    assert drive.service.files().calls[0][0] == "export"
    assert drive.service.files().calls[0][2] == file_service.DRIVE_EXPORTS[mime][0]


def test_regular_drive_file_is_downloaded_unchanged(drive, monkeypatch, tmp_path):
    _found(monkeypatch, "application/pdf")
    result = file_service.download(drive, "/", "rapor.pdf", str(tmp_path))
    assert (tmp_path / "rapor.pdf").read_bytes() == b"ham-veri"
    assert result["renamedTo"] is None and "exportedAs" not in result
    assert drive.service.files().calls == [("get", "f1")]


def test_existing_extension_is_not_doubled(drive, monkeypatch, tmp_path):
    _found(monkeypatch, "application/vnd.google-apps.spreadsheet")
    file_service.download(drive, "/", "Bütçe.xlsx", str(tmp_path))
    assert (tmp_path / "Bütçe.xlsx").is_file()


def test_drive_api_error_detail_reaches_the_user(drive, monkeypatch, tmp_path):
    _found(monkeypatch, "application/vnd.google-apps.document")

    class HttpError(Exception):
        content = b'{"error": {"message": "This file is too large to be exported."}}'

    monkeypatch.setattr(FakeFiles, "export_media", lambda self, fileId, mimeType: FakeRequest("export", fileId, mimeType, HttpError("403")))
    with pytest.raises(file_service.FileServiceError) as exc:
        file_service.download(drive, "/", "Büyük belge", str(tmp_path))
    assert "too large to be exported" in exc.value.message
    assert not any(tmp_path.iterdir())


@pytest.mark.parametrize("name, expected", [
    ('SOAP 1.2: istek "örnek"?', "SOAP 1.2_ istek _örnek__"),
    ("a<b>c|d*e", "a_b_c_d_e"),
    ("rapor. ", "rapor"),
    ("CON.txt", "_CON.txt"),
    ("nul", "_nul"),
    ("satır\nsonu", "satır_sonu"),
    ("", "_"),
])
def test_safe_local_name_on_windows(name, expected):
    assert file_service.safe_local_name(name, windows=True) == expected


def test_safe_local_name_shortens_long_names_keeping_extension():
    long_name = "x" * 400 + ".docx"
    shortened = file_service.safe_local_name(long_name, windows=True)
    assert len(shortened) == file_service.MAX_LOCAL_NAME
    assert shortened.endswith(".docx")
    assert file_service.safe_local_name("a:b", windows=False) == "a:b"


def test_download_writes_windows_safe_name(drive, monkeypatch, tmp_path):
    _found(monkeypatch, "text/plain")
    original = file_service.safe_local_name
    monkeypatch.setattr(file_service, "safe_local_name", lambda name: original(name, windows=True))
    result = file_service.download(drive, "/", "Not: neden?", str(tmp_path))
    assert (tmp_path / "Not_ neden_").read_bytes() == b"ham-veri"
    assert result["renamedTo"] == "Not_ neden_"


def test_long_path_prefix_only_on_windows(monkeypatch):
    from pathlib import PureWindowsPath

    assert file_service._long_path(file_service.Path("kisa")) == file_service.Path("kisa")
    assert file_service._plain_path("\\\\?\\C:\\uzun\\yol") == "C:\\uzun\\yol"
    assert file_service._plain_path("\\\\?\\UNC\\sunucu\\pay\\a") == "\\\\sunucu\\pay\\a"
    assert file_service._plain_path(PureWindowsPath("C:/a")) == "C:\\a"


def test_local_write_error_names_the_file(drive, monkeypatch, tmp_path):
    _found(monkeypatch, "text/plain")
    original_open = file_service.Path.open

    def failing_open(self, mode="r", *args, **kwargs):
        if str(self).endswith(".cgpart") and "w" in mode:
            raise OSError(22, "Invalid argument", str(self))
        return original_open(self, mode, *args, **kwargs)

    monkeypatch.setattr(file_service.Path, "open", failing_open)
    with pytest.raises(file_service.FileServiceError) as exc:
        file_service.download(drive, "/", "dosya.txt", str(tmp_path))
    assert exc.value.code == "local_write_failed"
    assert "Invalid argument" in exc.value.message and "dosya.txt" in exc.value.message
