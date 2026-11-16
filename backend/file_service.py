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
import shutil
import stat
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


class FileServiceError(Exception):
    """HTTP durum koduyla birlikte kullanıcıya gösterilebilir hata."""

    def __init__(self, message: str, status: int = 400, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


class TransferCancelled(FileServiceError):
    def __init__(self):
        super().__init__('Aktarım iptal edildi', 499, 'cancelled')


DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'
DRIVE_WORKSPACE_PREFIX = 'application/vnd.google-apps.'
DROPBOX_CHUNK_SIZE = 8 * 1024 * 1024
ONEDRIVE_SIMPLE_LIMIT = 4 * 1024 * 1024
ONEDRIVE_CHUNK_SIZE = 5 * 1024 * 1024
GRAPH_DRIVE_ROOT = 'https://graph.microsoft.com/v1.0/me/drive'


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
    items = service.files().list(q=query, pageSize=1, fields='files(id, mimeType)').execute().get('files', [])
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
            return conn.ftp.size(remote_file) is not None
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


def upload(
    conn,
    local_dir: str,
    name: str,
    remote_dir: str,
    overwrite: bool = False,
    progress_cb=None,
    cancel_event=None,
) -> dict:
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
            if not overwrite and _remote_exists(provider, conn, remote_file):
                raise FileServiceError('Hedefte aynı adlı dosya var', 409, 'exists')
            if provider == 'sftp':
                conn.sftp.put(str(local_file), remote_file, callback=lambda done, total: report(done, total or size))
            elif provider == 'ftp':
                transferred = 0

                def on_block(chunk: bytes) -> None:
                    nonlocal transferred
                    transferred += len(chunk)
                    report(transferred, size)

                with local_file.open('rb') as handle:
                    conn.ftp.storbinary(f'STOR {remote_file}', handle, blocksize=65536, callback=on_block)
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
    return {"name": name, "size": size, "to": remote_file}


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
) -> dict:
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

    def report(done: int, total: int | None = None) -> None:
        _check_cancel(cancel_event)
        if progress_cb is not None:
            progress_cb(done, total)

    try:
        _check_cancel(cancel_event)
        if provider == 'sftp':
            conn.sftp.get(remote_file, str(partial), callback=lambda done, total: report(done, total or None))
        elif provider == 'ftp':
            total_size = None
            try:
                total_size = conn.ftp.size(remote_file)
            except Exception:
                total_size = None
            transferred = 0
            with partial.open('wb') as handle:
                def on_chunk(chunk: bytes) -> None:
                    nonlocal transferred
                    _check_cancel(cancel_event)
                    handle.write(chunk)
                    transferred += len(chunk)
                    report(transferred, total_size)

                conn.ftp.retrbinary(f'RETR {remote_file}', on_chunk, blocksize=65536)
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
                    for chunk in resp.iter_content(chunk_size=65536):
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
    except FileServiceError:
        partial.unlink(missing_ok=True)
        raise
    except PermissionError:
        partial.unlink(missing_ok=True)
        raise FileServiceError('Yerel klasöre yazma izniniz yok', 403)
    except Exception as error:
        partial.unlink(missing_ok=True)
        _raise_provider_error('İndirme başarısız oldu', error)
    return {"name": name, "size": local_file.stat().st_size, "to": str(local_file)}


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


def delete_local(path: str) -> None:
    target = Path(path)
    if not target.exists():
        raise FileServiceError('Öğe bulunamadı', 404)
    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    except PermissionError:
        raise FileServiceError('Bu öğeyi silme izniniz yok', 403)


def _delete_sftp(conn, remote_file: str) -> None:
    if stat.S_ISDIR(conn.sftp.stat(remote_file).st_mode or 0):
        _sftp_rmtree(conn.sftp, remote_file)
    else:
        conn.sftp.remove(remote_file)


def _delete_ftp(conn, remote_file: str) -> None:
    try:
        conn.ftp.delete(remote_file)
    except Exception:
        _ftp_rmtree(conn, remote_file)


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
