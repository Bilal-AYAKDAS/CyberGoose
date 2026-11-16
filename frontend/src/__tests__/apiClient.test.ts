import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, apiRequest } from '../services/apiClient'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('apiRequest', () => {
  it('returns JSON on successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true })))
    await expect(apiRequest<{ ok: boolean }>('/api/health')).resolves.toEqual({ ok: true })
  })

  it('raises a typed error with the backend message and code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Dosya zaten var', code: 'exists' }, 409)))
    await expect(apiRequest('/api/transfer')).rejects.toMatchObject({ name: 'ApiError', message: 'Dosya zaten var', status: 409, code: 'exists' })
  })

  it('turns a network failure into an offline error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await apiRequest('/api/health').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, code: 'offline' })
  })
})

describe('api', () => {
  it('posts JSON bodies to the new endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ connected: true, type: 'SFTP' }))
    vi.stubGlobal('fetch', fetchMock)
    await api.connect({ type: 'SFTP', connectionId: '8' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/connect')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ type: 'SFTP', connectionId: '8' })
  })

  it('always sends a body for POST requests without data', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ connected: false }))
    vi.stubGlobal('fetch', fetchMock)
    await api.disconnect()
    expect(fetchMock.mock.calls[0][1].body).toBe('{}')
  })
})
