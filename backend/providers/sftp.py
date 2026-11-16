from pathlib import Path

import paramiko

from config import DATA_DIR


class _TrustOnFirstUsePolicy(paramiko.MissingHostKeyPolicy):
    """İlk bağlantıda sunucu anahtarını known_hosts'a kaydeder; sonraki bağlantılarda değişirse reddeder."""

    def __init__(self, known_hosts_path: Path):
        self.known_hosts_path = known_hosts_path

    def missing_host_key(self, client, hostname, key):
        host_keys = client.get_host_keys()
        host_keys.add(hostname, key.get_name(), key)
        self.known_hosts_path.parent.mkdir(parents=True, exist_ok=True)
        host_keys.save(str(self.known_hosts_path))


class SFTPOperations:
    """SFTP bağlantısı. Dosya işlemleri file_service.py içindedir."""

    def __init__(self, hostname, port, username, password=None, timeout=20, key_filename=None):
        self.hostname = hostname
        self.port = port
        self.username = username
        self.client = paramiko.SSHClient()
        known_hosts = Path(DATA_DIR) / "known_hosts"
        if known_hosts.exists():
            self.client.load_host_keys(str(known_hosts))
        self.client.set_missing_host_key_policy(_TrustOnFirstUsePolicy(known_hosts))
        self.client.connect(
            hostname,
            port,
            username,
            password=password,
            key_filename=key_filename,
            timeout=timeout,
            allow_agent=key_filename is None and password is None,
            look_for_keys=key_filename is not None,
        )
        transport = self.client.get_transport()
        if transport is not None:
            transport.set_keepalive(30)
        self.sftp = self.client.open_sftp()

    def close(self):
        try:
            self.sftp.close()
        finally:
            self.client.close()
