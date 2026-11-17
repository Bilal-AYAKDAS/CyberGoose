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

import csv
import ftplib
import io
import logging
import os
import posixpath
import shutil
import stat
import string
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

logger = logging.getLogger(__name__)


class FileServiceError(Exception):
    """HTTP durum koduyla birlikte kullanıcıya gösterilebilir hata."""

    def __init__(self, message: str, status: int = 400, code: str | None = None, extra: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        # Arayüzün karar vermesi için ek alanlar (ör. SFTP sunucu anahtarı parmak izi).
        self.extra = extra or {}


class TransferCancelled(FileServiceError):
    def __init__(self):
        super().__init__('Aktarım iptal edildi', 499, 'cancelled')


DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'
DRIVE_WORKSPACE_PREFIX = 'application/vnd.google-apps.'
DROPBOX_CHUNK_SIZE = 8 * 1024 * 1024
ONEDRIVE_SIMPLE_LIMIT = 4 * 1024 * 1024
ONEDRIVE_CHUNK_SIZE = 5 * 1024 * 1024
GRAPH_DRIVE_ROOT = 'https://graph.microsoft.com/v1.0/me/drive'
TRANSFER_CHUNK = 64 * 1024


def _is_auth_error(error: Exception) -> bool:
    return type(error).__name__ in ('AuthError', 'RefreshError')


def _raise_provider_error(action: str, error: Exception) -> None:
    if _is_auth_error(error):
        raise FileServiceError('Oturum süresi doldu veya geçersiz. Yeniden bağlanın.', 401, 'auth_error') from error
    raise FileServiceError(action, 502, type(error).__name__) from error


def _iso(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp).isoformat(timespec='seconds')


def _entry(name, kind, size, modified, path, hidden=None):
    return {
        "name": name,
        "kind": kind,
        "size": size,
        "modified": modified,
        "path": path,
        # Nokta ile başlayan adlar her yerde gizli sayılır; Windows'ta ayrıca "gizli" özniteliği.
        # Yarım aktarım (.cgpart) ve düzenleyici geçici dosyaları da gizli sayılır.
        "hidden": bool(hidden) or name.startswith('.') or name.endswith(('.cgpart', '.cgtmp', '.cgbak')),
    }


FILE_ATTRIBUTE_HIDDEN = 0x2
MAX_PLAN_FILES = 50_000


def _validate_name(name: str) -> str:
    if not name or name in ('.', '..') or '/' in name or '\\' in name:
        raise FileServiceError('Geçersiz dosya adı', 400)
    return name


# ---------------------------------------------------------------- yerel

def home_directory() -> str:
    return str(Path.home())


def list_local_drives() -> list[str]:
    if os.name != 'nt':
        return ['/']
    if hasattr(os, 'listdrives'):
        return list(os.listdrives())
    return [f'{letter}:\\' for letter in string.ascii_uppercase if os.path.exists(f'{letter}:\\')]


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
        attributes = getattr(info, 'st_file_attributes', 0) or 0
        entries.append(_entry(
            child.name,
            'folder' if is_dir else 'file',
            None if is_dir else info.st_size,
            _iso(info.st_mtime),
            str(Path(child.path)),
            hidden=bool(attributes & FILE_ATTRIBUTE_HIDDEN),
        ))
    parent = str(target.parent) if target.parent != target else None
    return {"path": str(target), "parent": parent, "crumbs": local_crumbs(str(target)), "entries": entries}


def local_stat(path: str) -> dict:
    """Sürükle bırak ile gelen bir yolun dosya mı klasör mü olduğunu söyler."""
    if not path:
        raise FileServiceError('Yol gerekli', 400)
    target = Path(path).expanduser()
    try:
        info = target.stat()
    except FileNotFoundError:
        raise FileServiceError('Öğe bulunamadı', 404)
    except PermissionError:
        raise FileServiceError('Bu öğeyi okuma izniniz yok', 403)
    is_dir = stat.S_ISDIR(info.st_mode)
    return {
        "name": target.name or str(target),
        "path": str(target),
        "parent": str(target.parent),
        "kind": 'folder' if is_dir else 'file',
        "size": None if is_dir else info.st_size,
        "modified": _iso(info.st_mtime),
    }


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
    if getattr(conn, 'onedrive', None) is not None:
        return 'onedrive'
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
    items = service.files().list(q=query, pageSize=1, fields='files(id, mimeType, size)').execute().get('files', [])
    return items[0] if items else None


def _drive_find_entry(service, folder_id, name):
    query = f"name = '{_drive_escape(name)}' and '{folder_id}' in parents and trashed = false"
    items = service.files().list(q=query, pageSize=1, fields='files(id, mimeType)').execute().get('files', [])
    return items[0] if items else None


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


def _onedrive_url(path: str, suffix: str = '') -> str:
    clean = path.strip('/')
    if not clean:
        return f'{GRAPH_DRIVE_ROOT}/root{suffix}'
    encoded = '/'.join(quote(part, safe='') for part in clean.split('/'))
    return f'{GRAPH_DRIVE_ROOT}/root:/{encoded}:{suffix}' if suffix else f'{GRAPH_DRIVE_ROOT}/root:/{encoded}'


def _onedrive_check(response) -> dict | None:
    if response.status_code == 401:
        raise FileServiceError('OneDrive oturumu süresi doldu. Yeniden bağlanın.', 401, 'auth_error')
    if response.status_code == 404:
        raise FileServiceError('Uzak öğe bulunamadı', 404)
    if response.status_code == 409:
        raise FileServiceError('Bu adda bir öğe zaten var', 409, 'exists')
    if not response.ok:
        raise FileServiceError(f'OneDrive hatası ({response.status_code})', 502)
    return response.json() if response.content else None


def _list_onedrive(conn, path):
    url = _onedrive_url(path, '/children' if path == '/' else ':/children')
    if path != '/':
        encoded = '/'.join(quote(part, safe='') for part in path.strip('/').split('/'))
        url = f'{GRAPH_DRIVE_ROOT}/root:/{encoded}:/children'
    entries = []
    while url:
        data = _onedrive_check(conn.session.get(url, timeout=20)) or {}
        for item in data.get('value', []):
            is_dir = 'folder' in item
            modified = item.get('lastModifiedDateTime')
            if modified:
                modified = datetime.fromisoformat(modified.replace('Z', '+00:00')).astimezone().replace(tzinfo=None).isoformat(timespec='seconds')
            entries.append(_entry(
                item['name'],
                'folder' if is_dir else 'file',
                None if is_dir else int(item.get('size') or 0),
                modified,
                posixpath.join(path, item['name']),
            ))
        url = data.get('@odata.nextLink')
    return entries


_LISTERS = {'ftp': _list_ftp, 'sftp': _list_sftp, 'dropbox': _list_dropbox, 'drive': _list_drive, 'onedrive': _list_onedrive}


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
        _raise_provider_error('Uzak klasör listelenemedi', error)
    parent = posixpath.dirname(target) if target != '/' else None
    return {"path": target, "parent": parent, "crumbs": remote_crumbs(target), "entries": entries}


# ---------------------------------------------------------------- aktarım

def _remote_exists(provider, conn, remote_file):
    try:
        if provider == 'sftp':
            conn.sftp.stat(remote_file)
            return True
        if provider == 'ftp':
            return _remote_size('ftp', conn, remote_file) is not None
        if provider == 'dropbox':
            conn.dbx.files_get_metadata(remote_file)
            return True
        if provider == 'onedrive':
            resp = conn.session.get(_onedrive_url(remote_file), timeout=15)
            return resp.status_code == 200
    except Exception:
        return False
    return False


def _check_cancel(cancel_event) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise TransferCancelled()


def _remote_size(provider, conn, remote_file) -> int | None:
    """Uzak dosyanın boyutu; yoksa veya öğrenilemiyorsa None."""
    try:
        if provider == 'sftp':
            return conn.sftp.stat(remote_file).st_size
        if provider == 'ftp':
            conn.ftp.voidcmd('TYPE I')  # SIZE bazı sunucularda ASCII kipinde reddedilir.
            return conn.ftp.size(remote_file)
        if provider == 'dropbox':
            return getattr(conn.dbx.files_get_metadata(remote_file), 'size', None)
        if provider == 'onedrive':
            resp = conn.session.get(_onedrive_url(remote_file), timeout=15)
            return int(resp.json().get('size')) if resp.status_code == 200 else None
        if provider == 'drive':
            service = conn.service
            found = _drive_find_file(service, _drive_resolve_folder(service, posixpath.dirname(remote_file)), posixpath.basename(remote_file))
            return int(found['size']) if found and found.get('size') is not None else None
    except Exception:
        return None
    return None


def _sftp_put_from(conn, local_file: Path, remote_file: str, offset: int, report) -> None:
    """SFTP yüklemesini `offset` baytından sürdürür (kesilen aktarım)."""
    with local_file.open('rb') as source, conn.sftp.open(remote_file, 'r+b' if offset else 'wb') as target:
        source.seek(offset)
        target.seek(offset)
        target.set_pipelined(True)
        done = offset
        for chunk in iter(lambda: source.read(TRANSFER_CHUNK), b''):
            target.write(chunk)
            done += len(chunk)
            report(done)


def upload(
    conn,
    local_dir: str,
    name: str,
    remote_dir: str,
    overwrite: bool = False,
    progress_cb=None,
    cancel_event=None,
    resume: bool = False,
) -> dict:
    """Yerel dosyayı uzak klasöre yükler.

    `resume` yalnızca FTP/SFTP'de anlamlıdır: hedefte daha küçük bir dosya varsa (yarım kalmış
    aktarım) eksik kısım eklenir. Aynı boyuttaysa dosya zaten tamdır.
    """
    provider = provider_of(conn)
    name = _validate_name(name)
    local_file = Path(local_dir) / name
    if not local_file.is_file():
        raise FileServiceError('Yerel dosya bulunamadı', 404)
    remote_dir = normalize_remote(remote_dir)
    remote_file = posixpath.join(remote_dir, name)
    size = local_file.stat().st_size

    def report(done: int, total: int = size) -> None:
        _check_cancel(cancel_event)
        if progress_cb is not None:
            progress_cb(done, total)

    resumed_from = 0
    try:
        _check_cancel(cancel_event)
        if provider == 'drive':
            service = conn.service
            folder_id = _drive_resolve_folder(service, remote_dir)
            existing = _drive_find_file(service, folder_id, name)
            if existing and not overwrite:
                raise FileServiceError('Hedefte aynı adlı dosya var', 409, 'exists')
            from googleapiclient.http import MediaFileUpload  # yalnızca Drive bağlıyken gerekli
            media = MediaFileUpload(str(local_file), mimetype='application/octet-stream', resumable=True)
            req = (
                service.files().update(fileId=existing['id'], media_body=media)
                if existing
                else service.files().create(body={'name': name, 'parents': [folder_id]}, media_body=media, fields='id')
            )
            response = None
            while response is None:
                _check_cancel(cancel_event)
                status, response = req.next_chunk()
                if status is not None:
                    report(int(status.resumable_progress), size)
            report(size, size)
        else:
            if resume and provider in ('ftp', 'sftp'):
                existing_size = _remote_size(provider, conn, remote_file)
                if existing_size is not None and 0 < existing_size <= size:
                    resumed_from = existing_size
            if not resumed_from and not overwrite and _remote_exists(provider, conn, remote_file):
                raise FileServiceError('Hedefte aynı adlı dosya var', 409, 'exists')
            if resumed_from == size:
                report(size, size)
            elif provider == 'sftp':
                if resumed_from:
                    _sftp_put_from(conn, local_file, remote_file, resumed_from, report)
                else:
                    conn.sftp.put(str(local_file), remote_file, callback=lambda done, total: report(done, total or size))
            elif provider == 'ftp':
                transferred = resumed_from

                def on_block(chunk: bytes) -> None:
                    nonlocal transferred
                    transferred += len(chunk)
                    report(transferred, size)

                with local_file.open('rb') as handle:
                    if resumed_from:
                        handle.seek(resumed_from)
                        conn.ftp.storbinary(f'APPE {remote_file}', handle, blocksize=TRANSFER_CHUNK, callback=on_block)
                    else:
                        conn.ftp.storbinary(f'STOR {remote_file}', handle, blocksize=TRANSFER_CHUNK, callback=on_block)
            elif provider == 'onedrive':
                _upload_onedrive(conn.session, local_file, remote_file, size, report=report, cancel_event=cancel_event)
            else:
                import dropbox  # yalnızca Dropbox bağlıyken gerekli
                _upload_dropbox(conn.dbx, local_file, remote_file, size, dropbox, report=report, cancel_event=cancel_event)
    except FileServiceError:
        raise
    except PermissionError:
        raise FileServiceError('Hedef klasöre yazma izniniz yok', 403)
    except Exception as error:
        _raise_provider_error('Yükleme başarısız oldu', error)
    return {"name": name, "size": size, "to": remote_file, "resumedFrom": resumed_from}


def _upload_dropbox(dbx, local_file: Path, remote_file: str, size: int, dropbox_mod, report=None, cancel_event=None) -> None:
    write_mode = dropbox_mod.files.WriteMode.overwrite
    with local_file.open('rb') as handle:
        if size <= DROPBOX_CHUNK_SIZE:
            _check_cancel(cancel_event)
            dbx.files_upload(handle.read(), remote_file, mode=write_mode)
            if report is not None:
                report(size, size)
            return
        _check_cancel(cancel_event)
        session = dbx.files_upload_session_start(handle.read(DROPBOX_CHUNK_SIZE))
        cursor = dropbox_mod.files.UploadSessionCursor(session_id=session.session_id, offset=handle.tell())
        if report is not None:
            report(handle.tell(), size)
        commit = dropbox_mod.files.CommitInfo(path=remote_file, mode=write_mode)
        while handle.tell() < size:
            _check_cancel(cancel_event)
            chunk = handle.read(DROPBOX_CHUNK_SIZE)
            if handle.tell() >= size:
                dbx.files_upload_session_finish(chunk, cursor, commit)
            else:
                dbx.files_upload_session_append_v2(chunk, cursor)
                cursor.offset = handle.tell()
            if report is not None:
                report(handle.tell(), size)


def _upload_onedrive(session, local_file: Path, remote_file: str, size: int, report=None, cancel_event=None) -> None:
    if size <= ONEDRIVE_SIMPLE_LIMIT:
        _check_cancel(cancel_event)
        with local_file.open('rb') as handle:
            _onedrive_check(session.put(_onedrive_url(remote_file, '/content'), data=handle.read(), timeout=60))
        if report is not None:
            report(size, size)
        return
    session_data = _onedrive_check(
        session.post(_onedrive_url(remote_file, '/createUploadSession'), json={'item': {'@microsoft.graph.conflictBehavior': 'replace'}}, timeout=20)
    ) or {}
    upload_url = session_data.get('uploadUrl')
    if not upload_url:
        raise FileServiceError('OneDrive yükleme oturumu açılamadı', 502)
    with local_file.open('rb') as handle:
        offset = 0
        while offset < size:
            _check_cancel(cancel_event)
            chunk = handle.read(ONEDRIVE_CHUNK_SIZE)
            end = offset + len(chunk) - 1
            headers = {'Content-Length': str(len(chunk)), 'Content-Range': f'bytes {offset}-{end}/{size}'}
            resp = session.put(upload_url, data=chunk, headers=headers, timeout=60)
            if not resp.ok:
                raise FileServiceError(f'OneDrive parça yükleme hatası ({resp.status_code})', 502)
            offset += len(chunk)
            if report is not None:
                report(offset, size)


def download(
    conn,
    remote_dir: str,
    name: str,
    local_dir: str,
    overwrite: bool = False,
    progress_cb=None,
    cancel_event=None,
    resume: bool = False,
) -> dict:
    """Uzak dosyayı önce `<ad>.cgpart` dosyasına indirir, bitince yerine taşır.

    FTP/SFTP'de aktarım hata ile kesilirse `.cgpart` silinmez; `resume=True` ile yeniden
    denendiğinde indirme kaldığı bayttan sürer. İptal edilen aktarımın parçası silinir.
    """
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
    resumable = provider in ('ftp', 'sftp')
    offset = partial.stat().st_size if resume and resumable and partial.is_file() else 0

    def report(done: int, total: int | None = None) -> None:
        _check_cancel(cancel_event)
        if progress_cb is not None:
            progress_cb(done, total)

    try:
        _check_cancel(cancel_event)
        if provider == 'sftp':
            if offset:
                total_size = conn.sftp.stat(remote_file).st_size
                if offset > (total_size or 0):
                    offset = 0  # Uzak dosya değişmiş; baştan indir.
            if offset:
                with conn.sftp.open(remote_file, 'rb') as source, partial.open('ab') as handle:
                    source.seek(offset)
                    source.prefetch(total_size)
                    done = offset
                    for chunk in iter(lambda: source.read(TRANSFER_CHUNK), b''):
                        handle.write(chunk)
                        done += len(chunk)
                        report(done, total_size)
            else:
                conn.sftp.get(remote_file, str(partial), callback=lambda done, total: report(done, total or None))
        elif provider == 'ftp':
            total_size = _remote_size('ftp', conn, remote_file)
            if offset and total_size is not None and offset > total_size:
                offset = 0
            transferred = offset
            with partial.open('ab' if offset else 'wb') as handle:
                def on_chunk(chunk: bytes) -> None:
                    nonlocal transferred
                    _check_cancel(cancel_event)
                    handle.write(chunk)
                    transferred += len(chunk)
                    report(transferred, total_size)

                conn.ftp.retrbinary(f'RETR {remote_file}', on_chunk, blocksize=TRANSFER_CHUNK, rest=offset or None)
        elif provider == 'dropbox':
            conn.dbx.files_download_to_file(str(partial), remote_file)
            report(partial.stat().st_size, partial.stat().st_size)
        elif provider == 'onedrive':
            with conn.session.get(_onedrive_url(remote_file, '/content'), stream=True, timeout=60) as resp:
                if resp.status_code in (401, 404):
                    _onedrive_check(resp)
                if not resp.ok:
                    raise FileServiceError(f'OneDrive indirme hatası ({resp.status_code})', 502)
                total_header = resp.headers.get('Content-Length')
                total_size = int(total_header) if total_header and total_header.isdigit() else None
                transferred = 0
                with partial.open('wb') as handle:
                    for chunk in resp.iter_content(chunk_size=TRANSFER_CHUNK):
                        if not chunk:
                            continue
                        _check_cancel(cancel_event)
                        handle.write(chunk)
                        transferred += len(chunk)
                        report(transferred, total_size)
        else:
            service = conn.service
            found = _drive_find_file(service, _drive_resolve_folder(service, remote_dir), name)
            if not found:
                raise FileServiceError('Uzak dosya bulunamadı', 404)
            if str(found.get('mimeType') or '').startswith(DRIVE_WORKSPACE_PREFIX):
                raise FileServiceError('Google Workspace dosyaları (Docs/Sheets/Slides) doğrudan indirilemiyor.', 400, 'google_workspace_file')
            from googleapiclient.http import MediaIoBaseDownload
            with partial.open('wb') as handle:
                downloader = MediaIoBaseDownload(handle, service.files().get_media(fileId=found['id']))
                done = False
                while not done:
                    _check_cancel(cancel_event)
                    status, done = downloader.next_chunk()
                    if status is not None:
                        report(int(status.resumable_progress), int(status.total_size) if status.total_size else None)
        os.replace(partial, local_file)
    except TransferCancelled:
        partial.unlink(missing_ok=True)
        raise
    except FileServiceError:
        _discard_partial(partial, resumable)
        raise
    except PermissionError:
        _discard_partial(partial, resumable)
        raise FileServiceError('Yerel klasöre yazma izniniz yok', 403)
    except Exception as error:
        _discard_partial(partial, resumable)
        _raise_provider_error('İndirme başarısız oldu', error)
    return {"name": name, "size": local_file.stat().st_size, "to": str(local_file), "resumedFrom": offset}


def _discard_partial(partial: Path, resumable: bool) -> None:
    """Sürdürülebilir sağlayıcıda dolu parça kalır (yeniden denemede kaldığı yerden devam eder)."""
    try:
        if not resumable or partial.stat().st_size == 0:
            partial.unlink(missing_ok=True)
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------- silme ve izinler

def _sftp_rmtree(sftp, path: str) -> None:
    for attr in sftp.listdir_attr(path):
        child = posixpath.join(path, attr.filename)
        if stat.S_ISDIR(attr.st_mode or 0):
            _sftp_rmtree(sftp, child)
        else:
            sftp.remove(child)
    sftp.rmdir(path)


def _ftp_rmtree(conn, path: str) -> None:
    for entry in _list_ftp(conn, path):
        if entry['kind'] == 'folder':
            _ftp_rmtree(conn, entry['path'])
        else:
            conn.ftp.delete(entry['path'])
    conn.ftp.rmd(path)


def delete_local(path: str, permanent: bool = False) -> dict:
    """Varsayılan olarak Geri Dönüşüm Kutusu'na taşır; `permanent=True` kalıcı siler."""
    target = Path(path)
    if not target.exists() and not target.is_symlink():
        raise FileServiceError('Öğe bulunamadı', 404)
    if not permanent:
        if _bypasses_recycle_bin(target):
            raise FileServiceError(
                "Bu sürücüde (ağ veya çıkarılabilir) Geri Dönüşüm Kutusu yok; öğe kalıcı olarak silinir. "
                "Devam etmek için kalıcı silmeyi seçin.",
                409, 'trash_unavailable',
            )
        try:
            from send2trash import send2trash
            send2trash(str(target))
            return {"trashed": True}
        except PermissionError:
            raise FileServiceError('Bu öğeyi silme izniniz yok', 403)
        except Exception as error:
            raise FileServiceError(
                "Öğe Geri Dönüşüm Kutusu'na taşınamadı. Kalıcı olarak silmeyi deneyebilirsiniz.",
                409, 'trash_failed',
            ) from error
    is_link = target.is_symlink() or _is_junction(target)
    try:
        if is_link and target.is_dir():
            os.rmdir(target)  # Bağlantının kendisi silinir, hedefindeki dosyalar değil.
        elif target.is_dir() and not is_link:
            shutil.rmtree(target)
        else:
            target.unlink()
    except PermissionError:
        raise FileServiceError('Bu öğeyi silme izniniz yok', 403)
    except OSError as error:
        raise FileServiceError(f'Öğe silinemedi: {error.strerror or error}', 409, 'delete_failed') from error
    return {"trashed": False}


def _is_junction(path: Path) -> bool:
    checker = getattr(path, 'is_junction', None)  # Python 3.12+
    try:
        return bool(checker()) if checker else False
    except OSError:
        return False


def _bypasses_recycle_bin(path: Path) -> bool:
    """Windows ağ ve çıkarılabilir sürücülerde 'çöpe taşı' sessizce kalıcı silmeye dönüşür."""
    if os.name != 'nt':
        return False
    try:
        import ctypes

        anchor = path.resolve().anchor or str(path)[:3]
        drive_type = ctypes.windll.kernel32.GetDriveTypeW(anchor)
    except Exception:
        return False
    return drive_type in (2, 4)  # DRIVE_REMOVABLE, DRIVE_REMOTE


def _delete_sftp(conn, remote_file: str) -> None:
    if stat.S_ISDIR(conn.sftp.stat(remote_file).st_mode or 0):
        _sftp_rmtree(conn.sftp, remote_file)
    else:
        conn.sftp.remove(remote_file)


def _ftp_is_dir(conn, path: str) -> bool:
    ftp = conn.ftp
    current = ftp.pwd()
    try:
        ftp.cwd(path)
        return True
    except ftplib.error_perm:
        return False
    finally:
        try:
            ftp.cwd(current)
        except ftplib.all_errors:
            pass


def _delete_ftp(conn, remote_file: str) -> None:
    """Klasörse içeriğiyle siler, değilse dosyayı siler. Hata yutulmaz (izin hatası klasör sanılmaz)."""
    if _ftp_is_dir(conn, remote_file):
        _ftp_rmtree(conn, remote_file)
    else:
        conn.ftp.delete(remote_file)


def _delete_drive(conn, remote_file: str) -> None:
    service = conn.service
    folder_id = _drive_resolve_folder(service, posixpath.dirname(remote_file))
    found = _drive_find_entry(service, folder_id, posixpath.basename(remote_file))
    if not found:
        raise FileServiceError('Uzak öğe bulunamadı', 404)
    service.files().delete(fileId=found['id']).execute()


def _delete_onedrive(conn, remote_file: str) -> None:
    _onedrive_check(conn.session.delete(_onedrive_url(remote_file), timeout=20))


_DELETE_HANDLERS = {
    'sftp': _delete_sftp,
    'ftp': _delete_ftp,
    'dropbox': lambda conn, path: conn.dbx.files_delete_v2(path),
    'drive': _delete_drive,
    'onedrive': _delete_onedrive,
}


def delete_remote(conn, path: str) -> None:
    provider = provider_of(conn)
    remote_file = normalize_remote(path)
    if remote_file == '/':
        raise FileServiceError('Kök klasör silinemez', 400)
    try:
        _DELETE_HANDLERS[provider](conn, remote_file)
    except FileServiceError:
        raise
    except FileNotFoundError:
        raise FileServiceError('Uzak öğe bulunamadı', 404)
    except PermissionError:
        raise FileServiceError('Bu öğeyi silme izniniz yok', 403)
    except Exception as error:
        _raise_provider_error('Silme başarısız oldu', error)


def create_local_folder(parent_dir: str, name: str) -> dict:
    name = _validate_name(name.strip())
    parent = Path(parent_dir)
    if not parent.is_dir():
        raise FileServiceError('Üst klasör bulunamadı', 404)
    target = parent / name
    if target.exists():
        raise FileServiceError('Bu adda bir öğe zaten var', 409, 'exists')
    try:
        target.mkdir()
    except PermissionError:
        raise FileServiceError('Klasör oluşturma izniniz yok', 403)
    return {"name": name, "path": str(target)}


def _mkdir_drive(conn, parent: str, name: str, _target: str) -> None:
    service = conn.service
    folder_id = _drive_resolve_folder(service, parent)
    if _drive_find_entry(service, folder_id, name):
        raise FileServiceError('Bu adda bir öğe zaten var', 409, 'exists')
    service.files().create(
        body={'name': name, 'parents': [folder_id], 'mimeType': DRIVE_FOLDER_MIME},
        fields='id',
    ).execute()


def _mkdir_onedrive(conn, parent: str, name: str, _target: str) -> None:
    url = f'{GRAPH_DRIVE_ROOT}/root/children' if parent == '/' else _onedrive_url(parent, '/children')
    _onedrive_check(conn.session.post(url, json={'name': name, 'folder': {}, '@microsoft.graph.conflictBehavior': 'fail'}, timeout=20))


_MKDIR_HANDLERS = {
    'sftp': lambda conn, _p, _n, target: conn.sftp.mkdir(target),
    'ftp': lambda conn, _p, _n, target: conn.ftp.mkd(target),
    'dropbox': lambda conn, _p, _n, target: conn.dbx.files_create_folder_v2(target),
    'drive': _mkdir_drive,
    'onedrive': _mkdir_onedrive,
}


def create_remote_folder(conn, parent_dir: str, name: str) -> dict:
    provider = provider_of(conn)
    name = _validate_name(name.strip())
    parent = normalize_remote(parent_dir)
    target = posixpath.join(parent, name)
    try:
        _MKDIR_HANDLERS[provider](conn, parent, name, target)
    except FileServiceError:
        raise
    except PermissionError:
        raise FileServiceError('Klasör oluşturma izniniz yok', 403)
    except Exception as error:
        _raise_provider_error('Klasör oluşturulamadı', error)
    return {"name": name, "path": target}


def rename_local(path: str, new_name: str) -> dict:
    new_name = _validate_name(new_name.strip())
    target = Path(path)
    if not target.exists():
        raise FileServiceError('Öğe bulunamadı', 404)
    destination = target.with_name(new_name)
    if destination.exists():
        raise FileServiceError('Bu adda bir öğe zaten var', 409, 'exists')
    try:
        target.rename(destination)
    except PermissionError:
        raise FileServiceError('Yeniden adlandırma izniniz yok', 403)
    return {"name": new_name, "path": str(destination)}


def _rename_drive(conn, remote_path: str, parent: str, new_name: str, _dest: str) -> None:
    service = conn.service
    folder_id = _drive_resolve_folder(service, parent)
    found = _drive_find_entry(service, folder_id, posixpath.basename(remote_path))
    if not found:
        raise FileServiceError('Uzak öğe bulunamadı', 404)
    service.files().update(fileId=found['id'], body={'name': new_name}).execute()


def _rename_onedrive(conn, remote_path: str, _parent: str, new_name: str, _dest: str) -> None:
    _onedrive_check(conn.session.patch(_onedrive_url(remote_path), json={'name': new_name}, timeout=20))


_RENAME_HANDLERS = {
    'sftp': lambda conn, src, _p, _n, dest: conn.sftp.rename(src, dest),
    'ftp': lambda conn, src, _p, _n, dest: conn.ftp.rename(src, dest),
    'dropbox': lambda conn, src, _p, _n, dest: conn.dbx.files_move_v2(src, dest),
    'drive': _rename_drive,
    'onedrive': _rename_onedrive,
}


def rename_remote(conn, path: str, new_name: str) -> dict:
    provider = provider_of(conn)
    new_name = _validate_name(new_name.strip())
    remote_path = normalize_remote(path)
    if remote_path == '/':
        raise FileServiceError('Kök klasör yeniden adlandırılamaz', 400)
    parent = posixpath.dirname(remote_path)
    destination = posixpath.join(parent, new_name)
    try:
        _RENAME_HANDLERS[provider](conn, remote_path, parent, new_name, destination)
    except FileServiceError:
        raise
    except PermissionError:
        raise FileServiceError('Yeniden adlandırma izniniz yok', 403)
    except Exception as error:
        _raise_provider_error('Yeniden adlandırılamadı', error)
    return {"name": new_name, "path": destination}


MAX_REMOTE_EDIT_BYTES = 256 * 1024


def plan_local_folder(path: str) -> dict:
    root = Path(path)
    if not root.is_dir():
        raise FileServiceError('Klasör bulunamadı', 404)
    collected = []
    for current, _dirs, filenames in os.walk(root):
        if len(collected) > MAX_PLAN_FILES:
            raise FileServiceError(f'Klasörde {MAX_PLAN_FILES} dosyadan fazlası var; daha küçük parçalar halinde aktarın.', 400, 'too_many_files')
        rel = Path(current).relative_to(root)
        rel_str = '' if str(rel) == '.' else rel.as_posix()
        for fname in filenames:
            fpath = Path(current) / fname
            try:
                fsize = fpath.stat().st_size
            except OSError:
                fsize = None
            collected.append({"relativeDir": rel_str, "name": fname, "size": fsize})
    return {"rootName": root.name, "files": collected}


def plan_remote_folder(conn, path: str) -> dict:
    remote_root = normalize_remote(path)
    root_name = posixpath.basename(remote_root) or 'root'
    collected = []

    def walk(current_path: str, rel_prefix: str) -> None:
        if len(collected) > MAX_PLAN_FILES:
            raise FileServiceError(f'Klasörde {MAX_PLAN_FILES} dosyadan fazlası var; daha küçük parçalar halinde aktarın.', 400, 'too_many_files')
        listing = list_remote(conn, current_path)
        for entry in listing["entries"]:
            if entry["kind"] == "folder":
                next_rel = entry["name"] if not rel_prefix else f"{rel_prefix}/{entry['name']}"
                walk(entry["path"], next_rel)
            else:
                collected.append({"relativeDir": rel_prefix, "name": entry["name"], "size": entry["size"]})

    walk(remote_root, '')
    return {"rootName": root_name, "files": collected}


def create_local_zip(parent_dir: str, names: list[str], archive_name: str) -> dict:
    archive_name = _validate_name(archive_name.strip())
    if not archive_name.lower().endswith('.zip'):
        archive_name = f'{archive_name}.zip'
    parent = Path(parent_dir)
    if not parent.is_dir():
        raise FileServiceError('Klasör bulunamadı', 404)
    dest = parent / archive_name
    if dest.exists():
        raise FileServiceError('Bu adda bir arşiv zaten var', 409, 'exists')
    if not names:
        raise FileServiceError('Arşivlenecek öğe seçilmedi', 400)
    partial = dest.with_name(dest.name + '.cgpart')
    try:
        with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            for raw_name in names:
                clean = _validate_name(raw_name)
                target = parent / clean
                if not target.exists():
                    raise FileServiceError(f'Öğe bulunamadı: {clean}', 404)
                if target.is_dir():
                    for root, _dirs, files in os.walk(target):
                        for fname in files:
                            fpath = Path(root) / fname
                            zf.write(fpath, arcname=str(fpath.relative_to(parent)))
                else:
                    zf.write(target, arcname=clean)
        os.replace(partial, dest)
    except PermissionError:
        partial.unlink(missing_ok=True)
        raise FileServiceError('Arşiv oluşturma izniniz yok', 403)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return {"name": archive_name, "path": str(dest), "size": dest.stat().st_size}


def _decode_text(raw: bytes) -> tuple[str, str]:
    """Metni ve kodlamasını döndürür: UTF-8 (BOM'lu/BOM'suz), değilse Windows-1254 (Türkçe)."""
    if b'\x00' in raw[:8192]:
        raise FileServiceError('Bu bir ikili (binary) dosya; metin olarak düzenlenemez.', 415, 'binary_file')
    if raw.startswith(b'\xef\xbb\xbf'):
        return raw[3:].decode('utf-8', errors='strict'), 'utf-8-sig'
    try:
        return raw.decode('utf-8', errors='strict'), 'utf-8'
    except UnicodeDecodeError:
        # surrogateescape: cp1254'te tanımsız baytlar (0x81, 0x8D...) kaydederken aynen geri yazılır.
        return raw.decode('cp1254', errors='surrogateescape'), 'cp1254'


EDITOR_ENCODINGS = {'utf-8', 'utf-8-sig', 'cp1254'}
MAX_SHEET_BYTES = 5 * 1024 * 1024
MAX_SHEET_ROWS = 5000
MAX_SHEET_COLS = 100


def _text_response(path: str, raw: bytes, max_bytes: int) -> dict:
    if len(raw) > max_bytes:
        raise FileServiceError('Dosya düzenleme sınırı (256 KB) aşıldı', 400, 'too_large')
    content, encoding = _decode_text(raw)
    newline = '\r\n' if '\r\n' in content else '\n'
    return {"path": path, "content": content.replace('\r\n', '\n'), "encoding": encoding, "newline": newline}


def _encode_text(content: str, encoding: str, newline: str, max_bytes: int, limit_label: str = '256 KB') -> bytes:
    if encoding not in EDITOR_ENCODINGS:
        raise FileServiceError('Desteklenmeyen karakter kodlaması', 400)
    text = content.replace('\r\n', '\n')
    if newline == '\r\n':
        text = text.replace('\n', '\r\n')
    try:
        data = text.encode(encoding, errors='surrogateescape' if encoding == 'cp1254' else 'strict')
    except UnicodeEncodeError:
        raise FileServiceError(f'Metin {encoding} kodlamasıyla kaydedilemiyor (desteklenmeyen karakter var).', 400, 'encoding_error')
    if len(data) > max_bytes:
        raise FileServiceError(f'Dosya düzenleme sınırı ({limit_label}) aşıldı', 400, 'too_large')
    return data


def _read_remote_bytes(conn, path: str, max_bytes: int, limit_label: str = '256 KB') -> tuple[str, bytes]:
    """Uzak dosyayı bellek içine okur; boyut sınırı aşılırsa indirmeyi durdurur."""
    provider = provider_of(conn)
    remote_file = normalize_remote(path)
    size = _remote_size(provider, conn, remote_file)
    if size is not None and size > max_bytes:
        raise FileServiceError(f'Dosya düzenleme sınırı ({limit_label}) aşıldı', 400, 'too_large')
    buf = io.BytesIO()
    try:
        if provider == 'sftp':
            with conn.sftp.open(remote_file, 'rb') as handle:
                while buf.tell() <= max_bytes:
                    chunk = handle.read(TRANSFER_CHUNK)
                    if not chunk:
                        break
                    buf.write(chunk)
        elif provider == 'ftp':
            conn.ftp.retrbinary(f'RETR {remote_file}', buf.write)
        elif provider == 'dropbox':
            _md, resp = conn.dbx.files_download(remote_file)
            buf.write(resp.content[:max_bytes + 1])
        elif provider == 'onedrive':
            with conn.session.get(_onedrive_url(remote_file, '/content'), stream=True, timeout=30) as resp:
                if not resp.ok:
                    _onedrive_check(resp)
                for chunk in resp.iter_content(chunk_size=TRANSFER_CHUNK):
                    buf.write(chunk)
                    if buf.tell() > max_bytes:
                        break
        else:
            service = conn.service
            found = _drive_find_file(service, _drive_resolve_folder(service, posixpath.dirname(remote_file)), posixpath.basename(remote_file))
            if not found:
                raise FileServiceError('Uzak dosya bulunamadı', 404)
            if str(found.get('mimeType') or '').startswith(DRIVE_WORKSPACE_PREFIX):
                raise FileServiceError('Google Workspace dosyaları doğrudan düzenlenemez.', 400, 'google_workspace_file')
            from googleapiclient.http import MediaIoBaseDownload
            downloader = MediaIoBaseDownload(buf, service.files().get_media(fileId=found['id']))
            done = False
            while not done and buf.tell() <= max_bytes:
                _, done = downloader.next_chunk()
    except FileServiceError:
        raise
    except Exception as error:
        _raise_provider_error('Dosya okunamadı', error)
    raw = buf.getvalue()
    if len(raw) > max_bytes:
        raise FileServiceError(f'Dosya düzenleme sınırı ({limit_label}) aşıldı', 400, 'too_large')
    return remote_file, raw


def _write_remote_bytes(conn, path: str, data: bytes, mime_type: str = 'text/plain') -> str:
    """Uzak dosyayı sağlayıcıya güvenli biçimde yazar."""
    provider = provider_of(conn)
    remote_file = normalize_remote(path)
    try:
        if provider == 'sftp':
            _write_sftp_atomic(conn, remote_file, data)
        elif provider == 'ftp':
            _write_ftp_atomic(conn, remote_file, data)
        elif provider == 'dropbox':
            import dropbox
            conn.dbx.files_upload(data, remote_file, mode=dropbox.files.WriteMode.overwrite)
        elif provider == 'onedrive':
            _onedrive_check(conn.session.put(_onedrive_url(remote_file, '/content'), data=data, timeout=30))
        else:
            service = conn.service
            parent_id = _drive_resolve_folder(service, posixpath.dirname(remote_file))
            name = posixpath.basename(remote_file)
            found = _drive_find_file(service, parent_id, name)
            from googleapiclient.http import MediaIoBaseUpload
            media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime_type, resumable=False)
            if found:
                service.files().update(fileId=found['id'], media_body=media).execute()
            else:
                service.files().create(body={'name': name, 'parents': [parent_id]}, media_body=media, fields='id').execute()
    except FileServiceError:
        raise
    except Exception as error:
        _raise_provider_error('Dosya kaydedilemedi', error)
    return remote_file


