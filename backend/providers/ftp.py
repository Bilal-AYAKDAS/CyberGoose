import hashlib
import json
import ssl
import threading
from ftplib import FTP, FTP_TLS
from pathlib import Path

from config import DATA_DIR

_PIN_LOCK = threading.Lock()


class CertificateChangedError(Exception):
    """Kayıtlı (onaylanmış) sertifika değişti: olası ortadaki adam saldırısı, bağlantı durdurulur."""

    def __init__(self, hostname: str, expected: str, actual: str):
        super().__init__(f"{hostname} sertifikası değişti")
        self.hostname = hostname
        self.expected = expected
        self.actual = actual


def cert_fingerprint(der: bytes) -> str:
    digest = hashlib.sha256(der).hexdigest().upper()
    return "SHA256:" + ":".join(digest[i:i + 2] for i in range(0, len(digest), 2))


def _pins_path() -> Path:
    return Path(DATA_DIR) / "ftps_certs.json"


def _load_pins() -> dict:
    try:
        data = json.loads(_pins_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_pin(key: str, fingerprint: str) -> None:
    with _PIN_LOCK:
        pins = _load_pins()
        pins[key] = fingerprint
        path = _pins_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(pins, indent=2), encoding="utf-8")
        temp.replace(path)


class FTPOperations:
    """FTP veya FTPS (açık TLS, AUTH TLS) bağlantısı. Dosya işlemleri file_service.py içindedir.

    Düz FTP şifrelenmez: parola ve dosyalar ağda açık metin olarak gider. FTPS'te hem
    oturum hem veri kanalı (PROT P) şifrelenir.

    Sertifika doğrulama: Python'un FTP_TLS'i varsayılan olarak sertifikayı hiç doğrulamaz. Burada
    önce sistemin güvendiği sertifika otoriteleri ve ana makine adıyla doğrulanır. Doğrulanamazsa
    (kendinden imzalı sunucular, FileZilla Server gibi) SFTP'deki gibi parmak izi sabitlenir:
    ilk bağlantıda kullanıcı onaylar (`trusted_fingerprint`), sonra sertifika değişirse bağlantı durur.
    """

    def __init__(self, host, port, username, password, timeout=20, tls=False, trusted_fingerprint=None):
        self.host = host
        self.port = port
        self.username = username
        self.tls = tls
        if not tls:
            self.ftp = FTP(timeout=timeout)
            self._login(password)
            return
        try:
            self.ftp = FTP_TLS(context=ssl.create_default_context(), timeout=timeout)
            self._login(password)
        except ssl.SSLCertVerificationError:
            self._close_quietly()
            self._login_pinned(password, timeout, trusted_fingerprint)
        self.ftp.prot_p()

    def _login(self, password) -> None:
        self.ftp.encoding = 'utf-8'
        self.ftp.connect(self.host, self.port)
        self.ftp.login(self.username, password)

    def _login_pinned(self, password, timeout, trusted_fingerprint) -> None:
        from providers.sftp import UnknownHostKeyError

        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        self.ftp = FTP_TLS(context=context, timeout=timeout)
        self.ftp.encoding = 'utf-8'
        self.ftp.connect(self.host, self.port)
        self.ftp.auth()  # Parola göndermeden önce sertifika kontrol edilir.
        actual = cert_fingerprint(self.ftp.sock.getpeercert(binary_form=True))
        key = f"{self.host}:{self.port}"
        expected = _load_pins().get(key)
        if expected and expected != actual:
            self._close_quietly()
            raise CertificateChangedError(self.host, expected, actual)
        if not expected:
            if trusted_fingerprint != actual:
                self._close_quietly()
                raise UnknownHostKeyError(self.host, "TLS", actual)
            _save_pin(key, actual)
        self.ftp.login(self.username, password)

    def _close_quietly(self) -> None:
        try:
            self.ftp.close()
        except Exception:
            pass

    def close(self):
        try:
            self.ftp.quit()
        except Exception:
            self.ftp.close()
