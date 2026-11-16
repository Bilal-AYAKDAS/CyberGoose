import paramiko


class SFTPOperations:
    """SFTP bağlantısı. Dosya işlemleri file_service.py içindedir.

    Kimlik doğrulama veya bağlantı hatası istisna olarak yükselir (önceden yutuluyordu).
    Not: Host anahtarı hâlâ AutoAddPolicy ile kabul ediliyor; doğrulama roadmap'te.
    """

    def __init__(self, hostname, port, username, password, timeout=20):
        self.hostname = hostname
        self.port = port
        self.username = username
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.client.connect(hostname, port, username, password, timeout=timeout)
        self.sftp = self.client.open_sftp()

    def close(self):
        try:
            self.sftp.close()
        finally:
            self.client.close()