def read_local_text(path: str) -> dict:
    """Yerel metin dosyasını düzenleyici için okur (256 KB'a kadar)."""
    target = Path(path)
    if not target.exists() or not target.is_file():
        raise FileServiceError('Yerel dosya bulunamadı', 404)
    if target.stat().st_size > MAX_REMOTE_EDIT_BYTES:
        raise FileServiceError('Dosya düzenleme sınırı (256 KB) aşıldı', 400, 'too_large')
    try:
        raw = target.read_bytes()
    except PermissionError:
        raise FileServiceError('Dosya okuma izniniz yok', 403)
    return _text_response(str(target), raw, MAX_REMOTE_EDIT_BYTES)


def write_local_text(path: str, content: str, encoding: str = 'utf-8', newline: str = '\n') -> dict:
    """Yerel metin dosyasını kodlama ve satır sonunu koruyarak kaydeder."""
    target = Path(path)
    if not target.parent.exists():
        raise FileServiceError('Hedef klasör bulunamadı', 404)
    data = _encode_text(content, encoding, newline, MAX_REMOTE_EDIT_BYTES)
    try:
        target.write_bytes(data)
    except PermissionError:
        raise FileServiceError('Dosya yazma izniniz yok', 403)
    return {"path": str(target), "size": len(data)}


