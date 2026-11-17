"""Yerel dosya inceleme: boyut, tarih, izin, SHA-256 ve sınırlı metin önizleme."""
import hashlib
import mimetypes
from datetime import datetime
from pathlib import Path

MAX_PREVIEW_BYTES = 64 * 1024
# Çok büyük dosyada SHA-256 hesaplamak saniyeler sürer ve isteği bekletir; bu sınırın üstünde atlanır.
MAX_HASH_BYTES = 1024 * 1024 * 1024
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

    sha256 = None
    if path.stat().st_size <= MAX_HASH_BYTES:
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        sha256 = digest.hexdigest()

    mime_type, _ = mimetypes.guess_type(path.name)
    is_text = path.suffix.lower() in TEXT_EXTENSIONS or bool(mime_type and mime_type.startswith("text/"))
    preview = None
    preview_truncated = False
    if is_text:
        with path.open("rb") as file:
            content = file.read(MAX_PREVIEW_BYTES + 1)
        preview_truncated = len(content) > MAX_PREVIEW_BYTES
        if b"\x00" in content[:8192]:
            preview = None
        else:
            try:
                preview = content[:MAX_PREVIEW_BYTES].decode("utf-8")
            except UnicodeDecodeError as error:
                # Kesilen çok baytlı karakter değilse Türkçe Windows kodlaması dene.
                if error.start >= MAX_PREVIEW_BYTES - 4:
                    preview = content[:error.start].decode("utf-8")
                else:
                    preview = content[:MAX_PREVIEW_BYTES].decode("cp1254", errors="replace")

    stat = path.stat()
    return {
        "FileName": path.name,
        "FilePath": str(path),
        "Type": "File",
        "Size": stat.st_size,
        "Change": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "filemod": oct(stat.st_mode)[-3:],
        "sha256": sha256,
        "preview": preview,
        "previewTruncated": preview_truncated,
    }
