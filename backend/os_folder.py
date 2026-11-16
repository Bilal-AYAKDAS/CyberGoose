"""Yerel dosya inceleme: boyut, tarih, izin, SHA-256 ve sınırlı metin önizleme."""
import hashlib
import mimetypes
from datetime import datetime
from pathlib import Path

MAX_PREVIEW_BYTES = 64 * 1024
TEXT_EXTENSIONS = {
    ".cfg", ".css", ".csv", ".html", ".ini", ".js", ".json", ".log",
    ".md", ".py", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
}


def inspect_file(file_path):
    path = Path(file_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(str(path))
    if not path.is_file():
        raise IsADirectoryError(str(path))

    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)

    mime_type, _ = mimetypes.guess_type(path.name)
    is_text = path.suffix.lower() in TEXT_EXTENSIONS or bool(mime_type and mime_type.startswith("text/"))
    preview = None
    preview_truncated = False
    if is_text:
        with path.open("rb") as file:
            content = file.read(MAX_PREVIEW_BYTES + 1)
        preview_truncated = len(content) > MAX_PREVIEW_BYTES
        preview = content[:MAX_PREVIEW_BYTES].decode("utf-8", errors="replace")

    stat = path.stat()
    return {
        "FileName": path.name,
        "FilePath": str(path),
        "Type": "File",
        "Size": stat.st_size,
        "Change": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "filemod": oct(stat.st_mode)[-3:],
        "sha256": digest.hexdigest(),
        "preview": preview,
        "previewTruncated": preview_truncated,
    }
