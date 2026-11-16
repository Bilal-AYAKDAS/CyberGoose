"""Asenkron aktarım kuyruğu ve iş yaşam döngüsü yönetimi."""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field

import file_service as files


@dataclass
class TransferJob:
    id: str
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
            "status": self.status,
            "transferred": self.transferred,
            "total": self.total,
            "error": self.error,
            "errorCode": self.error_code,
            "result": self.result,
        }


class TransferManager:
    def __init__(self, session_manager):
        self._sessions = session_manager
        self._jobs: dict[str, TransferJob] = {}
        self._lock = threading.Lock()

    def start(self, direction: str, name: str, local_dir: str, remote_dir: str, overwrite: bool = False) -> TransferJob:
        if self._sessions.state.connection is None:
            raise files.FileServiceError("Uzak bağlantı yok. Önce bir bağlantı açın.", 409, "not_connected")
        job = TransferJob(id=str(uuid.uuid4()))
        with self._lock:
            self._jobs[job.id] = job

        def on_progress(done: int, total: int | None) -> None:
            with self._lock:
                job.transferred = done
                if total is not None:
                    job.total = total

        def run_job() -> None:
            try:
                with self._sessions.lock:
                    conn = self._sessions.state.connection
                    if direction == "upload":
                        res = files.upload(
                            conn, local_dir, name, remote_dir, overwrite,
                            progress_cb=on_progress, cancel_event=job.cancel_event,
                        )
                    else:
                        res = files.download(
                            conn, remote_dir, name, local_dir, overwrite,
                            progress_cb=on_progress, cancel_event=job.cancel_event,
                        )
                with self._lock:
                    job.status = "completed"
                    job.transferred = res["size"]
                    job.total = res["size"]
                    job.result = res
            except files.TransferCancelled:
                with self._lock:
                    job.status = "cancelled"
                    job.error = "Aktarım iptal edildi"
                    job.error_code = "cancelled"
            except files.FileServiceError as exc:
                with self._lock:
                    job.status = "error"
                    job.error = exc.message
                    job.error_code = exc.code
            except Exception as exc:
                with self._lock:
                    job.status = "error"
                    job.error = "Aktarım başarısız oldu"
                    job.error_code = type(exc).__name__

        threading.Thread(target=run_job, daemon=True).start()
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