def read_remote_text(conn, path: str) -> dict:
    """Uzak dosyayı düzenleyici için okur. Boyut önce kontrol edilir; büyük dosya hiç indirilmez.

    Dönen `newline` dosyadaki satır sonudur: tarayıcı textarea'sı her şeyi `\\n`'e çevirdiği için
    kaydederken aynı satır sonuna geri dönülür.
    """
    remote_file, raw = _read_remote_bytes(conn, path, MAX_REMOTE_EDIT_BYTES)
    return _text_response(remote_file, raw, MAX_REMOTE_EDIT_BYTES)


def _temp_name(remote_file: str) -> str:
    return posixpath.join(posixpath.dirname(remote_file), f'.{posixpath.basename(remote_file)}.cgtmp')


def _write_sftp_atomic(conn, remote_file: str, data: bytes) -> None:
    """Önce geçici dosyaya yazar, sonra yerine taşır: bağlantı koparsa asıl dosya bozulmaz.

    * Sembolik bağlantıysa hedef dosya düzenlenir (bağlantı normal dosyaya dönüşmez).
    * Klasöre yazma izni yoksa (geçici dosya açılamazsa) dosyanın kendisine yazılır.
    * Sunucu üzerine taşımayı desteklemiyorsa asıl dosya önce yedeğe alınır; taşıma da başarısız
      olursa yedek geri konur. Asıl dosya hiçbir durumda silinip kaybolmaz.
    """
    sftp = conn.sftp
    target = remote_file
    try:
        info = sftp.lstat(remote_file)
        if stat.S_ISLNK(info.st_mode or 0):
            target = sftp.normalize(remote_file)
            info = sftp.stat(target)
        mode = info.st_mode
    except FileNotFoundError:
        mode = None
    temp = _temp_name(target)
    try:
        handle = sftp.open(temp, 'wb')
    except PermissionError:
        with sftp.open(target, 'wb') as direct:
            direct.write(data)
        return
    try:
        with handle:
            handle.write(data)
        if mode is not None:
            sftp.chmod(temp, stat.S_IMODE(mode))
    except Exception:
        _quiet(lambda: sftp.remove(temp))
        raise
    try:
        sftp.posix_rename(temp, target)
        return
    except Exception:
        if mode is None:
            try:
                sftp.rename(temp, target)
            except Exception:
                _quiet(lambda: sftp.remove(temp))
                raise
            return
    backup = posixpath.join(posixpath.dirname(target), f'.{posixpath.basename(target)}.cgbak')
    try:
        sftp.rename(target, backup)
    except Exception:
        _quiet(lambda: sftp.remove(temp))
        raise
    try:
        sftp.rename(temp, target)
    except Exception:
        _quiet(lambda: sftp.rename(backup, target))
        _quiet(lambda: sftp.remove(temp))
        raise
    _quiet(lambda: sftp.remove(backup))


