"""Asenkron aktarım kuyruğu, iş yaşam döngüsü ve aktarım bağlantı havuzu.

Aktarımlar paneldeki bağlantıyı ve oturum kilidini kullanmaz:

* FTP/FTPS/SFTP ve Google Drive için her oturuma ait küçük bir bağlantı havuzu tutulur.
  İş havuzdan bağlantı alır, bitince geri bırakır. Böylece bir klasördeki yüzlerce dosya
  için her seferinde yeniden oturum açılmaz ve panel listeleme yapmaya devam edebilir.
* Dropbox ve OneDrive istemcileri HTTP tabanlı ve iş parçacığı güvenli olduğundan paylaşılır.
"""
from __future__ import annotations

import logging
import posixpath
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
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
    def borrow(self, snapshot, use_limit: bool = True):
        """`use_limit=False`: çağıran sunucu sınırını (`snapshot.limit`) zaten almıştır."""
        if snapshot.factory is None:
            if snapshot.closed:
                raise files.FileServiceError(
                    "Bu aktarımın bağlantısı kapandı. Bağlantıyı yeniden açıp tekrar deneyin.", 409, "session_closed"
                )
            yield snapshot.shared
            return
        limit = snapshot.limit if use_limit else None
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

    def close_session(self, session_id: int) -> None:
        """Kapatılan oturumun (ör. sol panel bağlantısı) boştaki bağlantılarını kapatır."""
        with self._lock:
            conns = self._idle.pop(session_id, [])
        for conn in conns:
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

    def __init__(self, session_manager, relay_dir=None):
        self._sessions = session_manager
        # Uzaktan uzağa kopyada dosya bu klasörde kısa süre tutulur (indir → yükle).
        self._relay_dir = Path(relay_dir) if relay_dir else Path(tempfile.gettempdir()) / "cybergoose-relay"
        # Önceki çalıştırmada (çökme) kalmış geçici kopyalar silinir; uygulama tek örnek çalışır.
        shutil.rmtree(self._relay_dir, ignore_errors=True)
        self._jobs: dict[str, TransferJob] = {}
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(self.MAX_PARALLEL)
        # Akışlı kopya iki sunucu yuvasını birlikte tutar. Yuvalar bu kilit altında topluca alınır;
        # aksi halde ters yönlü iki kopya birbirinin yuvasını bekleyip kilitlenebilir.
        self._limit_gate = threading.Lock()
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

    def _launch(self, session_id: int, work) -> TransferJob:
        """İşi kaydeder ve arka planda `work(on_progress, cancel_event)` çalıştırır."""
        job = TransferJob(id=str(uuid.uuid4()), session_id=session_id)
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
                    finish("completed", result=work(on_progress, job.cancel_event))
                except files.TransferCancelled:
                    finish("cancelled", "Aktarım iptal edildi", "cancelled")
                except files.FileServiceError as exc:
                    finish("error", exc.message, exc.code)
                except Exception as exc:
                    logger.exception("Aktarım beklenmedik şekilde başarısız oldu")
                    detail = (str(exc) or type(exc).__name__)[:300]
                    finish("error", f"Aktarım başarısız oldu: {detail}", type(exc).__name__)

        threading.Thread(target=run_job, daemon=True, name=f"transfer-{job.id[:8]}").start()
        return job

    def start(self, direction: str, name: str, local_dir: str, remote_dir: str, overwrite: bool = False,
              session_id=None, resume: bool = False, conflict: str | None = None) -> TransferJob:
        snapshot = self._sessions.snapshot(session_id)

        def work(on_progress, cancel_event):
            with self.pool.borrow(snapshot) as conn:
                if direction == "upload":
                    return files.upload(
                        conn, local_dir, name, remote_dir, overwrite,
                        progress_cb=on_progress, cancel_event=cancel_event, resume=resume, conflict=conflict,
                    )
                return files.download(
                    conn, remote_dir, name, local_dir, overwrite,
                    progress_cb=on_progress, cancel_event=cancel_event, resume=resume, conflict=conflict,
                )

        return self._launch(snapshot.id, work)

    @contextmanager
    def _both_limits(self, source, target):
        """Kaynak ve hedef sunucu yuvalarını kilitlenme olmadan birlikte alır."""
        limits = [snap.limit for snap in (source, target) if snap.factory is not None and snap.limit is not None]
        taken = []
        try:
            with self._limit_gate:
                for limit in limits:
                    limit.acquire()
                    taken.append(limit)
            yield
        finally:
            for limit in taken:
                limit.release()

    def start_copy(self, name: str, source_dir: str, target_dir: str, source_session_id, target_session_id,
                   overwrite: bool = False, conflict: str | None = None) -> TransferJob:
        """Uzaktan uzağa kopya (SFTP→SFTP, FTP→Dropbox...).

        Veri diske yazılmadan akar: bir iş parçacığı kaynaktan okuyup sınırlı bir bellek kanalına
        yazar, iş hedefe yükler (en fazla birkaç MB bellekte bekler). Hedef Google Drive ise ya da
        OneDrive'a boyutu bilinmeyen bir dosya (Google belgesi) gidiyorsa eski yönteme düşülür:
        geçici klasöre indir, yükle, sil. Hedefteki çakışma kaynak okunmadan önce çözülür.
        """
        source = self._sessions.snapshot(source_session_id)
        target = self._sessions.snapshot(target_session_id)
        source_file = posixpath.join(files.normalize_remote(source_dir), name)

        def work(on_progress, cancel_event):
            def source_mtime():
                with self.pool.borrow(source, use_limit=False) as conn:
                    return files.remote_mtime(conn, source_file)

            # "Daha yeniyse" kararı iki sunucuya birden sorar: yuvalar birlikte alınır (kilitlenme olmasın).
            with self._both_limits(source, target), self.pool.borrow(target, use_limit=False) as conn:
                target_provider = files.provider_of(conn)
                policy, skipped = files.relay_target_policy(conn, target_dir, name, conflict, overwrite, source_mtime)
            if skipped is not None:
                return skipped
            with self.pool.borrow(source) as src:
                plan = files.open_stream_source(src, source_dir, name)
            if files.can_stream_to(target_provider, plan["size"]):
                return self._stream_copy(plan, source, target, target_dir, policy, on_progress, cancel_event)
            return self._relay_copy(name, source, target, source_dir, target_dir, policy, on_progress, cancel_event, source_file)

        return self._launch(target.id, work)

    def _stream_copy(self, plan, source, target, target_dir, policy, on_progress, cancel_event):
        pipe = files.StreamPipe()

        def produce():
            # Kaynak bağlantısı hatada havuza geri konmaz (borrow içinde yükselen hata).
            try:
                with self.pool.borrow(source, use_limit=False) as source_conn:
                    plan["run"](source_conn, pipe, cancel_event)
                pipe.close()
            except BaseException as exc:  # noqa: BLE001 - hedef tarafa iletilir
                pipe.fail(exc)

        with self._both_limits(source, target):
            thread = threading.Thread(target=produce, daemon=True, name="copy-reader")
            thread.start()
            try:
                with self.pool.borrow(target, use_limit=False) as conn:
                    result = files.stream_upload(
                        conn, pipe, plan["size"], target_dir, plan["name"], policy,
                        progress_cb=on_progress, cancel_event=cancel_event,
                    )
            except files.SourceFailed as failed:
                original = failed.original
                if isinstance(original, files._PipeAborted):  # pragma: no cover - hedef zaten hata verdi
                    raise files.FileServiceError("Aktarım durduruldu", 500) from None
                if isinstance(original, (files.FileServiceError, files.TransferCancelled)):
                    raise original from None
                files._raise_provider_error("Kaynak dosya okunamadı", original)
            finally:
                pipe.abort()
                thread.join(timeout=30)
        return {**result, "from": plan["from"]}

    def _relay_copy(self, name, source, target, source_dir, target_dir, policy, on_progress, cancel_event, source_file):
        relay = self._relay_dir / uuid.uuid4().hex
        relay.mkdir(parents=True, exist_ok=True)
        try:
            def first_half(done, total):
                on_progress(done // 2, total)

            with self.pool.borrow(source) as conn:
                fetched = files.download(conn, source_dir, name, str(relay), True,
                                         progress_cb=first_half, cancel_event=cancel_event)
            size = fetched["size"]

            def second_half(done, total):
                total = total or size
                on_progress((total + done) // 2, total)

            # Google belgesi dışa aktarıldıysa ya da ad yerelde değiştiyse geçici dosyanın adı farklıdır.
            relay_name = Path(fetched["to"]).name
            with self.pool.borrow(target) as conn:
                result = files.upload(conn, str(relay), relay_name, target_dir, False,
                                      progress_cb=second_half, cancel_event=cancel_event, conflict=policy)
            return {**result, "from": source_file, "size": result.get("size") or size}
        finally:
            shutil.rmtree(relay, ignore_errors=True)

    def extract_remote_zip(self, session_id, path: str) -> dict:
        """Uzak zip arşivini yanındaki klasöre açar: geçici klasöre indirir, güvenli biçimde açar
        (zip-slip ve boyut sınırları yerel açmayla aynı) ve klasörü sunucuya yükler."""
        snapshot = self._sessions.snapshot(session_id)
        remote_file = files.normalize_remote(path)
        parent, name = posixpath.dirname(remote_file) or "/", posixpath.basename(remote_file)
        if not name.lower().endswith(".zip"):
            raise files.FileServiceError("Yalnızca .zip arşivleri açılabilir", 400, "bad_zip")
        work_dir = self._relay_dir / uuid.uuid4().hex
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            with self.pool.borrow(snapshot) as conn:
                fetched = files.download(conn, parent, name, str(work_dir), True)
            extracted = files.extract_local_zip(fetched["to"])
            with self.pool.borrow(snapshot) as conn:
                uploaded = files.upload_tree(conn, Path(extracted["path"]), parent, extracted["name"])
            return {**uploaded, "skipped": extracted["skipped"]}
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def get(self, job_id: str) -> TransferJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> TransferJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.cancel_event.set()
            return job
