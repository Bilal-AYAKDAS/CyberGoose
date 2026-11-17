"""Uzak dosyayı bilgisayardaki bir düzenleyicide açma ve kaydedince geri yükleme.

Dosya veri klasöründeki `edits/<kimlik>/` altına indirilir, Electron onu varsayılan
uygulamayla açar. Arka plandaki iş parçacığı dosyanın değiştirilme zamanını ve boyutunu
izler; kayıt bittiğinde (iki ardışık kontrolde değişmemişse) dosya aktarım bağlantısıyla
sunucuya yüklenir. Düzenleme kapatılınca geçici kopya silinir.
"""
from __future__ import annotations

import logging
import posixpath
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import file_service as files

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0
MAX_WATCHED = 32


@dataclass
class ExternalEdit:
    id: str
    session_id: int
    remote_path: str
    local_path: str
    signature: tuple[float, int]
    pending: tuple[float, int] | None = None
    uploads: int = 0
    last_upload: float | None = None
    error: str | None = None
    uploading: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "remotePath": self.remote_path,
            "localPath": self.local_path,
            "name": posixpath.basename(self.remote_path),
            "uploads": self.uploads,
            "lastUpload": self.last_upload,
            "error": self.error,
            "uploading": self.uploading,
        }


def _signature(path: str) -> tuple[float, int] | None:
    try:
        info = Path(path).stat()
    except OSError:
        return None
    return (info.st_mtime, info.st_size)


class EditWatcher:
    def __init__(self, transfers, base_dir: str | Path, poll_seconds: float = POLL_SECONDS, autostart: bool = True):
        self._transfers = transfers
        self._base = Path(base_dir)
        self._edits: dict[str, ExternalEdit] = {}
        self._lock = threading.Lock()
        self._poll = poll_seconds
        self._stop = threading.Event()
        self._thread = None
        self._autostart = autostart

    # ------------------------------------------------------------ yaşam döngüsü

    def _ensure_thread(self) -> None:
        if not self._autostart or (self._thread and self._thread.is_alive()):
            return
        self._thread = threading.Thread(target=self._loop, daemon=True, name="external-edit-watcher")
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.wait(self._poll):
            self.check_all()

    def list(self) -> list[dict]:
        with self._lock:
            return [edit.to_dict() for edit in self._edits.values()]

    def open(self, session_id, remote_path: str) -> dict:
        remote_file = files.normalize_remote(remote_path)
        if remote_file == "/":
            raise files.FileServiceError("Dosya yolu gerekli", 400)
        snapshot = self._transfers._sessions.snapshot(session_id)
        with self._lock:
            for edit in self._edits.values():
                if edit.session_id == snapshot.id and edit.remote_path == remote_file:
                    return edit.to_dict()  # Aynı dosya zaten açık: yeni kopya indirilmez.
            if len(self._edits) >= MAX_WATCHED:
                raise files.FileServiceError(
                    f"En fazla {MAX_WATCHED} dosya aynı anda düzenlenebilir. Bitenleri kapatın.", 409, "too_many_edits",
                )
        edit_id = uuid.uuid4().hex[:12]
        folder = self._base / edit_id
        folder.mkdir(parents=True, exist_ok=True)
        name = posixpath.basename(remote_file)
        try:
            self._transfers.run_with_connection(
                snapshot.id, lambda conn: files.download(conn, posixpath.dirname(remote_file) or "/", name, str(folder), overwrite=True),
            )
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        local_path = str(folder / name)
        edit = ExternalEdit(edit_id, snapshot.id, remote_file, local_path, _signature(local_path) or (0.0, 0))
        with self._lock:
            self._edits[edit_id] = edit
        self._ensure_thread()
        return edit.to_dict()

    def close(self, edit_id: str) -> bool:
        with self._lock:
            edit = self._edits.pop(edit_id, None)
        if edit is None:
            return False
        shutil.rmtree(Path(edit.local_path).parent, ignore_errors=True)
        return True

    def close_all(self) -> None:
        with self._lock:
            ids = list(self._edits)
        for edit_id in ids:
            self.close(edit_id)
        self._stop.set()

    # ------------------------------------------------------------ izleme

    def check_all(self) -> None:
        with self._lock:
            edits = list(self._edits.values())
        for edit in edits:
            try:
                self.check(edit.id)
            except Exception:
                logger.exception("Harici düzenleme kontrolü başarısız")

    def check(self, edit_id: str, settle: bool = True) -> dict | None:
        """Değişiklik varsa yükler. `settle=False` yazma bitmesini beklemeden yükler (testler için)."""
        with self._lock:
            edit = self._edits.get(edit_id)
        if edit is None:
            return None
        current = _signature(edit.local_path)
        if current is None or current == edit.signature:
            edit.pending = None
            return edit.to_dict()
        if settle and edit.pending != current:
            # Düzenleyici dosyayı parça parça yazıyor olabilir: bir sonraki kontrolde aynıysa yüklenir.
            edit.pending = current
            return edit.to_dict()
        if not edit.lock.acquire(blocking=False):
            return edit.to_dict()
        try:
            edit.uploading = True
            folder, name = str(Path(edit.local_path).parent), Path(edit.local_path).name
            remote_dir = posixpath.dirname(edit.remote_path) or "/"
            self._transfers.run_with_connection(
                edit.session_id, lambda conn: files.upload(conn, folder, name, remote_dir, overwrite=True),
            )
            edit.signature = current
            edit.pending = None
            edit.uploads += 1
            edit.last_upload = time.time()
            edit.error = None
        except files.FileServiceError as exc:
            edit.error = exc.message
        except Exception as exc:  # noqa: BLE001 - hata kullanıcıya gösterilir
            edit.error = f"Yüklenemedi: {exc}"
        finally:
            edit.uploading = False
            edit.lock.release()
        return edit.to_dict()