def _write_ftp_atomic(conn, remote_file: str, data: bytes) -> None:
    """FTP'de aynı yaklaşım: geçici dosya, gerekirse yedekle değiştirme, izin yoksa yerinde yazma."""
    ftp = conn.ftp
    temp = _temp_name(remote_file)
    try:
        ftp.storbinary(f'STOR {temp}', io.BytesIO(data))
    except ftplib.error_perm:
        # Klasöre yeni dosya yazılamıyor; dosyanın kendisi yazılabilir olabilir.
        ftp.storbinary(f'STOR {remote_file}', io.BytesIO(data))
        return
    try:
        ftp.rename(temp, remote_file)
        return
    except ftplib.error_perm:
        pass  # Bazı sunucular var olan dosyanın üzerine RNTO yapmaz.
    backup = posixpath.join(posixpath.dirname(remote_file), f'.{posixpath.basename(remote_file)}.cgbak')
    try:
        ftp.rename(remote_file, backup)
    except ftplib.all_errors:
        _quiet(lambda: ftp.delete(temp))
        raise
    try:
        ftp.rename(temp, remote_file)
    except ftplib.all_errors:
        _quiet(lambda: ftp.rename(backup, remote_file))
        _quiet(lambda: ftp.delete(temp))
        raise
    _quiet(lambda: ftp.delete(backup))


