import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransferQueue } from '../components/TransferQueue'
import type { TransferItem } from '../types'

afterEach(cleanup)

describe('TransferQueue', () => {
  it('shows live progress percentage and triggers cancel on active transfer', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const items: TransferItem[] = [
      {
        id: 't1',
        name: 'arsiv.zip',
        direction: 'upload',
        localDir: 'C:/a',
        remoteDir: '/',
        from: 'C:/a',
        to: 'sftp:/',
        size: 1000,
        transferred: 500,
        status: 'transferring',
      },
    ]
    render(
      <TransferQueue
        items={items}
        open={true}
        onToggle={vi.fn()}
        onRetry={vi.fn()}
        onCancel={onCancel}
        onRemove={vi.fn()}
        onClearFinished={vi.fn()}
      />,
    )
    expect(screen.getByText('Aktarılıyor · %50')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'arsiv.zip aktarımını iptal et' }))
    expect(onCancel).toHaveBeenCalledWith('t1')
  })

  it('offers overwrite retry when destination file exists', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const items: TransferItem[] = [
      {
        id: 't2',
        name: 'rapor.pdf',
        direction: 'download',
        localDir: 'C:/a',
        remoteDir: '/',
        from: 'sftp:/',
        to: 'C:/a',
        size: 200,
        status: 'error',
        error: 'Hedefte aynı adlı dosya var',
        errorCode: 'exists',
      },
    ]
    render(
      <TransferQueue
        items={items}
        open={true}
        onToggle={vi.fn()}
        onRetry={onRetry}
        onRemove={vi.fn()}
        onClearFinished={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Üzerine yaz' }))
    expect(onRetry).toHaveBeenCalledWith('t2', true)
  })
})
