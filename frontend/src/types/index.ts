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
  /** Nokta ile başlayan veya Windows'ta gizli öznitelikli öğe. */
  hidden?: boolean
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
  /** 1 GB üstü dosyalarda hesaplanmaz (null). */
  sha256: string | null
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
  /** SFTP özel anahtar dosyasının yolu (boş: yok). */
  keyPath?: string
  /** Kenar çubuğundaki grup ("Müşteriler/ACME"); boş: grupsuz. */
  group?: string
  /** SFTP: SSH agent (Pageant / OpenSSH) ile kimlik doğrulama. */
  useAgent?: boolean
  /** Özel anahtarın parolası güvenli depoda kayıtlı mı. */
  hasPassphrase?: boolean
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
  /** Kayıtlı SFTP özel anahtar yolu; varsa bağlanırken parola sorulmaz. */
  keyPath?: string
  /** Kenar çubuğu grubu. */
  group?: string
  useAgent?: boolean
  hasPassphrase?: boolean
  /** Kayıtlı (silinebilir/düzenlenebilir) mi, yerleşik bulut girişi mi. */
  saved: boolean
  /** Bulut hesabı için uygulama anahtarları ayarlanmış mı (ayarsızsa kenar çubuğunda soluk). */
  configured?: boolean
  /** Kaydedilmeden açılan hızlı bağlantı. */
  quick?: boolean
}

export type FolderBookmark = {
  id: number
  name: string
  /** null = yerel klasör. */
  connectionId: string | number | null
  path: string
}

/** Hedefte aynı adlı dosya varsa: sor (hata), üzerine yaz, atla, kaynak daha yeniyse yaz, yeni adla kaydet. */
export type ConflictPolicy = 'ask' | 'overwrite' | 'skip' | 'newer' | 'rename'

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'error' | 'cancelled'

export type TransferItem = {
  id: string
  name: string
  /** copy: uzaktan uzağa (sol paneldeki bağlantı ile sağdaki arasında). */
  direction: 'upload' | 'download' | 'copy'
  /** copy'de kullanılmaz; upload/download'da yerel klasör. */
  localDir: string
  /** upload/download'da uzak klasör; copy'de hedef klasör. */
  remoteDir: string
  /** copy: kaynak klasör ve oturumu. */
  sourceDir?: string
  sourceSessionId?: number
  /** copy: bitince yenilenecek panel. */
  targetPane?: PaneId
  /** İşin bağlı olduğu backend oturumu (copy'de hedef): kullanıcı bağlantı değiştirse de dosya bu sunucuya gider. */
  sessionId: number | null
  /** Öğenin eklendiği bağlantı; oturum kapandıktan sonra aynı bağlantı yeniden açılınca yeniden denenebilir. */
  connectionId?: string
  /** Rota metni: `C:\Users\… → host:/var/www`. */
  from: string
  to: string
  /** Bayt; bilinmiyorsa null. */
  size: number | null
  status: TransferStatus
  jobId?: string
  transferred?: number
  overwrite?: boolean
  /** Çakışma kararı; yoksa `overwrite` geçerlidir. */
  conflict?: ConflictPolicy
  /** Hedefte vardı ve çakışma kararı gereği aktarılmadı. */
  skipped?: string
  /** "Yeniden adlandır" kararıyla hedefe verilen ad. */
  renamedTo?: string
  /** Yarım kalan aktarımı kaldığı yerden sürdür (FTP/SFTP). */
  resume?: boolean
  error?: string
  /** Teknik hata kodu; tooltip'te gösterilir. */
  errorCode?: string
  startedAt?: number
  finishedAt?: number
  /** Anlık hız (bayt/sn, yumuşatılmış); yalnızca aktarılırken. */
  rate?: number
}

export type PaneId = 'local' | 'remote'

export type ConnectionFormValues = Omit<ConnectionProfile, 'id' | 'hasPassword' | 'saved'> & {
  /** Parola yalnızca bağlantı isteğinde kullanılır, saklanmaz. */
  password: string
  keyPath?: string
  /** Özel anahtar parolası (yalnızca güvenli depoya yazılır). */
  keyPassphrase?: string
}