def _quiet(action) -> None:
    try:
        action()
    except Exception:
        logger.debug('Temizlik adımı başarısız', exc_info=True)


def write_remote_text(conn, path: str, content: str, encoding: str = 'utf-8', newline: str = '\n') -> dict:
    data = _encode_text(content, encoding, newline, MAX_REMOTE_EDIT_BYTES)
    remote_file = _write_remote_bytes(conn, path, data, mime_type='text/plain')
    return {"path": remote_file, "size": len(data)}


def _detect_sheet_format(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext == '.xlsx':
        return 'xlsx'
    if ext == '.csv':
        return 'csv'
    raise FileServiceError('Desteklenmeyen tablo biçimi (.xlsx veya .csv gerekli)', 400, 'unsupported_format')


def _detect_csv_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample[:4096], delimiters=',;\t|')
        return dialect.delimiter
    except csv.Error:
        return ';' if sample.count(';') > sample.count(',') else ','


def _parse_sheet_bytes(path: str, raw: bytes) -> dict:
    fmt = _detect_sheet_format(path)
    if fmt == 'csv':
        content, encoding = _decode_text(raw)
        newline = '\r\n' if '\r\n' in content else '\n'
        text = content.replace('\r\n', '\n')
        delimiter = _detect_csv_delimiter(text)
        rows = [row[:MAX_SHEET_COLS] for row in list(csv.reader(io.StringIO(text), delimiter=delimiter))[:MAX_SHEET_ROWS]]
        if not rows:
            rows = [['']]
        return {
            "path": path,
            "format": "csv",
            "sheets": [{"name": Path(path).name or 'CSV', "rows": rows}],
            "delimiter": delimiter,
            "encoding": encoding,
            "newline": newline,
        }
    import openpyxl
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=False)
    except Exception as error:
        raise FileServiceError(f'Excel dosyası okunamadı: {error}', 400, 'invalid_xlsx')
    sheets = []
    for ws in wb.worksheets:
        rows = []
        row_limit = min(ws.max_row or 1, MAX_SHEET_ROWS)
        col_limit = min(ws.max_column or 1, MAX_SHEET_COLS)
        for row in ws.iter_rows(max_row=row_limit, max_col=col_limit, values_only=True):
            rows.append(['' if cell is None else str(cell) for cell in row])
        if not rows:
            rows = [['']]
        sheets.append({"name": ws.title, "rows": rows})
    return {"path": path, "format": "xlsx", "sheets": sheets}


