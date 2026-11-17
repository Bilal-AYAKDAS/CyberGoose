import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransferQueue } from '../components/TransferQueue'
import { useTransferQueue } from '../hooks/useTransferQueue'
import { ApiError, api } from '../services/apiClient'
import type { ConnectionProfile, FileEntry, TransferItem } from '../types'

const server: ConnectionProfile = { id: '1', name: 'Sunucu', type: 'FTP', host: 'h', port: '21', username: 'u', hasPassword: true, saved: true }
const file = (name: string): FileEntry => ({ name, path: `C:/y/${name}`, kind: 'file', size: 4, modified: null, source: 'local' })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function setup(overwriteDefault: 'ask' | 'skip' = 'ask') {
  return renderHook(() => useTransferQueue({
    localPath: 'C:/y', remotePath: '/', activeConnection: server, sessionId: 2, notifications: false, overwriteDefault,
    reloadLocal: () => undefined, reloadRemote: () => undefined,
  }))
}

describe('conflict decisions', () => {
  it('sends the default conflict policy from settings', async () => {
    const start = vi.spyOn(api, 'startTransfer').mockResolvedValue({
      id: 'j', status: 'completed', transferred: 4, total: 4, result: { name: 'a.txt', size: 4, to: '/a.txt', skipped: true, skipReason: 'Hedefte vardı, atlandı' },
    })
    const { result } = setup('skip')
    act(() => result.current.enqueueMany([file('a.txt')], 'upload'))
    await waitFor(() => expect(result.current.transfers[0].status).toBe('completed'))
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ conflict: 'skip' }))
    expect(result.current.transfers[0].skipped).toBe('Hedefte vardı, atlandı')
  })

  it('applies one decision to every conflicting file', async () => {
    const start = vi.spyOn(api, 'startTransfer').mockImplementation(async (request) => {
      if (!request.conflict) throw new ApiError('Hedefte aynı adlı dosya var', 409, 'exists')
      return { id: `j-${request.name}`, status: 'completed', transferred: 4, total: 4, result: { name: request.name, size: 4, to: '/', renamedTo: `${request.name} (1)` } }
    })
    const { result } = setup()
    act(() => result.current.enqueueMany([file('a.txt'), file('b.txt')], 'upload'))
    await waitFor(() => expect(result.current.transfers.every((item) => item.errorCode === 'exists')).toBe(true))
    act(() => result.current.resolveConflicts('rename'))
    await waitFor(() => expect(result.current.transfers.every((item) => item.status === 'completed')).toBe(true))
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt', conflict: 'rename', overwrite: false }))
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.txt', conflict: 'rename' }))
    expect(result.current.transfers[0].renamedTo).toBe('a.txt (1)')
  })

  it('shows the apply-to-all bar for conflicts', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const conflict: TransferItem = {
      id: 'c', name: 'a.txt', direction: 'upload', localDir: 'C:/y', remoteDir: '/', sessionId: 2, from: 'C:/y', to: 'S:/', size: 4,
      status: 'error', errorCode: 'exists', error: 'Hedefte aynı adlı dosya var',
    }
    render(<TransferQueue items={[conflict, { ...conflict, id: 'd', name: 'b.txt' }]} open onToggle={vi.fn()} onRetry={vi.fn()} onResolveConflicts={onResolve} onRemove={vi.fn()} onClearFinished={vi.fn()} />)
    expect(screen.getByText('2 dosya hedefte zaten var. Tümüne uygula:')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Daha yeniyse yaz' }))
    expect(onResolve).toHaveBeenCalledWith('newer')
  })
})
