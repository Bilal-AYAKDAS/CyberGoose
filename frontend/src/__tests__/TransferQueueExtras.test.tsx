import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransferQueue } from '../components/TransferQueue'
import { QUEUE_STORAGE_KEY, loadQueue, useTransferQueue } from '../hooks/useTransferQueue'
import { api } from '../services/apiClient'
import type { ConnectionProfile, TransferItem } from '../types'
import { etaText } from '../utils/formatters'

const server: ConnectionProfile = { id: '1', name: 'Sunucu', type: 'SFTP', host: 'h', port: '22', username: 'u', hasPassword: true, saved: true }

const base: TransferItem = {
  id: 't1', name: 'yedek.tar', direction: 'upload', localDir: 'C:/y', remoteDir: '/', sessionId: 3, connectionId: '1',
  from: 'C:/y', to: 'Sunucu:/', size: 100_000_000, status: 'transferring', transferred: 25_000_000, jobId: 'job-1',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('transfer speed and remaining time', () => {
  it('formats the remaining time', () => {
    expect(etaText(5_000_000, 1_000_000)).toBe('5 sn')
    expect(etaText(190_000_000, 1_000_000)).toBe('3 dk 10 sn')
    expect(etaText(3_900_000_000, 1_000_000)).toBe('1 sa 5 dk')
    expect(etaText(100, undefined)).toBeNull()
  })

  it('shows the live rate and remaining time for a running transfer', () => {
    render(<TransferQueue items={[{ ...base, rate: 5_000_000 }]} open onToggle={vi.fn()} onRetry={vi.fn()} onRemove={vi.fn()} onClearFinished={vi.fn()} />)
    expect(screen.getByText('Aktarılıyor · %25 · 15 sn kaldı')).toBeInTheDocument()
    expect(screen.getByText('5.0 MB/s')).toBeInTheDocument()
  })

  it('measures the rate from progress polls', async () => {
    let polls = 0
    vi.spyOn(api, 'startTransfer').mockResolvedValue({ id: 'job-9', status: 'transferring', transferred: 0, total: 1_000_000 })
    vi.spyOn(api, 'getTransfer').mockImplementation(async () => {
      polls += 1
      return polls < 4
        ? { id: 'job-9', status: 'transferring', transferred: polls * 100_000, total: 1_000_000 }
        : { id: 'job-9', status: 'completed', transferred: 1_000_000, total: 1_000_000, result: { name: 'a', size: 1_000_000, to: '/' } }
    })
    const { result } = renderHook(() => useTransferQueue({
      localPath: 'C:/y', remotePath: '/', activeConnection: server, sessionId: 3, notifications: false,
      reloadLocal: () => undefined, reloadRemote: () => undefined,
    }))
    act(() => result.current.enqueueMany([{ name: 'a', path: 'C:/y/a', kind: 'file', size: 1_000_000, modified: null, source: 'local' }], 'upload'))
    await waitFor(() => expect(result.current.transfers[0].rate).toBeGreaterThan(0), { timeout: 3000 })
    await waitFor(() => expect(result.current.transfers[0].status).toBe('completed'), { timeout: 3000 })
    expect(result.current.transfers[0].rate).toBeUndefined()
  })
})

describe('persistent queue', () => {
  it('restores unfinished items as interrupted so they can be retried', () => {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify([
      base,
      { ...base, id: 't2', status: 'queued', jobId: undefined, transferred: 0 },
      { ...base, id: 't3', status: 'error', errorCode: 'exists', error: 'Hedefte aynı adlı dosya var', jobId: undefined },
    ]))
    const items = loadQueue()
    expect(items.map((item) => [item.id, item.status, item.errorCode])).toEqual([
      ['t1', 'error', 'session_closed'],
      ['t2', 'error', 'session_closed'],
      ['t3', 'error', 'exists'],
    ])
    expect(items[0].jobId).toBeUndefined()
  })

  it('ignores a corrupt saved queue', () => {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, '{bozuk')
    expect(loadQueue()).toEqual([])
  })

  it('saves unfinished items, rebinds them to the reopened connection and retries all', async () => {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify([base, { ...base, id: 't2', name: 'b.tar' }]))
    const start = vi.spyOn(api, 'startTransfer').mockImplementation(async (request) => ({
      id: `job-${request.name}`, status: 'completed', transferred: 1, total: 1, result: { name: request.name, size: 1, to: '/' },
    }))
    const { result } = renderHook(() => useTransferQueue({
      localPath: 'C:/y', remotePath: '/', activeConnection: server, sessionId: 7, notifications: false,
      reloadLocal: () => undefined, reloadRemote: () => undefined,
    }))
    expect(result.current.transfers).toHaveLength(2)
    expect(JSON.parse(window.localStorage.getItem(QUEUE_STORAGE_KEY) ?? '[]')).toHaveLength(2)
    act(() => result.current.retryAll())
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: 'yedek.tar', sessionId: 7, resume: true }))
    await waitFor(() => expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).toBeNull())
  })
})