def _serialize_sheet_bytes(
    path: str,
    sheets: list[dict],
    existing_raw: bytes | None = None,
    delimiter: str = ',',
    encoding: str = 'utf-8',
    newline: str = '\n',
) -> tuple[bytes, str]:
    fmt = _detect_sheet_format(path)
    if not sheets:
        raise FileServiceError('En az bir sayfa gerekli', 400)
    if fmt == 'csv':
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=delimiter or ',', lineterminator='\n')
        for row in sheets[0].get('rows') or []:
            writer.writerow(['' if cell is None else str(cell) for cell in row])
        data = _encode_text(buf.getvalue(), encoding, newline, MAX_SHEET_BYTES, '5 MB')
        return data, 'text/csv'
    import openpyxl
    if existing_raw:
        try:
            wb = openpyxl.load_workbook(io.BytesIO(existing_raw))
        except Exception:
            wb = openpyxl.Workbook()
    else:
        wb = openpyxl.Workbook()
    existing_names = list(wb.sheetnames)
    kept_names = []
    for index, sheet in enumerate(sheets):
        title = str(sheet.get('name') or f'Sayfa{index + 1}')[:31]
        if title in wb.sheetnames:
            ws = wb[title]
        elif index < len(existing_names) and existing_names[index] not in kept_names:
            ws = wb[existing_names[index]]
            ws.title = title
        else:
            ws = wb.create_sheet(title=title)
        kept_names.append(ws.title)
        rows = sheet.get('rows') or []
        max_existing_rows = ws.max_row
        max_existing_cols = ws.max_column
        for r_idx in range(1, max_existing_rows + 1):
            for c_idx in range(1, max_existing_cols + 1):
                ws.cell(row=r_idx, column=c_idx, value=None)
        for r_idx, row in enumerate(rows[:MAX_SHEET_ROWS], start=1):
            for c_idx, val in enumerate(row[:MAX_SHEET_COLS], start=1):
                ws.cell(row=r_idx, column=c_idx, value=None if val in (None, '') else str(val))
    for name in list(wb.sheetnames):
        if name not in kept_names and len(wb.sheetnames) > 1:
            del wb[name]
    out = io.BytesIO()
    wb.save(out)
    data = out.getvalue()
    if len(data) > MAX_SHEET_BYTES:
        raise FileServiceError('Dosya düzenleme sınırı (5 MB) aşıldı', 400, 'too_large')
    return data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def read_local_sheet(path: str) -> dict:
    """Yerel .xlsx veya .csv dosyasını tablo editörü için okur (5 MB'a kadar)."""
    target = Path(path)
    if not target.exists() or not target.is_file():
        raise FileServiceError('Yerel dosya bulunamadı', 404)
    if target.stat().st_size > MAX_SHEET_BYTES:
        raise FileServiceError('Dosya düzenleme sınırı (5 MB) aşıldı', 400, 'too_large')
    try:
        raw = target.read_bytes()
    except PermissionError:
        raise FileServiceError('Dosya okuma izniniz yok', 403)
    return _parse_sheet_bytes(str(target), raw)


