import type {
  ConnectionType,
  DirectoryListing,
  FileInspection,
  FolderBookmark,
  RemoteDetails,
  SavedConnection,
} from '../types'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  /** Hata gövdesindeki ek alanlar (ör. `hostKey`). */
  readonly details: Record<string, unknown>

  constructor(
    message: string,
    status: number,
    code?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type HostKeyInfo = { host: string; type: string; fingerprint: string }

/** SFTP sunucusu ilk kez görülüyorsa backend parmak izini döndürür; kullanıcı onaylamalıdır. */
export function hostKeyOf(error: unknown): HostKeyInfo | null {
  if (!(error instanceof ApiError) || error.code !== 'host_key_unknown') return null
  const info = error.details.hostKey as HostKeyInfo | undefined
  return info?.fingerprint ? info : null
}

/** Electron'un başlattığı yerel API'nin adresi ve anahtarı (bkz. desktop/main.cjs). */
let runtime: { base: string; token: string } | null = null

export function configureApi(base: string, token: string) {
  runtime = { base: base.replace(/\/$/, ''), token }
}

/**
 * Geliştirmede Vite proxy'si `/api`'yi Flask'a yönlendirir. Paketlenmiş Electron'da adres ve
 * anahtar `configureApi` ile verilir. `VITE_API_BASE` ile değiştirilebilir.
 */
export function apiBase(): string {
  if (runtime) return runtime.base
  const configured = import.meta.env.VITE_API_BASE as string | undefined
  if (configured) return configured.replace(/\/$/, '')
  return window.location.protocol === 'file:' ? 'http://127.0.0.1:5502' : ''
}

export function apiToken(): string {
  return runtime?.token ?? ''
}

export function wsBase(): string {
  const base = apiBase() || window.location.origin
  return base.replace(/^http/, 'ws')
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(runtime?.token ? { 'X-CyberGoose-Token': runtime.token } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('CyberGoose yerel sunucusuna ulaşılamadı. Geliştirmede "npm run dev:backend" ile başlatın.', 0, 'offline')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error ?? `İstek başarısız oldu (${response.status})`
    const { error: _message, code, ...details } = (payload ?? {}) as Record<string, unknown>
    throw new ApiError(String(message), response.status, typeof code === 'string' ? code : undefined, details)
  }
  return payload as T
}

/** Görsel/PDF önizlemesi: ham baytları Blob olarak döndürür. */
export async function previewBlob(side: 'local' | 'remote', path: string, sessionId?: number | null): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`${apiBase()}/api/${side}/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(runtime?.token ? { 'X-CyberGoose-Token': runtime.token } : {}),
      },
      body: JSON.stringify(side === 'remote' ? { path, sessionId } : { path }),
    })
  } catch {
    throw new ApiError('CyberGoose yerel sunucusuna ulaşılamadı.', 0, 'offline')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error ?? `Önizleme alınamadı (${response.status})`
    throw new ApiError(String(message), response.status, typeof payload?.code === 'string' ? payload.code : undefined)
  }
  return response.blob()
}

const post = <T>(path: string, data: unknown = {}) =>
  apiRequest<T>(path, { method: 'POST', body: JSON.stringify(data) })

export type ConnectRequest = {
  type: ConnectionType
  host?: string
  port?: string
  username?: string
  password?: string
  keyPath?: string
  /** Kayıtlı bağlantı: parola boşsa backend kayıtlı parolayı kullanır. */
  connectionId?: string
  /** Arayüzdeki bağlantı kimliği; oturum geri yüklenirken eşlemek için. */
  clientId?: string
  /** Kullanıcının onayladığı SFTP sunucu anahtarı parmak izi. */
  trustHostKey?: string
  /** Özel anahtar parolası. */
  keyPassphrase?: string
  /** SSH agent (Pageant / OpenSSH) kullan. */
  useAgent?: boolean
}

export type ConnectResponse =
  | { connected: true; type: ConnectionType; sessionId: number }
  | { pending: true; message: string }

export type SessionInfo = { connected: boolean; type: ConnectionType | null; connectionId: string | null; sessionId?: number | null }

export type TransferRequest = {
  direction: 'upload' | 'download'
  name: string
  localDir: string
  remoteDir: string
  overwrite?: boolean
  conflict?: 'overwrite' | 'skip' | 'newer' | 'rename'
  sessionId?: number
  resume?: boolean
}

/** Uzaktan uzağa kopya: kaynak oturumdan indirilip hedef oturuma (sessionId) yüklenir. */
export type CopyRequest = {
  direction: 'copy'
  name: string
  sourceDir: string
  targetDir: string
  sourceSessionId: number
  sessionId: number
  overwrite?: boolean
  conflict?: 'overwrite' | 'skip' | 'newer' | 'rename'
}

export type TransferJobStatus = {
  id: string
  sessionId?: number
  status: 'transferring' | 'completed' | 'error' | 'cancelled'
  transferred: number
  total: number | null
  error?: string | null
  errorCode?: string | null
  result?: { name: string; size: number; to: string; resumedFrom?: number; skipped?: boolean; skipReason?: string; renamedTo?: string | null } | null
}

export type RemoteText = { path: string; content: string; encoding?: string; newline?: '\n' | '\r\n' }
export type SheetTab = { name: string; rows: string[][] }
export type SheetData = {
  path: string
  format: 'xlsx' | 'csv'
  sheets: SheetTab[]
  delimiter?: string
  encoding?: string
  newline?: '\n' | '\r\n'
}
export type LocalStat = { name: string; path: string; parent: string; kind: 'file' | 'folder'; size: number | null; modified: string | null }
export type ProviderStatus = { dropbox: boolean; googledrive: boolean; onedrive: boolean }
export type FolderPlan = { rootName: string; files: { relativeDir: string; name: string; size: number | null; modified?: string | null }[] }

export type CompareStatus = 'onlyLocal' | 'onlyRemote' | 'different' | 'same'
export type CompareRow = {
  relativeDir: string
  name: string
  status: CompareStatus
  localSize: number | null
  remoteSize: number | null
  localModified: string | null
  remoteModified: string | null
  newer: 'local' | 'remote' | null
}
export type CompareResult = {
  items: CompareRow[]
  summary: Record<CompareStatus, number>
  localPath: string
  remotePath: string
  /** Uygulanan saat farkı (dakika) ve otomatik bulunup bulunmadığı. */
  timeOffsetMinutes?: number
  timeOffsetDetected?: boolean
}

export type ExternalEdit = {
  id: string
  sessionId: number
  remotePath: string
  localPath: string
  name: string
  uploads: number
  lastUpload: number | null
  error: string | null
  uploading: boolean
}

export type SearchHit = { name: string; kind: 'file' | 'folder'; path: string; parent: string; size: number | null; modified: string | null }
export type SearchResult = { results: SearchHit[]; truncated: boolean; scanned: number }

export type ConnectionInput = { name: string; type: ConnectionType; host: string; port: string; username: string; password?: string; keyPath?: string; group?: string; useAgent?: boolean; keyPassphrase?: string }

export const api = {
  session: () => apiRequest<SessionInfo>('/api/session'),
  updateSession: (connectionId: string | null) =>
    apiRequest<SessionInfo>('/api/session', { method: 'PUT', body: JSON.stringify({ connectionId }) }),
  connect: (request: ConnectRequest) => post<ConnectResponse>('/api/connect', request),
  disconnect: () => post<{ connected: false }>('/api/disconnect'),
  /** Sol panel için ikinci uzak bağlantı (etkin oturumu değiştirmez). */
  connectSide: (request: ConnectRequest) => post<{ connected: true; type: ConnectionType; sessionId: number }>('/api/side/connect', request),
  disconnectSide: (sessionId: number) => post<{ connected: false }>('/api/side/disconnect', { sessionId }),

  localHome: () => apiRequest<{ path: string }>('/api/local/home'),
  localDrives: () => apiRequest<{ drives: string[] }>('/api/local/drives'),
  localStat: (path: string) => post<LocalStat>('/api/local/stat', { path }),
  providers: () => apiRequest<ProviderStatus>('/api/providers'),
  listLocal: (path: string | null) => post<DirectoryListing>('/api/local/list', { path }),
  getLocalFileInfo: (path: string) => post<FileInspection>('/api/local/info', { path }),

  listRemote: (path: string, sessionId?: number) => post<DirectoryListing>('/api/remote/list', { path, sessionId }),
  // `sessionId` verilirse sol paneldeki ikinci uzak bağlantı kullanılır.
  getRemoteDetails: (path: string, sessionId?: number) => post<RemoteDetails>('/api/remote/info', { path, sessionId }),
  chmodRemote: (path: string, mode: string, sessionId?: number) => post<RemoteDetails>('/api/remote/chmod', { path, mode, sessionId }),
  readRemoteText: (path: string, sessionId?: number) => post<RemoteText>('/api/remote/read', { path, sessionId }),
  writeRemoteText: (path: string, content: string, options: { encoding?: string; newline?: string; sessionId?: number } = {}) =>
    post<{ path: string; size: number }>('/api/remote/write', { path, content, ...options }),
  readLocalText: (path: string) => post<RemoteText>('/api/local/read', { path }),
  writeLocalText: (path: string, content: string, options: { encoding?: string; newline?: string } = {}) =>
    post<{ path: string; size: number }>('/api/local/write', { path, content, ...options }),
  readSheet: (side: 'local' | 'remote', path: string, sessionId?: number) =>
    post<SheetData>(`/api/${side}/sheet/read`, { path, sessionId }),
  writeSheet: (
    side: 'local' | 'remote',
    path: string,
    sheets: SheetTab[],
    options: { delimiter?: string; encoding?: string; newline?: string; sessionId?: number } = {},
  ) => post<{ path: string; size: number }>(`/api/${side}/sheet/write`, { path, sheets, ...options }),

  startTransfer: (request: TransferRequest | CopyRequest) => post<TransferJobStatus>('/api/transfers', request),
  getTransfer: (jobId: string) => apiRequest<TransferJobStatus>(`/api/transfers/${encodeURIComponent(jobId)}`),
  cancelTransfer: (jobId: string) => post<TransferJobStatus>(`/api/transfers/${encodeURIComponent(jobId)}/cancel`),
  planFolderTransfer: (side: 'local' | 'remote', path: string, sessionId?: number) =>
    post<FolderPlan>('/api/transfer/plan', { side, path, sessionId }),
  listExternalEdits: () => apiRequest<ExternalEdit[]>('/api/external-edits'),
  openExternalEdit: (path: string, sessionId?: number) => post<ExternalEdit>('/api/external-edits', { path, sessionId }),
  syncExternalEdit: (id: string) => post<ExternalEdit>(`/api/external-edits/${encodeURIComponent(id)}/sync`),
  closeExternalEdit: (id: string) =>
    apiRequest<{ closed: string }>(`/api/external-edits/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Zip'i yanındaki klasöre açar. Uzakta arşiv indirilip açılır ve klasör sunucuya yüklenir. */
  extractZip: (path: string, side: 'local' | 'remote' = 'local', sessionId?: number) =>
    post<{ path: string; name: string; files: number; skipped: number }>('/api/extract', { side, path, sessionId }),
  /**
   * Klasör karşılaştırma. `leftSessionId` verilirse sol taraf da uzak bir klasördür.
   * `timeOffsetMinutes`: sunucu saatinin bilgisayardan farkı; verilmezse otomatik tahmin edilir.
   */
  compareFolders: (localPath: string, remotePath: string, sessionId?: number, options: { leftSessionId?: number; timeOffsetMinutes?: number } = {}) =>
    post<CompareResult>('/api/compare', { localPath, remotePath, sessionId, ...options }),
  search: (side: 'local' | 'remote', path: string, query: string, sessionId?: number) =>
    post<SearchResult>('/api/search', { side, path, query, sessionId }),
  createZip: (parentDir: string, names: string[], name: string) =>
    post<{ name: string; path: string; size: number }>('/api/archive', { side: 'local', parentDir, names, name }),
  mkdir: (side: 'local' | 'remote', path: string, name: string, sessionId?: number) =>
    post<{ name: string; path: string }>('/api/mkdir', { side, path, name, sessionId }),
  renameEntry: (side: 'local' | 'remote', path: string, name: string, sessionId?: number) =>
    post<{ name: string; path: string }>('/api/rename', { side, path, name, sessionId }),
  deleteEntry: (side: 'local' | 'remote', path: string, permanent = false, sessionId?: number) =>
    post<{ deleted: string; trashed: boolean }>('/api/delete', { side, path, permanent, sessionId }),

  listConnections: () => apiRequest<SavedConnection[]>('/api/connections'),
  createConnection: (input: ConnectionInput) => post<SavedConnection & { warning?: string }>('/api/connections', input),
  updateConnection: (id: string, input: ConnectionInput) =>
    apiRequest<SavedConnection & { warning?: string }>(`/api/connections/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  setCompareOffset: (id: string, minutes: number | null) =>
    apiRequest<{ id: number; compareOffset: number | null }>(`/api/connections/${encodeURIComponent(id)}/compare-offset`, { method: 'PUT', body: JSON.stringify({ minutes }) }),
  importFileZilla: (xml: string) =>
    post<{ imported: number; skipped: string[]; warnings: string[] }>('/api/connections/import/filezilla', { xml }),
  deleteConnection: (id: string) =>
    apiRequest<{ deleted: number }>(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listBookmarks: () => apiRequest<FolderBookmark[]>('/api/bookmarks'),
  createBookmark: (input: { name: string; path: string; connectionId: string | null }) => post<FolderBookmark>('/api/bookmarks', input),
  deleteBookmark: (id: number) =>
    apiRequest<{ deleted: number }>(`/api/bookmarks/${id}`, { method: 'DELETE' }),

  openTerminal: (cols: number, rows: number) => post<{ id: string }>('/api/terminal/open', { cols, rows }),
  connectTerminal: (request: {
    cols: number
    rows: number
    connectionId?: string
    host?: string
    port?: string
    username?: string
    password?: string
    keyPath?: string
    trustHostKey?: string
  }) => post<{ id: string }>('/api/terminal/connect', request),
  closeTerminal: (id: string) => apiRequest<{ closed: string }>(`/api/terminal/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listTunnels: () => apiRequest<{ id: string; localPort: number; remoteHost: string; remotePort: number }[]>('/api/tunnels'),
  createTunnel: (input: { localPort: number; remoteHost: string; remotePort: number }) =>
    post<{ id: string; localPort: number; remoteHost: string; remotePort: number }>('/api/tunnels', input),
  deleteTunnel: (id: string) =>
    apiRequest<{ closed: string }>(`/api/tunnels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
