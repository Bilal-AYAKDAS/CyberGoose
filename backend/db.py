"""SQLite kalıcılığı: kayıtlı bağlantılar ve klasör yer imleri.

Parolalar SQLite yerine işletim sistemi secret store'unda (`keyring` / Windows Credential Manager)
saklanır ve API yanıtlarında hiçbir zaman dönmez; yalnızca `hasPassword` bilgisi verilir.
"""
import sqlite3
from contextlib import closing

import keyring

from config import DB_PATH

KEYRING_SERVICE = "CyberGoose"


def _secret_key(connection_id) -> str:
    return f"connection:{connection_id}"


def _get_secret(connection_id) -> str | None:
    try:
        return keyring.get_password(KEYRING_SERVICE, _secret_key(connection_id))
    except Exception:
        return None


def _set_secret(connection_id, password: str) -> bool:
    try:
        keyring.set_password(KEYRING_SERVICE, _secret_key(connection_id), password)
        return True
    except Exception:
        return False


def _delete_secret(connection_id) -> None:
    try:
        keyring.delete_password(KEYRING_SERVICE, _secret_key(connection_id))
    except Exception:
        pass


class DbMyFtp:
    def __init__(self, path=DB_PATH):
        self.path = str(path)
        self._migrate()

    def _connect(self):
        return closing(sqlite3.connect(self.path))

    def _migrate(self):
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS BOOKMARKS (
                    CONNECTION_TYPE TEXT,
                    ID INTEGER NOT NULL UNIQUE,
                    HOSTNAME TEXT,
                    PORT INTEGER,
                    USERNAME NUMERIC,
                    PASSWORD TEXT,
                    CONNECTION_NAME TEXT,
                    PRIMARY KEY(ID AUTOINCREMENT)
                );
                CREATE TABLE IF NOT EXISTS FOLDER_BOOKMARKS (
                    ID INTEGER PRIMARY KEY AUTOINCREMENT,
                    NAME TEXT NOT NULL,
                    CONNECTION_ID INTEGER,
                    PATH TEXT NOT NULL
                );
                """
            )
            legacy_rows = connection.execute(
                "SELECT ID, PASSWORD FROM BOOKMARKS WHERE PASSWORD IS NOT NULL AND PASSWORD != ''"
            ).fetchall()
            for row_id, legacy_password in legacy_rows:
                if _set_secret(row_id, legacy_password):
                    connection.execute("UPDATE BOOKMARKS SET PASSWORD = NULL WHERE ID = ?", (row_id,))
            connection.commit()

    # ------------------------------------------------------------ bağlantılar

    def list_connections(self):
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT ID, CONNECTION_NAME, CONNECTION_TYPE, HOSTNAME, PORT, USERNAME,
                          PASSWORD IS NOT NULL AND PASSWORD != ''
                   FROM BOOKMARKS ORDER BY ID"""
            ).fetchall()
        return [
            {
                "id": row[0],
                "name": row[1] or row[3] or f"Bağlantı {row[0]}",
                "type": row[2],
                "host": row[3] or "",
                "port": "" if row[4] is None else str(row[4]),
                "username": "" if row[5] is None else str(row[5]),
                "hasPassword": bool(_get_secret(row[0])) or bool(row[6]),
            }
            for row in rows
        ]

    def get_connection_secret(self, connection_id):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT CONNECTION_TYPE, HOSTNAME, PORT, USERNAME, PASSWORD FROM BOOKMARKS WHERE ID = ?",
                (connection_id,),
            ).fetchone()
        if not row:
            return None
        password = _get_secret(connection_id) or row[4]
        return {"type": row[0], "host": row[1], "port": row[2], "username": row[3], "password": password}

    def insert_connection(self, name, conn_type, host, port, username, password=None):
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO BOOKMARKS (CONNECTION_NAME, CONNECTION_TYPE, HOSTNAME, PORT, USERNAME, PASSWORD) VALUES (?,?,?,?,?,NULL)",
                (name, conn_type, host, port, username),
            )
            connection.commit()
            connection_id = cursor.lastrowid
        if password:
            _set_secret(connection_id, password)
        return connection_id

    def update_connection(self, connection_id, name, conn_type, host, port, username, password=None):
        """Parola verilmezse mevcut kayıtlı parolaya dokunmaz."""
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE BOOKMARKS SET CONNECTION_NAME = ?, CONNECTION_TYPE = ?, HOSTNAME = ?, PORT = ?, USERNAME = ? WHERE ID = ?",
                (name, conn_type, host, port, username, connection_id),
            )
            connection.commit()
            updated = cursor.rowcount > 0
        if updated and password:
            _set_secret(connection_id, password)
        return updated

    def delete_connection(self, connection_id):
        with self._connect() as connection:
            connection.execute("DELETE FROM FOLDER_BOOKMARKS WHERE CONNECTION_ID = ?", (connection_id,))
            cursor = connection.execute("DELETE FROM BOOKMARKS WHERE ID = ?", (connection_id,))
            connection.commit()
            deleted = cursor.rowcount > 0
        if deleted:
            _delete_secret(connection_id)
        return deleted

    # ------------------------------------------------------------ klasör yer imleri

    def list_folder_bookmarks(self):
        with self._connect() as connection:
            rows = connection.execute("SELECT ID, NAME, CONNECTION_ID, PATH FROM FOLDER_BOOKMARKS ORDER BY NAME COLLATE NOCASE").fetchall()
        return [{"id": row[0], "name": row[1], "connectionId": row[2], "path": row[3]} for row in rows]

    def insert_folder_bookmark(self, name, connection_id, path):
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO FOLDER_BOOKMARKS (NAME, CONNECTION_ID, PATH) VALUES (?,?,?)",
                (name, connection_id, path),
            )
            connection.commit()
            return cursor.lastrowid

    def delete_folder_bookmark(self, bookmark_id):
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM FOLDER_BOOKMARKS WHERE ID = ?", (bookmark_id,))
            connection.commit()
            return cursor.rowcount > 0
