export type EntryKind = 'folder' | 'file'

/** Hangi panelden geldiği: inspector yalnızca yerel dosyalar için yerel endpoint'e gider. */
export type EntrySource = 'local' | 'remote'

/** API'nin döndürdüğü dosya/klasör. */
export type ApiEntry = {
  name: string
  kind: EntryKind
  /** Bayt; klasörlerde null. */
  size: number | null
  /** ISO-8601; sağlayıcı vermezse null. */
  modified: string | null
  path: string
}

export type FileEntry = ApiEntry & { source: EntrySource }

export type Crumb = { name: string; path: string }

export type DirectoryListing = {
  path: string
  parent: string | null
  crumbs: Crumb[]
  entries: ApiEntry[]
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

export type RemoteDetails = { path: string; permissions: string | null; canChmod: boolean }

/** Tasarımdaki ProtocolTag sırası. */
export type ConnectionType = 'FTP' | 'FTPS' | 'SFTP' | 'Dropbox' | 'GoogleDrive' | 'OneDrive'

export type ConnectionStatus = 'connected' | 'connecting' | 'offline' | 'error'

/** Backend'de kayıtlı bağlantı (parola asla dönmez). */
export type SavedConnection = {
  id: number
  name: string
  type: ConnectionType
  host: string
  port: string
  username: string
  hasPassword: boolean
}

export type ConnectionProfile = {
  /** Kayıtlı bağlantılarda veritabanı kimliği; bulut hesaplarında 'dropbox' / 'drive'. */
  id: string
  name: string
  type: ConnectionType
  host: string
  port: string
  username: string
  hasPassword: boolean
  /** Kayıtlı (silinebilir/düzenlenebilir) mi, yerleşik bulut girişi mi. */
  saved: boolean
}

export type FolderBookmark = {
  id: number
  name: string
  /** null = yerel klasör. */
  connectionId: string | number | null
  path: string
}

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'error' | 'cancelled'

export type TransferItem = {
  id: string
  name: string
  direction: 'upload' | 'download'
  localDir: string
  remoteDir: string
  /** Rota metni: `C:\Users\… → host:/var/www`. */
  from: string
  to: string
  /** Bayt; bilinmiyorsa null. */
  size: number | null
  status: TransferStatus
  jobId?: string
  transferred?: number
  overwrite?: boolean
  error?: string
  /** Teknik hata kodu; tooltip'te gösterilir. */
  errorCode?: string
  startedAt?: number
  finishedAt?: number
}

export type PaneId = 'local' | 'remote'

export type ConnectionFormValues = Omit<ConnectionProfile, 'id' | 'hasPassword' | 'saved'> & {
  /** Parola yalnızca bağlantı isteğinde kullanılır, saklanmaz. */
  password: string
  keyPath?: string
}
