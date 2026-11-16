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
    apiRequest('/api/localfileinfo', {
      method: 'POST',
      body: JSON.stringify({ filepath }),
    }),
  getLocalFilePreview: (filepath: string) =>
    apiRequest('/api/localfilepreview', {
      method: 'POST',
      body: JSON.stringify({ filepath }),
    }),
  connect: (values: unknown) =>
    apiRequest('/submit', { method: 'POST', body: JSON.stringify(values) }),
}
