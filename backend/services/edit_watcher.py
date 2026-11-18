"""Uzak dosyayı bilgisayardaki bir düzenleyicide açma ve kaydedince geri yükleme.

Dosya veri klasöründeki `edits/<kimlik>/` altına indirilir, Electron onu varsayılan
uygulamayla açar. Arka plandaki iş parçacığı dosyanın değiştirilme zamanını ve boyutunu
izler; kayıt bittiğinde (iki ardışık kontrolde değişmemişse) dosya aktarım bağlantısıyla
sunucuya yüklenir. Düzenleme kapatılınca geçici kopya silinir.

Uygulama çökerse ya da kapatılmadan sonlanırsa klasörler kalır. Açılışta `cleanup_stale`
bunları temizler: her klasörde indirme anındaki imzayı tutan `.cg-edit.json` vardır. Dosya
indirildiği gibi duruyorsa (ya da son yüklemeden sonra değişmediyse) klasör hemen silinir.
Yüklenmemiş değişiklik içeren klasör veri kaybı olmasın diye `STALE_KEEP_DAYS` gün tutulur.
"""
from __future__ import annotations

import json
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
MANIFEST = ".cg-edit.json"
STALE_KEEP_DAYS = 7


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


def _write_manifest(edit: ExternalEdit) -> None:
    """Klasöre son yüklenen (ya da indirilen) imzayı yazar; açılış temizliği buna bakar."""
    data = {"remotePath": edit.remote_path, "name": Path(edit.local_path).name, "signature": list(edit.signature)}
    try:
        (Path(edit.local_path).parent / MANIFEST).write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        logger.debug("Düzenleme bilgisi yazılamadı", exc_info=True)


def _has_unsynced_changes(folder: Path) -> bool:
    """Klasördeki dosya son bilinen imzadan farklıysa (yüklenmemiş değişiklik) True."""
    try:
        data = json.loads((folder / MANIFEST).read_text(encoding="utf-8"))
        name = Path(str(data["name"])).name
        expected = tuple(data["signature"])
    except (OSError, ValueError, KeyError, TypeError):
        # Eski sürümden kalan ya da bozuk klasör: içinde dosya varsa temkinli davranılır.
        return any(child.is_file() and child.name != MANIFEST for child in folder.iterdir())
    current = _signature(str(folder / name))
    return current is not None and (current[0], current[1]) != (float(expected[0]), int(expected[1]))


def cleanup_stale(base_dir: str | Path, keep_days: float = STALE_KEEP_DAYS, now: float | None = None) -> dict:
    """Önceki çalıştırmadan kalan düzenleme klasörlerini siler.

    Dönüş: `{"removed": n, "kept": n}`. Yüklenmemiş değişikliği olan klasör `keep_days`
    günden yeniyse tutulur (kullanıcı dosyayı kurtarabilsin), daha eskiyse silinir.
    """
    base = Path(base_dir)
    removed = kept = 0
    if not base.is_dir():
        return {"removed": 0, "kept": 0}
    now = time.time() if now is None else now
    for folder in base.iterdir():
        if not folder.is_dir():
            continue
        try:
            dirty = _has_unsynced_changes(folder)
            age = now - max((child.stat().st_mtime for child in folder.iterdir()), default=folder.stat().st_mtime)
        except OSError:
            dirty, age = False, 0.0
        if dirty and age < keep_days * 86400:
            kept += 1
            logger.warning("Yüklenmemiş harici düzenleme korunuyor: %s", folder)
            continue
        shutil.rmtree(folder, ignore_errors=True)
        removed += 1
    return {"removed": removed, "kept": kept}


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
        # Uygulama tek örnek çalışır: bu noktada açık düzenleme yoktur, kalanlar çökme artığıdır.
        self.startup_cleanup = cleanup_stale(self._base)

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
        _write_manifest(edit)
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
            _write_manifest(edit)
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
