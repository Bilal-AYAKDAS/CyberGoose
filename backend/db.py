"""SQLite kalıcılığı: kayıtlı bağlantılar ve klasör yer imleri.

Parolalar SQLite yerine işletim sistemi secret store'unda (`keyring` / Windows Credential Manager)
saklanır ve API yanıtlarında hiçbir zaman dönmez; yalnızca `hasPassword` bilgisi verilir.
"""
import logging
import sqlite3
from contextlib import closing

import keyring

from config import DB_PATH

KEYRING_SERVICE = "CyberGoose"
logger = logging.getLogger(__name__)


def _secret_key(connection_id) -> str:
    return f"connection:{connection_id}"


def _get_secret(connection_id) -> str | None:
    try:
        return keyring.get_password(KEYRING_SERVICE, _secret_key(connection_id))
    except Exception:
        return None


def _set_secret(connection_id, password: str) -> bool:
    """False: işletim sisteminin parola deposuna yazılamadı (parola saklanmadı)."""
    try:
        keyring.set_password(KEYRING_SERVICE, _secret_key(connection_id), password)
        return True
    except Exception:
        logger.warning("Parola güvenli depoya kaydedilemedi (bağlantı %s)", connection_id)
        return False


def _delete_secret(connection_id) -> None:
    try:
        keyring.delete_password(KEYRING_SERVICE, _secret_key(connection_id))
    except Exception:
        pass


SCHEMA_VERSION = 6


