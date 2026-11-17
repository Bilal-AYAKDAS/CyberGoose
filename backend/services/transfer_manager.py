"""Asenkron aktarım kuyruğu, iş yaşam döngüsü ve aktarım bağlantı havuzu.

Aktarımlar paneldeki bağlantıyı ve oturum kilidini kullanmaz:

* FTP/FTPS/SFTP ve Google Drive için her oturuma ait küçük bir bağlantı havuzu tutulur.
  İş havuzdan bağlantı alır, bitince geri bırakır. Böylece bir klasördeki yüzlerce dosya
  için her seferinde yeniden oturum açılmaz ve panel listeleme yapmaya devam edebilir.
* Dropbox ve OneDrive istemcileri HTTP tabanlı ve iş parçacığı güvenli olduğundan paylaşılır.
"""
from __future__ import annotations

import logging
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field

import file_service as files

logger = logging.getLogger(__name__)


@dataclass
class TransferJob:
    id: str
    session_id: int
    status: str = "transferring"
    transferred: int = 0
    total: int | None = None
    error: str | None = None
    error_code: str | None = None
    result: dict | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "status": self.status,
            "transferred": self.transferred,
            "total": self.total,
            "error": self.error,
            "errorCode": self.error_code,
            "result": self.result,
        }


def _is_alive(conn) -> bool:
    try:
        if getattr(conn, "sftp", None) is not None:
            transport = conn.client.get_transport()
            return transport is not None and transport.is_active()
        if getattr(conn, "ftp", None) is not None:
            conn.ftp.voidcmd("NOOP")
            return True
    except Exception:
        return False
    return True


def _still_usable(conn, exc) -> bool:
    """Hata sonrası bağlantı yeniden kullanılabilir mi? İptalde veri kanalı yarım kalmıştır.

    FTP'de aktarım ortasındaki bir hata okunmamış yanıt bırakabilir; yalnızca aktarım hiç
    başlamadan dönen "zaten var" / "bulunamadı" hataları güvenlidir.
    """
    if isinstance(exc, files.TransferCancelled) or not isinstance(exc, files.FileServiceError):
        return False
    if getattr(conn, 'ftp', None) is not None:
        return exc.code in ('exists',) or exc.status == 404
    return exc.status < 500


def _close_quietly(conn) -> None:
    try:
        if hasattr(conn, "close"):
            conn.close()
    except Exception:
        logger.debug("Aktarım bağlantısı kapatılamadı", exc_info=True)


class ConnectionPool:
    """Oturum başına boşta bekleyen aktarım bağlantıları."""

    MAX_IDLE_PER_SESSION = 2

    def __init__(self):
        self._idle: dict[int, list] = {}
        self._lock = threading.Lock()

    @contextmanager
    def borrow(self, snapshot):
        if snapshot.factory is None:
            if snapshot.closed:
                raise files.FileServiceError(
                    "Bu aktarımın bağlantısı kapandı. Bağlantıyı yeniden açıp tekrar deneyin.", 409, "session_closed"
                )
            yield snapshot.shared
            return
        limit = snapshot.limit
        if limit is not None:
            limit.acquire()
        try:
            conn = self._take_idle(snapshot)
            if conn is None:
                conn = snapshot.factory()
            healthy = False
            try:
                yield conn
                healthy = True
            except (files.TransferCancelled, files.FileServiceError) as exc:
                healthy = _still_usable(conn, exc)
                raise
            finally:
                self._release(snapshot, conn, healthy)
        finally:
            if limit is not None:
                limit.release()

    def _take_idle(self, snapshot):
        """Boştaki bağlantıyı alır. Sağlık kontrolü (ağ) kilit dışında yapılır."""
        while True:
            with self._lock:
                idle = self._idle.get(snapshot.id)
                if not idle:
                    return None
                candidate = idle.pop()
            if _is_alive(candidate):
                return candidate
            _close_quietly(candidate)

    def _release(self, snapshot, conn, healthy: bool) -> None:
        if healthy:
            with self._lock:
                # Oturum bu arada kapandıysa bağlantı havuza geri konmaz (sızıntı olmasın).
                idle = self._idle.setdefault(snapshot.id, []) if not snapshot.closed else None
                if idle is not None and len(idle) < self.MAX_IDLE_PER_SESSION:
                    idle.append(conn)
                    return
        _close_quietly(conn)

    def close_idle(self, keep_session: int | None = None) -> None:
        with self._lock:
            doomed = [(sid, conns) for sid, conns in self._idle.items() if sid != keep_session]
            for sid, _ in doomed:
                self._idle.pop(sid, None)
        for _, conns in doomed:
            for conn in conns:
                _close_quietly(conn)