def write_local_sheet(
    path: str,
    sheets: list[dict],
    delimiter: str = ',',
    encoding: str = 'utf-8',
    newline: str = '\n',
) -> dict:
    """Yerel .xlsx veya .csv dosyasını kaydeder."""
    target = Path(path)
    if not target.parent.exists():
        raise FileServiceError('Hedef klasör bulunamadı', 404)
    existing_raw = target.read_bytes() if target.exists() and _detect_sheet_format(path) == 'xlsx' else None
    data, _mime = _serialize_sheet_bytes(path, sheets, existing_raw, delimiter, encoding, newline)
    try:
        target.write_bytes(data)
    except PermissionError:
        raise FileServiceError('Dosya yazma izniniz yok', 403)
    return {"path": str(target), "size": len(data)}


def read_remote_sheet(conn, path: str) -> dict:
    """Uzak .xlsx veya .csv dosyasını tablo editörü için okur (5 MB'a kadar)."""
    remote_file, raw = _read_remote_bytes(conn, path, MAX_SHEET_BYTES, '5 MB')
    return _parse_sheet_bytes(remote_file, raw)


def write_remote_sheet(
    conn,
    path: str,
    sheets: list[dict],
    delimiter: str = ',',
    encoding: str = 'utf-8',
    newline: str = '\n',
) -> dict:
    """Uzak .xlsx veya .csv dosyasını kaydeder."""
    fmt = _detect_sheet_format(path)
    existing_raw = None
    if fmt == 'xlsx':
        try:
            _, existing_raw = _read_remote_bytes(conn, path, MAX_SHEET_BYTES, '5 MB')
        except FileServiceError as err:
            if err.status != 404:
                raise
    data, mime = _serialize_sheet_bytes(path, sheets, existing_raw, delimiter, encoding, newline)
    remote_file = _write_remote_bytes(conn, path, data, mime_type=mime)
    return {"path": remote_file, "size": len(data)}


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
