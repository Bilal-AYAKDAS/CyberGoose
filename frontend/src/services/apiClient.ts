import type { ConnectionType, FileInspection } from '../types'

export class ApiError extends Error {
  readonly status: number

  constructor(
    message: string,
    status: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error ?? `Request failed with status ${response.status}`
    throw new ApiError(message, response.status)
  }
  return payload as T
}

/** Flask `/submit` sözleşmesindeki sağlayıcı adları. */
const backendConnectionTypes: Record<ConnectionType, string> = {
  FTP: 'FTP',
  FTPS: 'FTPS',
  SFTP: 'SFTP',
  Dropbox: 'DropBox',
  GoogleDrive: 'GoogleDrive',
}

export type ConnectRequest = {
  type: ConnectionType
  host: string
  port: string
  username: string
  password: string
}

export type ConnectResponse = { 'Bağlantı'?: string; error?: string }

/**
 * Bağlantı isteği. Eski backend sürümleri hata durumunda da HTTP 200 dönebildiği için
 * gövde de kontrol edilir: `error` alanı veya "Başarılı" dışındaki bir yanıt hata sayılır.
 */
export async function connect(request: ConnectRequest): Promise<ConnectResponse> {
  const payload = await apiRequest<ConnectResponse>('/submit', {
    method: 'POST',
    body: JSON.stringify({
      conn_type: backendConnectionTypes[request.type],
      server: request.host,
      port: request.port,
      username: request.username,
      passwd: request.password,
    }),
  })
  if (!payload || payload.error || payload['Bağlantı'] !== 'Başarılı') {
    throw new ApiError(payload?.error ?? payload?.['Bağlantı'] ?? 'Bağlantı kurulamadı', 502)
  }
  return payload
}

export const api = {
  listLocalFiles: (filepath: string) =>
    apiRequest('/api/localfiles', {
      method: 'POST',
      body: JSON.stringify({ filepath }),
    }),
  listRemoteFiles: (path: string) =>
    apiRequest('/api/serverfilelist', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  listBookmarks: () => apiRequest('/api/getBookmarksList'),
  getLocalFileInfo: (filepath: string) =>
    apiRequest<FileInspection>('/api/localfileinfo', {
      method: 'POST',
      body: JSON.stringify({ filepath }),
    }),
  getLocalFilePreview: (filepath: string) =>
    apiRequest('/api/localfilepreview', {
      method: 'POST',
      body: JSON.stringify({ filepath }),
    }),
  connect,
}
