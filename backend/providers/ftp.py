from ftplib import FTP, FTP_TLS


class FTPOperations:
    """FTP veya FTPS (açık TLS, AUTH TLS) bağlantısı. Dosya işlemleri file_service.py içindedir.

    Düz FTP şifrelenmez: parola ve dosyalar ağda açık metin olarak gider. FTPS'te hem
    oturum hem veri kanalı (PROT P) şifrelenir.
    """

    def __init__(self, host, port, username, password, timeout=20, tls=False):
        self.host = host
        self.port = port
        self.username = username
        self.tls = tls
        self.ftp = FTP_TLS(timeout=timeout) if tls else FTP(timeout=timeout)
        self.ftp.connect(host, port)
        self.ftp.login(username, password)
        if tls:
            self.ftp.prot_p()

    def close(self):
        try:
            self.ftp.quit()
        except Exception:
            self.ftp.close()
