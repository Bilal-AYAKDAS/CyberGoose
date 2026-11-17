import base64
import hashlib
from pathlib import Path

import paramiko

from config import DATA_DIR


def fingerprint(key) -> str:
    """OpenSSH biçiminde SHA-256 parmak izi: `SHA256:...`."""
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode("ascii").rstrip("=")


class UnknownHostKeyError(Exception):
    """Sunucu anahtarı known_hosts'ta yok; kullanıcının parmak izini onaylaması gerekiyor."""

    def __init__(self, hostname: str, key_type: str, key_fingerprint: str):
        super().__init__(f"{hostname} için bilinmeyen sunucu anahtarı")
        self.hostname = hostname
        self.key_type = key_type
        self.fingerprint = key_fingerprint


class _ConfirmHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """Bilinmeyen anahtarı sessizce kabul etmez.

    Kullanıcı parmak izini onaylamışsa (`trusted_fingerprint` eşleşirse) anahtar known_hosts'a
    yazılır. Aksi halde UnknownHostKeyError yükselir ve arayüz onay sorar. Kayıtlı anahtar
    değişmişse paramiko BadHostKeyException verir (olası ortadaki adam saldırısı).
    """

    def __init__(self, known_hosts_path: Path, trusted_fingerprint: str | None):
        self.known_hosts_path = known_hosts_path
        self.trusted_fingerprint = trusted_fingerprint

    def missing_host_key(self, client, hostname, key):
        key_fingerprint = fingerprint(key)
        if self.trusted_fingerprint != key_fingerprint:
            raise UnknownHostKeyError(hostname, key.get_name(), key_fingerprint)
        host_keys = client.get_host_keys()
        host_keys.add(hostname, key.get_name(), key)
        self.known_hosts_path.parent.mkdir(parents=True, exist_ok=True)
        host_keys.save(str(self.known_hosts_path))


class SFTPOperations:
    """SFTP bağlantısı. Dosya işlemleri file_service.py içindedir."""

    def __init__(self, hostname, port, username, password=None, timeout=20, key_filename=None, trusted_fingerprint=None,
                 passphrase=None, use_agent=False):
        self.hostname = hostname
        self.port = port
        self.username = username
        self.client = paramiko.SSHClient()
        known_hosts = Path(DATA_DIR) / "known_hosts"
        if known_hosts.exists():
            self.client.load_host_keys(str(known_hosts))
        self.client.set_missing_host_key_policy(_ConfirmHostKeyPolicy(known_hosts, trusted_fingerprint))
        try:
            self.client.connect(
                hostname,
                port,
                username,
                password=password,
                key_filename=key_filename,
                passphrase=passphrase or None,
                timeout=timeout,
                banner_timeout=timeout,
                auth_timeout=timeout,
                # Pageant (Windows) ya da OpenSSH agent: açıkça seçildiyse veya başka kimlik yoksa.
                allow_agent=use_agent or (key_filename is None and password is None),
                look_for_keys=key_filename is not None,
            )
            transport = self.client.get_transport()
            if transport is not None:
                transport.set_keepalive(30)
            self.sftp = self.client.open_sftp()
        except BaseException:
            self.client.close()
            raise

    def close(self):
        try:
            self.sftp.close()
        finally:
            self.client.close()
