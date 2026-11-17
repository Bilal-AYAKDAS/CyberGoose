import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompareModal } from '../components/CompareModal'
import { rowsFor } from '../utils/compare'
import { api, type CompareResult } from '../services/apiClient'

const result: CompareResult = {
  localPath: 'C:/site',
  remotePath: '/www',
  summary: { onlyLocal: 1, onlyRemote: 1, different: 1, same: 1 },
  items: [
    { relativeDir: '', name: 'index.html', status: 'different', localSize: 10, remoteSize: 8, localModified: null, remoteModified: null, newer: 'local' },
    { relativeDir: 'css', name: 'yeni.css', status: 'onlyLocal', localSize: 5, remoteSize: null, localModified: null, remoteModified: null, newer: null },
    { relativeDir: '', name: 'eski.txt', status: 'onlyRemote', localSize: null, remoteSize: 3, localModified: null, remoteModified: null, newer: null },
    { relativeDir: '', name: 'ayni.txt', status: 'same', localSize: 1, remoteSize: 1, localModified: null, remoteModified: null, newer: null },
  ],
}

afterEach(() => vi.restoreAllMocks())

describe('CompareModal', () => {
  it('splits rows by sync direction', () => {
    expect(rowsFor(result.items, 'upload').map((row) => row.name)).toEqual(['index.html', 'yeni.css'])
    expect(rowsFor(result.items, 'download').map((row) => row.name)).toEqual(['index.html', 'eski.txt'])
  })

  it('lists differences and queues the selected files for upload', async () => {
    const user = userEvent.setup()
    const compare = vi.spyOn(api, 'compareFolders').mockResolvedValue(result)
    const onSync = vi.fn().mockResolvedValue(1)
    render(<CompareModal localPath="C:/site" remotePath="/www" sessionId={3} onSync={onSync} onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Karşılaştırma özeti')).toHaveTextContent('1 farklı · 1 yalnız yerelde · 1 yalnız sunucuda · 1 aynı')
    expect(compare).toHaveBeenCalledWith('C:/site', '/www', 3)
    expect(screen.queryByText('ayni.txt')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('css/yeni.css seç'))
    await user.click(screen.getByRole('button', { name: 'Yerelden sunucuya eşitle (1)' }))
    expect(onSync).toHaveBeenCalledWith([result.items[0]], 'upload')
    expect(await screen.findByText('1 dosya kuyruğa eklendi.')).toBeInTheDocument()
  })

  it('shows the backend error instead of an empty result', async () => {
    vi.spyOn(api, 'compareFolders').mockRejectedValue(new Error('Bu aktarımın bağlantısı kapandı.'))
    render(<CompareModal localPath="C:/site" remotePath="/www" sessionId={3} onSync={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Bu aktarımın bağlantısı kapandı.')).toBeInTheDocument()
  })
})
