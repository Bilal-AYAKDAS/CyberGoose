import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest } from '../services/apiClient'

afterEach(() => vi.restoreAllMocks())

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
