"""SQLite kalıcılığı: kayıtlı bağlantılar ve klasör yer imleri.

Parolalar API yanıtlarında hiçbir zaman dönmez; yalnızca `hasPassword` bilgisi verilir.
Not: Kayıtlı parolalar hâlâ düz metin saklanıyor; işletim sistemi secret store'una taşınması roadmap'te.
"""
import sqlite3
from contextlib import closing

from config import DB_PATH


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
                "hasPassword": bool(row[6]),
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
        return {"type": row[0], "host": row[1], "port": row[2], "username": row[3], "password": row[4]}

    def insert_connection(self, name, conn_type, host, port, username):
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO BOOKMARKS (CONNECTION_NAME, CONNECTION_TYPE, HOSTNAME, PORT, USERNAME, PASSWORD) VALUES (?,?,?,?,?,NULL)",
                (name, conn_type, host, port, username),
            )
            connection.commit()
            return cursor.lastrowid

    def update_connection(self, connection_id, name, conn_type, host, port, username):
        """Kayıtlı parolaya dokunmaz."""
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE BOOKMARKS SET CONNECTION_NAME = ?, CONNECTION_TYPE = ?, HOSTNAME = ?, PORT = ?, USERNAME = ? WHERE ID = ?",
                (name, conn_type, host, port, username, connection_id),
            )
            connection.commit()
            return cursor.rowcount > 0

    def delete_connection(self, connection_id):
        with self._connect() as connection:
            connection.execute("DELETE FROM FOLDER_BOOKMARKS WHERE CONNECTION_ID = ?", (connection_id,))
            cursor = connection.execute("DELETE FROM BOOKMARKS WHERE ID = ?", (connection_id,))
            connection.commit()
            return cursor.rowcount > 0

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