class DbMyFtp:
    """Şema `PRAGMA user_version` ile sürümlenir; her açılışta eksik adımlar sırayla uygulanır."""

    def __init__(self, path=DB_PATH):
        self.path = str(path)
        self._migrate()

    def _connect(self):
        return closing(sqlite3.connect(self.path))

    def _migrate(self):
        with self._connect() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version < 1:
                # Eski uygulamanın şeması (sürüm bilgisi yoktu).
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
                    PRAGMA user_version = 1;
                    """
                )
            if version < 2:
                # BOOKMARKS adı yanıltıcıydı ve USERNAME NUMERIC tipliydi ("0123" → 123).
                # Kimlikler korunur; keyring anahtarları kimliğe bağlıdır.
                connection.executescript(
                    """
                    BEGIN;
                    CREATE TABLE CONNECTIONS (
                        ID INTEGER PRIMARY KEY AUTOINCREMENT,
                        NAME TEXT NOT NULL,
                        TYPE TEXT NOT NULL,
                        HOST TEXT NOT NULL,
                        PORT INTEGER NOT NULL,
                        USERNAME TEXT NOT NULL,
                        PASSWORD TEXT
                    );
                    INSERT INTO CONNECTIONS (ID, NAME, TYPE, HOST, PORT, USERNAME, PASSWORD)
                        SELECT ID,
                               COALESCE(NULLIF(CONNECTION_NAME, ''), HOSTNAME, 'Bağlantı ' || ID),
                               COALESCE(CONNECTION_TYPE, 'FTP'),
                               COALESCE(HOSTNAME, ''),
                               COALESCE(PORT, 21),
                               COALESCE(CAST(USERNAME AS TEXT), ''),
                               PASSWORD
                        FROM BOOKMARKS;
                    -- Silinmiş eski kimlikler yeniden kullanılmasın (keyring kayıtları kimliğe bağlı).
                    UPDATE sqlite_sequence
                        SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'BOOKMARKS'), 0))
                        WHERE name = 'CONNECTIONS';
                    INSERT INTO sqlite_sequence(name, seq)
                        SELECT 'CONNECTIONS', seq FROM sqlite_sequence
                        WHERE name = 'BOOKMARKS'
                          AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'CONNECTIONS');
                    DROP TABLE BOOKMARKS;
                    PRAGMA user_version = 2;
                    COMMIT;
                    """
                )
            if version < 3:
                # SFTP özel anahtar yolu (dosyanın kendisi değil, yalnızca yolu saklanır).
                connection.executescript(
                    """
                    ALTER TABLE CONNECTIONS ADD COLUMN KEY_PATH TEXT;
                    PRAGMA user_version = 3;
                    """
                )
            if version < 4:
                # Kenar çubuğunda bağlantı grupları (FileZilla klasörleri de buraya aktarılır).
                connection.executescript(
                    """
                    ALTER TABLE CONNECTIONS ADD COLUMN GROUP_NAME TEXT;
                    PRAGMA user_version = 4;
                    """
                )
            if version < 5:
                # SFTP: SSH agent (Pageant / OpenSSH) ile kimlik doğrulama.
                connection.executescript(
                    """
                    ALTER TABLE CONNECTIONS ADD COLUMN USE_AGENT INTEGER NOT NULL DEFAULT 0;
                    PRAGMA user_version = 5;
                    """
                )
            if version < 6:
                # Klasör karşılaştırmada kullanılan sunucu saat farkı (dakika); NULL = otomatik.
                connection.executescript(
                    """
                    ALTER TABLE CONNECTIONS ADD COLUMN COMPARE_OFFSET INTEGER;
                    PRAGMA user_version = 6;
                    """
                )
            # Keyring'e taşınamamış eski düz metin parolalar (ör. keyring o an erişilemezdi).
            legacy_rows = connection.execute(
                "SELECT ID, PASSWORD FROM CONNECTIONS WHERE PASSWORD IS NOT NULL AND PASSWORD != ''"
            ).fetchall()
            for row_id, legacy_password in legacy_rows:
                if _set_secret(row_id, legacy_password):
                    connection.execute("UPDATE CONNECTIONS SET PASSWORD = NULL WHERE ID = ?", (row_id,))
            connection.commit()

    # ------------------------------------------------------------ bağlantılar

    def list_connections(self):
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT ID, NAME, TYPE, HOST, PORT, USERNAME, PASSWORD IS NOT NULL AND PASSWORD != '', KEY_PATH, GROUP_NAME, USE_AGENT, COMPARE_OFFSET
                   FROM CONNECTIONS ORDER BY COALESCE(GROUP_NAME, '') COLLATE NOCASE, NAME COLLATE NOCASE, ID"""
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
                "keyPath": row[7] or "",
                "group": row[8] or "",
                "useAgent": bool(row[9]),
                "hasPassphrase": bool(row[7]) and bool(_get_secret(f"{row[0]}:passphrase")),
                "compareOffset": row[10],
            }
            for row in rows
        ]

    def get_connection_secret(self, connection_id):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT TYPE, HOST, PORT, USERNAME, PASSWORD, KEY_PATH, USE_AGENT FROM CONNECTIONS WHERE ID = ?",
                (connection_id,),
            ).fetchone()
        if not row:
            return None
        password = _get_secret(connection_id) or row[4]
        return {"type": row[0], "host": row[1], "port": row[2], "username": row[3], "password": password, "keyPath": row[5] or None,
                "useAgent": bool(row[6]), "passphrase": _get_secret(f"{connection_id}:passphrase") if row[5] else None}

    def insert_connection(self, name, conn_type, host, port, username, password=None, key_path=None, group=None,
                          use_agent=False, passphrase=None):
        """(kimlik, parola_kaydedildi) döndürür. Parola verilmediyse ikinci değer None'dır."""
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO CONNECTIONS (NAME, TYPE, HOST, PORT, USERNAME, PASSWORD, KEY_PATH, GROUP_NAME, USE_AGENT) "
                "VALUES (?,?,?,?,?,NULL,?,?,?)",
                (name, conn_type, host, port, username, key_path or None, group or None, int(bool(use_agent))),
            )
            connection.commit()
            connection_id = cursor.lastrowid
        # Aynı kimliğe ait eski bir keyring kaydı kalmışsa yeni bağlantıya taşınmasın.
        _delete_secret(connection_id)
        _delete_secret(f"{connection_id}:passphrase")
        saved = _set_secret(connection_id, password) if password else None
        if passphrase and key_path:
            saved = _set_secret(f"{connection_id}:passphrase", passphrase) and saved is not False
        return connection_id, saved

    def update_connection(self, connection_id, name, conn_type, host, port, username, password=None, key_path=None, group=None,
                          use_agent=False, passphrase=None):
        """(güncellendi, parola_kaydedildi). Parola verilmezse mevcut kayıtlı parolaya dokunmaz."""
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE CONNECTIONS SET NAME = ?, TYPE = ?, HOST = ?, PORT = ?, USERNAME = ?, KEY_PATH = ?, GROUP_NAME = ?, USE_AGENT = ? "
                "WHERE ID = ?",
                (name, conn_type, host, port, username, key_path or None, group or None, int(bool(use_agent)), connection_id),
            )
            connection.commit()
            updated = cursor.rowcount > 0
        saved = _set_secret(connection_id, password) if updated and password else None
        if updated and not key_path:
            _delete_secret(f"{connection_id}:passphrase")
        elif updated and passphrase:
            saved = _set_secret(f"{connection_id}:passphrase", passphrase) and saved is not False
        return updated, saved

    def set_compare_offset(self, connection_id, minutes):
        """Karşılaştırma saat farkını kaydeder; None otomatik algılamaya döner."""
        with self._connect() as connection:
            cursor = connection.execute("UPDATE CONNECTIONS SET COMPARE_OFFSET = ? WHERE ID = ?", (minutes, connection_id))
            connection.commit()
            return cursor.rowcount > 0

    def find_connection(self, conn_type, host, port, username):
        """Aynı sunucu ve kullanıcıya ait kayıt (içe aktarmada çift kaydı önlemek için)."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT ID FROM CONNECTIONS WHERE TYPE = ? AND lower(HOST) = lower(?) AND PORT = ? AND USERNAME = ?",
                (conn_type, host, port, username),
            ).fetchone()
        return row[0] if row else None

    def delete_connection(self, connection_id):
        with self._connect() as connection:
            connection.execute("DELETE FROM FOLDER_BOOKMARKS WHERE CONNECTION_ID = ?", (connection_id,))
            cursor = connection.execute("DELETE FROM CONNECTIONS WHERE ID = ?", (connection_id,))
            connection.commit()
            deleted = cursor.rowcount > 0
        if deleted:
            _delete_secret(connection_id)
            _delete_secret(f"{connection_id}:passphrase")
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
