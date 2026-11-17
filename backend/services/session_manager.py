"""Uzak bağlantı oturum yönetimi (FTP, FTPS, SFTP, Dropbox, Google Drive, OneDrive).

Bir anda tek bir *etkin* oturum vardır: paneldeki listeleme ve dosya işlemleri onu kullanır
ve `lock` ile sıraya girer (ftplib ve paramiko bağlantıları eşzamanlı kullanılamaz).

Aktarımlar bu kilidi tutmaz. Her oturum için bir `SessionSnapshot` saklanır; aktarım işi
eklendiği oturumun anlık görüntüsüyle çalışır ve sunucu türlerinde kendi bağlantısını açar
(bkz. TransferManager). Böylece uzun bir aktarım paneli kilitlemez ve kullanıcı bağlantı
değiştirse bile kuyruktaki dosyalar doğru sunucuya gider.
"""
from __future__ import annotations

import ftplib
import logging
import socket
import ssl
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Callable

import file_service as files

logger = logging.getLogger(__name__)

SERVER_TYPES = {"ftp": "FTP", "ftps": "FTPS", "sftp": "SFTP"}
CLOUD_TYPES = {"dropbox": "Dropbox", "googledrive": "GoogleDrive", "onedrive": "OneDrive"}

_DRIVE_LOCK = threading.Lock()

# Bağlantı değiştirildikten sonra kuyrukta bekleyen işler için eski oturumların görüntüleri tutulur.
MAX_SNAPSHOTS = 16


@dataclass
class SessionSnapshot:
    id: int
    type: str
    connection_id: str | None
    # Paneldeki bağlantı. Bulut sağlayıcılarında aktarımlar da bunu paylaşır.
    shared: object
    # Bağımsız yeni bağlantı açar (FTP/FTPS/SFTP ve Google Drive). None ise `shared` kullanılır.
    factory: Callable[[], object] | None = None
    closed: bool = False
    # Sunucu başına eşzamanlı aktarım bağlantısı sınırı (FTP sunucuları IP başına 2-3 ile sınırlar).
    limit: threading.BoundedSemaphore | None = None


@dataclass
class ConnectionState:
    connection: object = None
    type: str | None = None
    connection_id: str | None = None
    session_id: int | None = None
    pending_dropbox: object = None


def _parse_port(port) -> int:
    try:
        port_number = int(port)
    except (TypeError, ValueError):
        raise files.FileServiceError("Port sayı olmalı", 400)
    if not 1 <= port_number <= 65535:
        raise files.FileServiceError("Port 1-65535 arasında olmalı", 400)
    return port_number


def describe_connect_error(exc: BaseException, host: str, conn_type: str) -> files.FileServiceError:
    """Ağ ve kimlik doğrulama hatalarını kullanıcının anlayacağı tek bir cümleye çevirir."""
    from providers.sftp import UnknownHostKeyError

    prefix = f"{host} bağlantısı kurulamadı"
    code = type(exc).__name__
    if isinstance(exc, UnknownHostKeyError):
        return files.FileServiceError(
            f"{host} sunucusunun anahtarı ilk kez görülüyor. Parmak izini doğrulayıp onaylayın.",
            409,
            "host_key_unknown",
            {"hostKey": {"host": host, "type": exc.key_type, "fingerprint": exc.fingerprint}},
        )
    try:
        import paramiko

        if isinstance(exc, paramiko.BadHostKeyException):
            return files.FileServiceError(
                f"{prefix}: sunucu anahtarı kayıtlı anahtardan farklı. Sunucu değişmediyse bu bir saldırı olabilir; "
                "bağlantı güvenlik için durduruldu.",
                502,
                "host_key_changed",
            )
        if isinstance(exc, paramiko.PasswordRequiredException):
            return files.FileServiceError(
                f"{prefix}: özel anahtar parola korumalı. Anahtar parolasını girin.", 401, "key_passphrase_required",
            )
        if isinstance(exc, paramiko.SSHException) and "private key file is encrypted" in str(exc).lower():
            return files.FileServiceError(
                f"{prefix}: özel anahtar parola korumalı. Anahtar parolasını girin.", 401, "key_passphrase_required",
            )
        if isinstance(exc, paramiko.AuthenticationException):
            return files.FileServiceError(f"{prefix}: kullanıcı adı, parola veya anahtar hatalı.", 401, "auth_failed")
        if isinstance(exc, paramiko.SSHException) and "key" in str(exc).lower() and "passphrase" in str(exc).lower():
            return files.FileServiceError(f"{prefix}: özel anahtar parola korumalı veya okunamıyor.", 400, "key_error")
    except ImportError:  # pragma: no cover - paramiko her zaman kurulu
        pass
    if isinstance(exc, ftplib.error_temp) and str(exc).startswith("421"):
        return files.FileServiceError(
            f"{prefix}: sunucu çok fazla eşzamanlı bağlantıyı reddetti. Ayarlar'dan paralel aktarım sayısını azaltın.",
            429, "too_many_connections",
        )
    if isinstance(exc, ftplib.error_perm) and str(exc).startswith("530"):
        return files.FileServiceError(f"{prefix}: kullanıcı adı veya parola hatalı.", 401, "auth_failed")
    if isinstance(exc, socket.gaierror):
        return files.FileServiceError(f"{prefix}: sunucu adı çözülemedi. Adresi kontrol edin.", 502, "dns_error")
    if isinstance(exc, ConnectionRefusedError):
        return files.FileServiceError(f"{prefix}: bağlantı reddedildi. Port ve protokolün doğru olduğundan emin olun.", 502, "refused")
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return files.FileServiceError(f"{prefix}: sunucu zamanında yanıt vermedi.", 504, "timeout")
    if isinstance(exc, ssl.SSLError):
        return files.FileServiceError(f"{prefix}: TLS el sıkışması başarısız. Sunucu FTPS desteklemiyor olabilir.", 502, "tls_error")
    if isinstance(exc, FileNotFoundError) and conn_type == "SFTP":
        return files.FileServiceError(f"{prefix}: özel anahtar dosyası bulunamadı.", 400, "key_not_found")
    if isinstance(exc, OSError):
        return files.FileServiceError(f"{prefix}: ağ hatası ({exc.strerror or exc}).", 502, code)
    return files.FileServiceError(f"{prefix}. Sunucu, port ve kimlik bilgilerini kontrol edin.", 502, code)


