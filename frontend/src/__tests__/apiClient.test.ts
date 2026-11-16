import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, connect } from '../services/apiClient'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('returns JSON on successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    await expect(apiRequest<{ ok: boolean }>('/api/health')).resolves.toEqual({ ok: true })
  })

  it('raises a typed error on failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'offline' }), { status: 503 })))
    await expect(apiRequest('/api/health')).rejects.toEqual(expect.objectContaining<ApiError>({ name: 'ApiError', message: 'offline', status: 503 }))
  })
})

describe('connect', () => {
  it('sends the password and maps Dropbox to the backend name', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ 'Bağlantı': 'Başarılı' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await connect({ type: 'Dropbox', host: '', port: '', username: '', password: '' })
    await connect({ type: 'SFTP', host: 'h', port: '22', username: 'u', password: 'p' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).conn_type).toBe('DropBox')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ conn_type: 'SFTP', server: 'h', port: '22', username: 'u', passwd: 'p' })
  })

  it('treats a 200 response with an error body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'var' }), { status: 200 })))
    await expect(connect({ type: 'FTP', host: 'h', port: '21', username: 'u', password: 'p' })).rejects.toBeInstanceOf(ApiError)
  })

  it('surfaces 4xx/5xx responses from /submit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Kimlik doğrulanamadı' }), { status: 502 })))
    await expect(connect({ type: 'FTP', host: 'h', port: '21', username: 'u', password: 'p' })).rejects.toMatchObject({ status: 502, message: 'Kimlik doğrulanamadı' })
  })
})
