/*
 * Geçici örnek veri. Dosya listeleri, yer imleri ve transfer kuyruğu henüz Flask API'ye bağlı değil
 * (bkz. ARCHITECTURE_AND_UPDATE_SUMMARY.md, "Eklenecek özellikler"). API bağlandığında bu dosya
 * yalnızca testlerde kullanılmalı.
 */
import type { Bookmark, ConnectionProfile, FileEntry, TransferItem } from '../types'

export const LOCAL_ROOT = 'C:\\Users\\Bilal'

export const initialConnections: ConnectionProfile[] = [
  { id: 'production', name: 'Üretim sunucusu', type: 'SFTP', host: 'server.cybergoose.com', port: '22', username: 'deploy', path: '/var/www', status: 'connected' },
  { id: 'legacy-ftp', name: 'Eski FTP', type: 'FTP', host: 'ftp.ornek.com', port: '21', username: 'web', path: '/public_html', status: 'offline' },
  { id: 'dropbox', name: 'Dropbox', type: 'Dropbox', host: 'dropbox.com', port: '', username: '', path: '/', status: 'offline' },
  { id: 'drive', name: 'Google Drive', type: 'GoogleDrive', host: 'drive.google.com', port: '', username: '', path: '/', status: 'offline' },
]

export const initialBookmarks: Bookmark[] = [
  { id: 'bookmark-production', name: 'Üretim web kökü', connectionId: 'production', path: '/var/www', type: 'directory' },
  { id: 'bookmark-backups', name: 'Günlük yedekler', connectionId: 'production', path: '/var/www/backups', type: 'directory' },
  { id: 'bookmark-drive', name: 'Drive ana dizini', connectionId: 'drive', path: '/', type: 'connection' },
]

export const localEntries: FileEntry[] = [
  { name: 'Belgeler', kind: 'folder', source: 'local', size: null, modified: '2026-11-16T14:32:00', path: 'C:/Users/Bilal/Belgeler' },
  { name: 'Projeler', kind: 'folder', source: 'local', size: null, modified: '2026-11-15T09:18:00', path: 'C:/Users/Bilal/Projeler' },
  { name: 'README.md', kind: 'file', source: 'local', size: 3_120, modified: '2026-11-16T11:05:00', path: 'C:/Users/Bilal/README.md', permissions: '0644', preview: '# CyberGoose\n\nSecure file operations.' },
  { name: 'rapor.pdf', kind: 'file', source: 'local', size: 1_240_000, modified: '2026-11-15T16:40:00', path: 'C:/Users/Bilal/rapor.pdf', permissions: '0644' },
  { name: 'yedek-2026-11.tar.gz', kind: 'file', source: 'local', size: 184_200_000, modified: '2026-11-15T03:00:00', path: 'C:/Users/Bilal/yedek-2026-11.tar.gz', permissions: '0644' },
]

export const remoteEntriesByConnection: Record<string, FileEntry[]> = {
  production: [
    { name: 'backups', kind: 'folder', source: 'remote', size: null, modified: '2026-11-16T10:11:00', path: '/var/www/backups' },
    { name: 'public', kind: 'folder', source: 'remote', size: null, modified: '2026-11-12T08:20:00', path: '/var/www/public' },
    { name: 'deploy.zip', kind: 'file', source: 'remote', size: 28_000_000, modified: '2026-11-11T17:45:00', path: '/var/www/deploy.zip', permissions: 'rw-r--r--' },
    { name: 'robots.txt', kind: 'file', source: 'remote', size: 112, modified: '2026-10-02T11:30:00', path: '/var/www/robots.txt', permissions: 'rw-r--r--' },
  ],
}

export const initialTransfers: TransferItem[] = [
  { id: 'transfer-1', name: 'deploy.zip', direction: 'upload', from: '~/Projeler/site', to: 'server.cybergoose.com:/var/www', size: 28_000_000, progress: 68, rate: 23_400_000, status: 'transferring' },
  { id: 'transfer-2', name: 'README.md', direction: 'download', from: 'server.cybergoose.com:/var/www', to: '~/İndirilenler', size: 3_120, progress: 100, status: 'completed' },
  { id: 'transfer-3', name: 'backup.tar.gz', direction: 'download', from: 'server.cybergoose.com:/var/www/backups', to: '~/Yedekler', size: 642_000_000, progress: 0, status: 'queued' },
  { id: 'transfer-4', name: 'config.json', direction: 'upload', from: '~/Projeler/site', to: 'server.cybergoose.com:/var/www', size: 12_000, progress: 34, status: 'error', error: 'Bağlantı koptu', errorCode: 'ECONNRESET' },
]