class TransferManager:
    MAX_HISTORY = 200
    MAX_PARALLEL = 4

    def __init__(self, session_manager):
        self._sessions = session_manager
        self._jobs: dict[str, TransferJob] = {}
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(self.MAX_PARALLEL)
        self.pool = ConnectionPool()

    def _prune_finished(self) -> None:
        if len(self._jobs) <= self.MAX_HISTORY:
            return
        finished = [jid for jid, job in self._jobs.items() if job.status != "transferring"]
        for jid in finished[: max(0, len(self._jobs) - self.MAX_HISTORY)]:
            self._jobs.pop(jid, None)

    def close_idle(self) -> None:
        """Oturum kapanırken boştaki aktarım bağlantılarını kapatır (çalışan işler sürer)."""
        self.pool.close_idle()

    def run_with_connection(self, session_id, func):
        """Panel kilidini tutmadan, oturumun aktarım bağlantısıyla `func(conn)` çalıştırır."""
        snapshot = self._sessions.snapshot(session_id)
        with self.pool.borrow(snapshot) as conn:
            return func(conn)

    def start(self, direction: str, name: str, local_dir: str, remote_dir: str, overwrite: bool = False,
              session_id=None, resume: bool = False, conflict: str | None = None) -> TransferJob:
        snapshot = self._sessions.snapshot(session_id)
        job = TransferJob(id=str(uuid.uuid4()), session_id=snapshot.id)
        with self._lock:
            self._prune_finished()
            self._jobs[job.id] = job

        def on_progress(done: int, total: int | None) -> None:
            with self._lock:
                job.transferred = done
                if total is not None:
                    job.total = total

        def finish(status: str, error: str | None = None, code: str | None = None, result: dict | None = None) -> None:
            with self._lock:
                job.status = status
                job.error = error
                job.error_code = code
                if result is not None:
                    job.result = result
                    job.transferred = result["size"]
                    job.total = result["size"]

        def run_job() -> None:
            with self._slots:
                try:
                    if job.cancel_event.is_set():
                        raise files.TransferCancelled()
                    with self.pool.borrow(snapshot) as conn:
                        if direction == "upload":
                            res = files.upload(
                                conn, local_dir, name, remote_dir, overwrite,
                                progress_cb=on_progress, cancel_event=job.cancel_event, resume=resume, conflict=conflict,
                            )
                        else:
                            res = files.download(
                                conn, remote_dir, name, local_dir, overwrite,
                                progress_cb=on_progress, cancel_event=job.cancel_event, resume=resume, conflict=conflict,
                            )
                    finish("completed", result=res)
                except files.TransferCancelled:
                    finish("cancelled", "Aktarım iptal edildi", "cancelled")
                except files.FileServiceError as exc:
                    finish("error", exc.message, exc.code)
                except Exception as exc:
                    logger.exception("Aktarım beklenmedik şekilde başarısız oldu")
                    finish("error", "Aktarım başarısız oldu", type(exc).__name__)

        threading.Thread(target=run_job, daemon=True, name=f"transfer-{job.id[:8]}").start()
        return job

    def get(self, job_id: str) -> TransferJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> TransferJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.cancel_event.set()
            return job
