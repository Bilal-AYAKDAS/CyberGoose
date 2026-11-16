"""React arayüzü için yerel ve uzak dosya işlemleri.

Sağlayıcı sınıfları (FTPOperations, SFTPOperations, DropboxOperations, DriveService) eski
Flask şablonları için farklı biçimlerde liste döndürüyor ve bazı hataları yutuyor. Bu modül
hepsini tek bir sözlük biçimine çevirir ve hataları istisna olarak yükseltir:

    {"name": str, "kind": "folder" | "file", "size": int | None,
     "modified": ISO-8601 str | None, "path": str}

Sağlayıcı tipi, ağır SDK'ları içe aktarmamak için nesnenin özniteliklerinden anlaşılır
(`sftp`, `ftp`, `dbx`, `service`).
"""
from __future__ import annotations

import os
import posixpath
import stat
from datetime import datetime, timezone
from pathlib import Path


class FileServiceError(Exception):
    """HTTP durum koduyla birlikte kullanıcıya gösterilebilir hata."""

    def __init__(self, message: str, status: int = 400, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'


def _iso(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp).isoformat(timespec='seconds')


def _entry(name, kind, size, modified, path):
    return {"name": name, "kind": kind, "size": size, "modified": modified, "path": path}


def _validate_name(name: str) -> str:
    if not name or name in ('.', '..') or '/' in name or '\\' in name:
        raise FileServiceError('Geçersiz dosya adı', 400)
    return name


# ---------------------------------------------------------------- yerel

def home_directory() -> str:
    return str(Path.home())


def local_crumbs(path: str) -> list[dict]:
    resolved = Path(path)
    parts = list(reversed([resolved, *resolved.parents]))
    return [{"name": part.name or str(part).rstrip('\\/') or str(part), "path": str(part)} for part in parts]


def list_local(path: str | None) -> dict:
    target = Path(path).expanduser() if path else Path.home()
    try:
        target = target.resolve(strict=True)
    except FileNotFoundError:
        raise FileServiceError('Klasör bulunamadı', 404)
    if not target.is_dir():
        raise FileServiceError('Bu yol bir klasör değil', 400)

    entries = []
    try:
        children = list(os.scandir(target))
    except PermissionError:
        raise FileServiceError('Bu klasörü okuma izniniz yok', 403)
    for child in children:
        try:
            info = child.stat()
            is_dir = child.is_dir()
        except OSError:
            continue  # Kırık link veya erişilemeyen öğe: listeyi bozmasın.
        entries.append(_entry(
            child.name,
            'folder' if is_dir else 'file',
            None if is_dir else info.st_size,
            _iso(info.st_mtime),
            str(Path(child.path)),
        ))
    parent = str(target.parent) if target.parent != target else None
    return {"path": str(target), "parent": parent, "crumbs": local_crumbs(str(target)), "entries": entries}


# ---------------------------------------------------------------- uzak: yardımcılar

def provider_of(conn) -> str:
    if conn is None:
        raise FileServiceError('Uzak bağlantı yok. Önce bir bağlantı açın.', 409, 'not_connected')
    if getattr(conn, 'sftp', None) is not None:
        return 'sftp'
    if getattr(conn, 'ftp', None) is not None:
        return 'ftp'
    if getattr(conn, 'dbx', None) is not None:
        return 'dropbox'
    if getattr(conn, 'service', None) is not None:
        return 'drive'
    raise FileServiceError('Bağlantı hazır değil. Yeniden bağlanın.', 409, 'not_connected')


def normalize_remote(path: str | None) -> str:
    raw = (path or '/').replace('\\', '/')
    normalized = posixpath.normpath('/' + raw.lstrip('/'))
    return '/' if normalized in ('.', '//') else normalized


def remote_crumbs(path: str) -> list[dict]:
    crumbs = [{"name": '/', "path": '/'}]
    current = ''
    for part in [p for p in path.split('/') if p]:
        current = f'{current}/{part}'
        crumbs.append({"name": part, "path": current})
    return crumbs


def _parse_list_date(text: str) -> str | None:
    """`ls -l` biçimindeki tarihi ISO'ya çevirir: 'Nov 16 14:32' veya 'Nov 16 2025'."""
    for fmt in ('%b %d %H:%M', '%b %d %Y'):
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if fmt == '%b %d %H:%M':
            now = datetime.now()
            parsed = parsed.replace(year=now.year)
            if parsed > now:
                parsed = parsed.replace(year=now.year - 1)
        return parsed.isoformat(timespec='seconds')
    return None


# ---------------------------------------------------------------- uzak: listeleme

def _list_ftp(conn, path):
    ftp = conn.ftp
    entries = []
    try:
        for name, facts in ftp.mlsd(path, facts=['type', 'size', 'modify']):
            kind = facts.get('type')
            if kind in ('cdir', 'pdir') or name in ('.', '..'):
                continue
            modified = None
            if facts.get('modify'):
                try:
                    stamp = datetime.strptime(facts['modify'][:14], '%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
                    modified = stamp.astimezone().replace(tzinfo=None).isoformat(timespec='seconds')
                except ValueError:
                    pass
            is_dir = kind == 'dir'
            entries.append(_entry(name, 'folder' if is_dir else 'file', None if is_dir else int(facts.get('size') or 0), modified, posixpath.join(path, name)))
        return entries
    except Exception as error:  # MLSD desteklenmiyorsa LIST'e düş.
        if 'not understood' not in str(error).lower() and not str(error).startswith('5'):
            raise
    lines = []
    ftp.dir(path, lines.append)
    for line in lines:
        parts = line.split(None, 8)
        if len(parts) < 9:
            continue
        name = parts[8]
        if name in ('.', '..'):
            continue
        if parts[0].startswith('l') and ' -> ' in name:
            name = name.split(' -> ')[0]
        is_dir = parts[0].startswith('d')
        size = None if is_dir else int(parts[4]) if parts[4].isdigit() else None
        entries.append(_entry(name, 'folder' if is_dir else 'file', size, _parse_list_date(' '.join(parts[5:8])), posixpath.join(path, name)))
    return entries


def _list_sftp(conn, path):
    entries = []
    for attr in conn.sftp.listdir_attr(path):
        is_dir = stat.S_ISDIR(attr.st_mode or 0)
        entries.append(_entry(attr.filename, 'folder' if is_dir else 'file', None if is_dir else attr.st_size, _iso(attr.st_mtime), posixpath.join(path, attr.filename)))
    return entries


def _dropbox_path(path):
    return '' if path == '/' else path


def _list_dropbox(conn, path):
    dbx = conn.dbx
    result = dbx.files_list_folder(_dropbox_path(path))
    items = list(result.entries)
    while getattr(result, 'has_more', False):
        result = dbx.files_list_folder_continue(result.cursor)
        items.extend(result.entries)
    entries = []
    for item in items:
        is_file = hasattr(item, 'size')
        modified = getattr(item, 'server_modified', None) or getattr(item, 'client_modified', None)
        entries.append(_entry(
            item.name,
            'file' if is_file else 'folder',
            item.size if is_file else None,
            modified.isoformat(timespec='seconds') if modified else None,
            getattr(item, 'path_display', None) or posixpath.join(path, item.name),
        ))
    return entries


def _drive_escape(value: str) -> str:
    return value.replace('\\', '\\\\').replace("'", "\\'")


def _drive_resolve_folder(service, path) -> str:
    folder_id = 'root'
    for part in [p for p in path.split('/') if p]:
        query = f"name = '{_drive_escape(part)}' and '{folder_id}' in parents and mimeType = '{DRIVE_FOLDER_MIME}' and trashed = false"
        items = service.files().list(q=query, pageSize=1, fields='files(id)').execute().get('files', [])
        if not items:
            raise FileServiceError('Klasör bulunamadı', 404)
        folder_id = items[0]['id']
    return folder_id


def _drive_find_file(service, folder_id, name):
    query = f"name = '{_drive_escape(name)}' and '{folder_id}' in parents and mimeType != '{DRIVE_FOLDER_MIME}' and trashed = false"
    items = service.files().list(q=query, pageSize=1, fields='files(id)').execute().get('files', [])
    return items[0]['id'] if items else None


def _list_drive(conn, path):
    service = conn.service
    folder_id = _drive_resolve_folder(service, path)
    entries, token = [], None
    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            pageSize=200,
            pageToken=token,
            fields='nextPageToken, files(id, name, size, modifiedTime, mimeType)',
        ).execute()
        for item in response.get('files', []):
            is_dir = item.get('mimeType') == DRIVE_FOLDER_MIME
            modified = item.get('modifiedTime')
            if modified:
                modified = datetime.fromisoformat(modified.replace('Z', '+00:00')).astimezone().replace(tzinfo=None).isoformat(timespec='seconds')
            entries.append(_entry(item['name'], 'folder' if is_dir else 'file', None if is_dir else int(item.get('size') or 0), modified, posixpath.join(path, item['name'])))
        token = response.get('nextPageToken')
        if not token:
            return entries


_LISTERS = {'ftp': _list_ftp, 'sftp': _list_sftp, 'dropbox': _list_dropbox, 'drive': _list_drive}


def list_remote(conn, path: str | None) -> dict:
    provider = provider_of(conn)
    target = normalize_remote(path)
    try:
        entries = _LISTERS[provider](conn, target)
    except FileServiceError:
        raise
    except FileNotFoundError:
        raise FileServiceError('Klasör bulunamadı', 404)
    except PermissionError:
        raise FileServiceError('Bu klasörü okuma izniniz yok', 403)
    except Exception as error:
        raise FileServiceError('Uzak klasör listelenemedi', 502, type(error).__name__) from error
    parent = posixpath.dirname(target) if target != '/' else None
    return {"path": target, "parent": parent, "crumbs": remote_crumbs(target), "entries": entries}


# ---------------------------------------------------------------- aktarım

def _remote_exists(provider, conn, remote_file):
    try:
        if provider == 'sftp':
            conn.sftp.stat(remote_file)
            return True
        if provider == 'ftp':
            return conn.ftp.size(remote_file) is not None
        if provider == 'dropbox':
            conn.dbx.files_get_metadata(remote_file)
            return True
    except Exception:
        return False
    return False


def upload(conn, local_dir: str, name: str, remote_dir: str, overwrite: bool = False) -> dict:
    provider = provider_of(conn)
    name = _validate_name(name)
    local_file = Path(local_dir) / name
    if not local_file.is_file():
        raise FileServiceError('Yerel dosya bulunamadı', 404)
    remote_dir = normalize_remote(remote_dir)
    remote_file = posixpath.join(remote_dir, name)
    size = local_file.stat().st_size

    try:
        if provider == 'drive':
            service = conn.service
            folder_id = _drive_resolve_folder(service, remote_dir)
            existing = _drive_find_file(service, folder_id, name)
            if existing and not overwrite:
                raise FileServiceError('Hedefte aynı adlı dosya var', 409, 'exists')
            from googleapiclient.http import MediaFileUpload  # yalnızca Drive bağlıyken gerekli
            media = MediaFileUpload(str(local_file), mimetype='application/octet-stream', resumable=True)
            if existing:
                service.files().update(fileId=existing, media_body=media).execute()
            else:
                service.files().create(body={'name': name, 'parents': [folder_id]}, media_body=media, fields='id').execute()
        else:
            if not overwrite and _remote_exists(provider, conn, remote_file):
                raise FileServiceError('Hedefte aynı adlı dosya var', 409, 'exists')
            if provider == 'sftp':
                conn.sftp.put(str(local_file), remote_file)
            elif provider == 'ftp':
                with local_file.open('rb') as handle:
                    conn.ftp.storbinary(f'STOR {remote_file}', handle)
            else:
                import dropbox  # yalnızca Dropbox bağlıyken gerekli
                with local_file.open('rb') as handle:
                    conn.dbx.files_upload(handle.read(), remote_file, mode=dropbox.files.WriteMode.overwrite)
    except FileServiceError:
        raise
    except PermissionError:
        raise FileServiceError('Hedef klasöre yazma izniniz yok', 403)
    except Exception as error:
        raise FileServiceError('Yükleme başarısız oldu', 502, type(error).__name__) from error
    return {"name": name, "size": size, "to": remote_file}


def download(conn, remote_dir: str, name: str, local_dir: str, overwrite: bool = False) -> dict:
    provider = provider_of(conn)
    name = _validate_name(name)
    target_dir = Path(local_dir)
    if not target_dir.is_dir():
        raise FileServiceError('Yerel hedef klasör bulunamadı', 404)
    local_file = target_dir / name
    if local_file.exists() and not overwrite:
        raise FileServiceError('Hedefte aynı adlı dosya var', 409, 'exists')
    remote_dir = normalize_remote(remote_dir)
    remote_file = posixpath.join(remote_dir, name)
    partial = local_file.with_name(local_file.name + '.cgpart')

    try:
        if provider == 'sftp':
            conn.sftp.get(remote_file, str(partial))
        elif provider == 'ftp':
            with partial.open('wb') as handle:
                conn.ftp.retrbinary(f'RETR {remote_file}', handle.write)
        elif provider == 'dropbox':
            conn.dbx.files_download_to_file(str(partial), remote_file)
        else:
            service = conn.service
            file_id = _drive_find_file(service, _drive_resolve_folder(service, remote_dir), name)
            if not file_id:
                raise FileServiceError('Uzak dosya bulunamadı', 404)
            from googleapiclient.http import MediaIoBaseDownload
            with partial.open('wb') as handle:
                downloader = MediaIoBaseDownload(handle, service.files().get_media(fileId=file_id))
                done = False
                while not done:
                    _, done = downloader.next_chunk()
        os.replace(partial, local_file)
    except FileServiceError:
        partial.unlink(missing_ok=True)
        raise
    except PermissionError:
        partial.unlink(missing_ok=True)
        raise FileServiceError('Yerel klasöre yazma izniniz yok', 403)
    except Exception as error:
        partial.unlink(missing_ok=True)
        raise FileServiceError('İndirme başarısız oldu', 502, type(error).__name__) from error
    return {"name": name, "size": local_file.stat().st_size, "to": str(local_file)}


# ---------------------------------------------------------------- silme ve izinler

def delete_local(path: str) -> None:
    target = Path(path)
    if not target.exists():
        raise FileServiceError('Dosya bulunamadı', 404)
    if target.is_dir():
        raise FileServiceError('Klasör silme henüz desteklenmiyor', 400)
    try:
        target.unlink()
    except PermissionError:
        raise FileServiceError('Bu dosyayı silme izniniz yok', 403)


def delete_remote(conn, path: str) -> None:
    provider = provider_of(conn)
    remote_file = normalize_remote(path)
    if remote_file == '/':
        raise FileServiceError('Kök klasör silinemez', 400)
    try:
        if provider == 'sftp':
            if stat.S_ISDIR(conn.sftp.stat(remote_file).st_mode or 0):
                raise FileServiceError('Klasör silme henüz desteklenmiyor', 400)
            conn.sftp.remove(remote_file)
        elif provider == 'ftp':
            conn.ftp.delete(remote_file)
        elif provider == 'dropbox':
            metadata = conn.dbx.files_get_metadata(remote_file)
            if not hasattr(metadata, 'size'):
                raise FileServiceError('Klasör silme henüz desteklenmiyor', 400)
            conn.dbx.files_delete_v2(remote_file)
        else:
            service = conn.service
            folder_id = _drive_resolve_folder(service, posixpath.dirname(remote_file))
            file_id = _drive_find_file(service, folder_id, posixpath.basename(remote_file))
            if not file_id:
                raise FileServiceError('Uzak dosya bulunamadı', 404)
            service.files().delete(fileId=file_id).execute()
    except FileServiceError:
        raise
    except FileNotFoundError:
        raise FileServiceError('Uzak dosya bulunamadı', 404)
    except PermissionError:
        raise FileServiceError('Bu dosyayı silme izniniz yok', 403)
    except Exception as error:
        raise FileServiceError('Silme başarısız oldu', 502, type(error).__name__) from error


def remote_details(conn, path: str) -> dict:
    """FTP/SFTP için izinleri döndürür; bulut sağlayıcılarında izin kavramı yoktur."""
    provider = provider_of(conn)
    remote_file = normalize_remote(path)
    try:
        if provider == 'sftp':
            return {"path": remote_file, "permissions": oct(conn.sftp.stat(remote_file).st_mode or 0)[-3:], "canChmod": True}
        if provider == 'ftp':
            lines = []
            conn.ftp.retrlines(f'LIST {remote_file}', lines.append)
            rwx = lines[0].split()[0] if lines else ''
            return {"path": remote_file, "permissions": _rwx_to_octal(rwx) if len(rwx) >= 10 else None, "canChmod": True}
    except Exception as error:
        raise FileServiceError('Dosya bilgisi alınamadı', 502, type(error).__name__) from error
    return {"path": remote_file, "permissions": None, "canChmod": False}


def _rwx_to_octal(rwx: str) -> str:
    values = {'r': 4, 'w': 2, 'x': 1}
    return ''.join(str(sum(values.get(char, 0) for char in rwx[start:start + 3])) for start in (1, 4, 7))


def chmod_remote(conn, path: str, mode: str) -> None:
    provider = provider_of(conn)
    if not (isinstance(mode, str) and len(mode) == 3 and all(char in '01234567' for char in mode)):
        raise FileServiceError('İzin üç haneli sekizlik olmalı (ör. 644)', 400)
    remote_file = normalize_remote(path)
    try:
        if provider == 'sftp':
            conn.sftp.chmod(remote_file, int(mode, 8))
        elif provider == 'ftp':
            conn.ftp.sendcmd(f'SITE CHMOD {mode} {remote_file}')
        else:
            raise FileServiceError('Bu sağlayıcıda dosya izinleri yok', 400)
    except FileServiceError:
        raise
    except Exception as error:
        raise FileServiceError('İzinler değiştirilemedi', 502, type(error).__name__) from error
