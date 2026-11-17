"""Uzak bağlantı oturum yönetimi (FTP, FTPS, SFTP, Dropbox, Google Drive, OneDrive)."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import file_service as files

logger = logging.getLogger(__name__)

SERVER_TYPES = {"ftp": "FTP", "ftps": "FTPS", "sftp": "SFTP"}
CLOUD_TYPES = {"dropbox": "Dropbox", "googledrive": "GoogleDrive", "onedrive": "OneDrive"}


@dataclass
class ConnectionState:
    connection: object = None
    type: str | None = None
    connection_id: str | None = None
    pending_dropbox: object = None


class SessionManager:
    def __init__(self):
        self.state = ConnectionState()
        self.lock = threading.Lock()
        self._cleanup_hooks = []

    def register_cleanup(self, callback) -> None:
        self._cleanup_hooks.append(callback)

    def session_info(self) -> dict:
        return {
            "connected": self.state.connection is not None,
            "type": self.state.type,
            "connectionId": self.state.connection_id,
        }

    def close_current(self) -> None:
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

    def connect_server(self, conn_type: str, host: str, port, username: str, password: str | None, key_path: str | None = None):
        if not (host and port and username and (password or (conn_type == "SFTP" and key_path))):
            raise files.FileServiceError("Sunucu, port, kullanıcı adı ve parola gerekli", 400, "missing_fields")
        try:
            port_number = int(port)
        except (TypeError, ValueError):
            raise files.FileServiceError("Port sayı olmalı", 400)
        if not 1 <= port_number <= 65535:
            raise files.FileServiceError("Port 1-65535 arasında olmalı", 400)
        try:
            if conn_type == "FTP":
                from providers.ftp import FTPOperations
                return FTPOperations(host, port_number, username, password)
            if conn_type == "FTPS":
                from providers.ftp import FTPOperations
                return FTPOperations(host, port_number, username, password, tls=True)
            from providers.sftp import SFTPOperations
            return SFTPOperations(host, port_number, username, password=password or None, key_filename=key_path or None)
        except Exception as exc:
            logger.warning("%s bağlantısı kurulamadı: %s", conn_type, type(exc).__name__)
            raise files.FileServiceError(
                f"{host} bağlantısı kurulamadı. Sunucu, port ve parolayı kontrol edin.", 502, type(exc).__name__
            ) from exc

    def connect_dropbox(self):
        from providers.dropbox_oauth import DropboxOperations

        pending = self.state.pending_dropbox
        if pending is not None and getattr(pending, "dbx", None) is not None:
            self.state.pending_dropbox = None
            return pending
        if pending is not None:
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

    def activate(self, connection, conn_type: str, connection_id: str | None) -> None:
        self.close_current()
        self.state.connection = connection
        self.state.type = conn_type
        self.state.connection_id = connection_id
