export type EntryKind = 'folder' | 'file'

/** Hangi panelden geldiği: inspector yalnızca yerel dosyalar için backend'e gider. */
export type EntrySource = 'local' | 'remote'

export type FileEntry = {
  name: string
  kind: EntryKind
  source: EntrySource
  /** Bayt cinsinden boyut; klasörlerde null. */
  size: number | null
  /** ISO-8601 değiştirilme zamanı. */
  modified: string
  path?: string
  permissions?: string
  hash?: string
  preview?: string
}

export type FileInspection = {
  FileName: string
  FilePath: string
  Type: string
  Size: number
  Change: string
  filemod: string
  sha256: string
  preview: string | null
  previewTruncated: boolean
}

/** Tasarımdaki ProtocolTag sırası. FTPS backend'de henüz yok (arayüzde devre dışı). */
export type ConnectionType = 'FTP' | 'FTPS' | 'SFTP' | 'Dropbox' | 'GoogleDrive'

export type ConnectionStatus = 'connected' | 'offline' | 'error'

export type ConnectionProfile = {
  id: string
  name: string
  type: ConnectionType
  host: string
  port: string
  username: string
  path: string
  status: ConnectionStatus
}

export type Bookmark = {
  id: string
  name: string
  connectionId: string
  path: string
  type: 'connection' | 'directory'
}

export type TransferStatus = 'queued' | 'transferring' | 'paused' | 'completed' | 'error' | 'cancelled'

export type TransferItem = {
  id: string
  name: string
  direction: 'upload' | 'download'
  /** Kaynak → hedef, ör. `~/Projeler/site → web-01:/var/www/html` */
  from: string
  to: string
  /** Bayt cinsinden toplam boyut. */
  size: number
  progress: number
  /** Bayt/sn; yalnızca aktarılırken. */
  rate?: number
  status: TransferStatus
  error?: string
  /** Teknik hata kodu (ECONNRESET, 530); tooltip'te gösterilir. */
  errorCode?: string
}

export type PaneId = 'local' | 'remote'

export type ConnectionFormValues = Omit<ConnectionProfile, 'id' | 'status'> & {
  /** Parola yalnızca bağlantı isteğinde kullanılır, profilde saklanmaz. */
  password: string
}
