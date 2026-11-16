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

  constructor(
    message: string,
    status: number,
    code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
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
    throw new ApiError(message, response.status, payload?.code)
  }
  return payload as T
}

const post = <T>(path: string, data: unknown = {}) =>
  apiRequest<T>(path, { method: 'POST', body: JSON.stringify(data) })

export type ConnectRequest = {
  type: ConnectionType
  host?: string
  port?: string
  username?: string
  password?: string
  /** Kayıtlı bağlantı: parola boşsa backend kayıtlı parolayı kullanır. */
  connectionId?: string
  /** Arayüzdeki bağlantı kimliği; oturum geri yüklenirken eşlemek için. */
  clientId?: string
}

export type ConnectResponse =
  | { connected: true; type: ConnectionType }
  | { pending: true; message: string }

export type SessionInfo = { connected: boolean; type: ConnectionType | null; connectionId: string | null }

export type TransferRequest = {
  direction: 'upload' | 'download'
  name: string
  localDir: string
  remoteDir: string
  overwrite?: boolean
}

export type ConnectionInput = { name: string; type: ConnectionType; host: string; port: string; username: string }

export const api = {
  session: () => apiRequest<SessionInfo>('/api/session'),
  connect: (request: ConnectRequest) => post<ConnectResponse>('/api/connect', request),
  disconnect: () => post<{ connected: false }>('/api/disconnect'),

  localHome: () => apiRequest<{ path: string }>('/api/local/home'),
  listLocal: (path: string | null) => post<DirectoryListing>('/api/local/list', { path }),
  getLocalFileInfo: (path: string) => post<FileInspection>('/api/local/info', { path }),

  listRemote: (path: string) => post<DirectoryListing>('/api/remote/list', { path }),
  getRemoteDetails: (path: string) => post<RemoteDetails>('/api/remote/info', { path }),
  chmodRemote: (path: string, mode: string) => post<RemoteDetails>('/api/remote/chmod', { path, mode }),

  transfer: (request: TransferRequest) => post<{ name: string; size: number; to: string }>('/api/transfer', request),
  deleteEntry: (side: 'local' | 'remote', path: string) => post<{ deleted: string }>('/api/delete', { side, path }),

  listConnections: () => apiRequest<SavedConnection[]>('/api/connections'),
  createConnection: (input: ConnectionInput) => post<SavedConnection>('/api/connections', input),
  updateConnection: (id: string, input: ConnectionInput) =>
    apiRequest<SavedConnection>(`/api/connections/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteConnection: (id: string) =>
    apiRequest<{ deleted: number }>(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listBookmarks: () => apiRequest<FolderBookmark[]>('/api/bookmarks'),
  createBookmark: (input: { name: string; path: string; connectionId: string | null }) => post<FolderBookmark>('/api/bookmarks', input),
  deleteBookmark: (id: number) =>
    apiRequest<{ deleted: number }>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
}