def open_server_connection(conn_type: str, host: str, port: int, username: str, password: str | None,
                           key_path: str | None = None, trusted_fingerprint: str | None = None,
                           passphrase: str | None = None, use_agent: bool = False):
    if conn_type in ("FTP", "FTPS"):
        from providers.ftp import FTPOperations
        return FTPOperations(host, port, username, password, tls=conn_type == "FTPS")
    from providers.sftp import SFTPOperations
    return SFTPOperations(
        host, port, username, password=password or None, key_filename=key_path or None,
        trusted_fingerprint=trusted_fingerprint, passphrase=passphrase, use_agent=use_agent,
    )


class SessionManager:
    def __init__(self):
        self.state = ConnectionState()
        self.lock = threading.RLock()
        self._dropbox_lock = threading.Lock()
        self._cleanup_hooks = []
        self._snapshots: OrderedDict[int, SessionSnapshot] = OrderedDict()
        self._snapshot_lock = threading.Lock()
        self._next_session = 1

    def register_cleanup(self, callback) -> None:
        self._cleanup_hooks.append(callback)

    def session_info(self) -> dict:
        return {
            "connected": self.state.connection is not None,
            "type": self.state.type,
            "connectionId": self.state.connection_id,
            "sessionId": getattr(self.state, "session_id", None),
        }

    # ------------------------------------------------------------ anlık görüntüler

    def snapshot(self, session_id=None) -> SessionSnapshot:
        """Aktarım için oturum görüntüsü. `session_id` yoksa etkin oturum kullanılır."""
        if session_id in (None, ""):
            session_id = getattr(self.state, "session_id", None)
            if session_id is None or self.state.connection is None:
                raise files.FileServiceError("Uzak bağlantı yok. Önce bir bağlantı açın.", 409, "not_connected")
        try:
            key = int(session_id)
        except (TypeError, ValueError):
            raise files.FileServiceError("Geçersiz oturum kimliği", 400)
        with self._snapshot_lock:
            snap = self._snapshots.get(key)
        if snap is None or (snap.closed and snap.factory is None):
            raise files.FileServiceError(
                "Bu aktarımın bağlantısı kapandı. Bağlantıyı yeniden açıp tekrar deneyin.", 409, "session_closed"
            )
        return snap

    def forget_connection(self, connection_id) -> None:
        """Silinen kayıtlı bağlantının eski oturumları artık yeniden bağlanamaz."""
        with self._snapshot_lock:
            for snap in self._snapshots.values():
                if snap.closed and str(snap.connection_id) == str(connection_id):
                    snap.factory = None

    def _remember(self, snap: SessionSnapshot) -> None:
        with self._snapshot_lock:
            self._snapshots[snap.id] = snap
            while len(self._snapshots) > MAX_SNAPSHOTS:
                self._snapshots.popitem(last=False)

    # ------------------------------------------------------------ bağlanma

    def close_current(self, forget_credentials: bool = False) -> None:
        """Etkin oturumu kapatır.

        Bağlantı değiştirilirken kuyruktaki işler eski sunucuya gidebilsin diye `factory` saklanır.
        Kullanıcı açıkça bağlantıyı kesince (`forget_credentials`) parola içeren factory atılır.
        """
        current_id = getattr(self.state, "session_id", None)
        if current_id is not None:
            # Önce "kapandı" işaretlenir: temizlik sürerken biten iş bağlantısını havuza geri koymasın.
            with self._snapshot_lock:
                snap = self._snapshots.get(current_id)
                if snap is not None:
                    snap.closed = True
                    if forget_credentials:
                        snap.factory = None
        for hook in self._cleanup_hooks:
            try:
                hook()
            except Exception:
                logger.exception("Oturum temizleme kancası başarısız")
        if self.state.connection is not None and hasattr(self.state.connection, "close"):
            try:
                self.state.connection.close()
            except Exception:
                logger.exception("Önceki bağlantı kapatılamadı")
        self.state.connection = None
        self.state.type = None
        self.state.connection_id = None
        self.state.session_id = None

    def connect_server(self, conn_type: str, host: str, port, username: str, password: str | None,
                       key_path: str | None = None, trusted_fingerprint: str | None = None,
                       passphrase: str | None = None, use_agent: bool = False):
        if not (host and port and username and (password or (conn_type == "SFTP" and (key_path or use_agent)))):
            raise files.FileServiceError("Sunucu, port, kullanıcı adı ve parola gerekli", 400, "missing_fields")
        port_number = _parse_port(port)
        try:
            return open_server_connection(
                conn_type, host, port_number, username, password, key_path, trusted_fingerprint,
                passphrase=passphrase, use_agent=use_agent,
            )
        except Exception as exc:
            if use_agent and type(exc).__name__ in ("AuthenticationException", "SSHException") and not (password or key_path):
                raise files.FileServiceError(
                    f"{host} bağlantısı kurulamadı: SSH agent'ta (Pageant veya OpenSSH) uygun anahtar yok ya da sunucu kabul etmedi.",
                    401, "agent_failed",
                ) from exc
            logger.warning("%s bağlantısı kurulamadı: %s", conn_type, type(exc).__name__)
            raise describe_connect_error(exc, host, conn_type) from exc

    def server_factory(self, conn_type: str, host: str, port, username: str, password: str | None,
                       key_path: str | None = None, passphrase: str | None = None, use_agent: bool = False):
        """Aynı sunucuya yeni bağlantı açan fonksiyon (aktarımlar için)."""
        port_number = _parse_port(port)

        def factory():
            try:
                return open_server_connection(
                    conn_type, host, port_number, username, password, key_path, passphrase=passphrase, use_agent=use_agent,
                )
            except Exception as exc:
                raise describe_connect_error(exc, host, conn_type) from exc

        return factory

    def connect_dropbox(self):
        from providers.dropbox_oauth import DropboxOperations

        with self._dropbox_lock:
            pending = self.state.pending_dropbox
            if pending is not None and getattr(pending, "dbx", None) is not None:
                self.state.pending_dropbox = None
                return pending
            if pending is not None:
                # İzin sekmesi kapatılmış olabilir: sayfa yeniden açılır, akış takılı kalmaz.
                try:
                    pending.get_access_token()
                except Exception:
                    logger.warning("Dropbox izin sayfası yeniden açılamadı", exc_info=True)
                return None
            try:
                connection = DropboxOperations()
            except ValueError as exc:
                raise files.FileServiceError(str(exc), 400, "missing_credentials") from exc
            except Exception as exc:
                raise files.FileServiceError(f"Dropbox bağlantısı başlatılamadı: {exc}", 502, type(exc).__name__) from exc
            if getattr(connection, "dbx", None) is None:
                self.state.pending_dropbox = connection
                return None
            return connection

    def connect_googledrive(self):
        try:
            from providers.google_drive import DriveService
            # token.json'u aynı anda birden çok iş yenileyip yazmasın (yarım dosya → OAuth akışı).
            with _DRIVE_LOCK:
                return DriveService()
        except FileNotFoundError as exc:
            raise files.FileServiceError("credentials.json bulunamadı. Google Drive ayarlarını kontrol edin.", 400, "missing_credentials") from exc
        except Exception as exc:
            raise files.FileServiceError(f"Google Drive bağlantısı kurulamadı: {exc}", 502, type(exc).__name__) from exc

    def connect_onedrive(self):
        try:
            from providers.onedrive import OneDriveService
            return OneDriveService()
        except ValueError as exc:
            raise files.FileServiceError(str(exc), 400, "missing_credentials") from exc
        except Exception as exc:
            raise files.FileServiceError(f"OneDrive bağlantısı kurulamadı: {exc}", 502, type(exc).__name__) from exc

    def activate(self, connection, conn_type: str, connection_id: str | None, factory=None) -> int:
        """Yeni bağlantıyı etkin yapar (çağıran `lock`'u tutmalıdır). Oturum kimliğini döndürür."""
        self.close_current()
        session_id = self._next_session
        self._next_session += 1
        self.state.connection = connection
        self.state.type = conn_type
        self.state.connection_id = connection_id
        self.state.session_id = session_id
        if factory is None and conn_type == "GoogleDrive":
            # googleapiclient (httplib2) iş parçacığı güvenli değil; aktarımlar kendi istemcisini açar.
            factory = self.connect_googledrive
        limit = threading.BoundedSemaphore(2) if conn_type in ("FTP", "FTPS") else None
        self._remember(SessionSnapshot(session_id, conn_type, connection_id, connection, factory, limit=limit))
        return session_id
