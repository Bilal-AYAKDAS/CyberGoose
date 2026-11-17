import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '../hooks/useTransferQueue'
import { ApiError, api } from '../services/apiClient'
import type { ConnectionProfile, FileEntry } from '../types'

const server: ConnectionProfile = { id: '1', name: 'Sunucu', type: 'SFTP', host: 'h', port: '22', username: 'u', hasPassword: true, saved: true }
const file = (name: string): FileEntry => ({ name, path: `/${name}`, kind: 'file', size: 10, modified: null, source: 'remote' })

function setup(sessionId: number, maxParallel = 2) {
  return renderHook((props: { sessionId: number }) => useTransferQueue({
    localPath: 'C:/indir',
    remotePath: '/',
    activeConnection: server,
    sessionId: props.sessionId,
    maxParallel,
    notifications: false,
    reloadLocal: () => undefined,
    reloadRemote: () => undefined,
  }), { initialProps: { sessionId } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('useTransferQueue', () => {
  it('keeps each item bound to the session it was queued on', async () => {
    const start = vi.spyOn(api, 'startTransfer').mockImplementation(async (request) => ({
      id: `job-${request.name}`, status: 'completed', transferred: 10, total: 10, result: { name: request.name, size: 10, to: 'x' },
    }))
    const { result, rerender } = setup(3, 1)
    act(() => result.current.enqueueMany([file('a.txt')], 'download'))
    rerender({ sessionId: 4 })
    act(() => result.current.enqueueMany([file('b.txt')], 'download'))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt', sessionId: 3 }))
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.txt', sessionId: 4 }))
  })

  it('keeps following the same job after a transient polling failure', async () => {
    vi.spyOn(api, 'startTransfer').mockResolvedValue({ id: 'job-1', status: 'transferring', transferred: 0, total: 10 })
    const poll = vi.spyOn(api, 'getTransfer')
      .mockRejectedValueOnce(new ApiError('ağ', 0, 'offline'))
      .mockResolvedValueOnce({ id: 'job-1', status: 'completed', transferred: 10, total: 10, result: { name: 'a.txt', size: 10, to: 'x' } })
    const { result } = setup(1)
    act(() => result.current.enqueueMany([file('a.txt')], 'download'))
    await waitFor(() => expect(result.current.transfers[0].status).toBe('completed'), { timeout: 3000 })
    expect(poll).toHaveBeenCalledTimes(2)
    expect(poll).toHaveBeenNthCalledWith(2, 'job-1')
  })

  it('cancels a running job through the API and never starts a cancelled queued item', async () => {
    vi.spyOn(api, 'startTransfer').mockResolvedValue({ id: 'job-1', status: 'transferring', transferred: 0, total: 10 })
    let cancelled = false
    vi.spyOn(api, 'getTransfer').mockImplementation(async () => (cancelled
      ? { id: 'job-1', status: 'cancelled', transferred: 2, total: 10 }
      : { id: 'job-1', status: 'transferring', transferred: 2, total: 10 }))
    const cancel = vi.spyOn(api, 'cancelTransfer').mockImplementation(async () => { cancelled = true; return { id: 'job-1', status: 'cancelled', transferred: 2, total: 10 } })
    const { result } = setup(1, 1)
    act(() => result.current.enqueueMany([file('a.txt'), file('b.txt')], 'download'))
    await waitFor(() => expect(result.current.transfers[0].jobId).toBe('job-1'))
    const [running, queued] = result.current.transfers
    act(() => result.current.cancelTransfer(queued.id))
    act(() => result.current.cancelTransfer(running.id))
    await waitFor(() => expect(result.current.transfers[0].status).toBe('cancelled'), { timeout: 3000 })
    expect(cancel).toHaveBeenCalledWith('job-1')
    expect(result.current.transfers[1].status).toBe('cancelled')
    expect(api.startTransfer).toHaveBeenCalledTimes(1)
  })
})
