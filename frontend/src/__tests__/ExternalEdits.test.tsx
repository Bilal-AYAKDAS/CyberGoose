import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalEditsPanel } from '../components/ExternalEditsPanel'
import { useExternalEdits } from '../hooks/useExternalEdits'
import { api, type ExternalEdit } from '../services/apiClient'

const edit: ExternalEdit = {
  id: 'e1', sessionId: 4, remotePath: '/etc/nginx.conf', localPath: 'C:/data/edits/e1/nginx.conf', name: 'nginx.conf',
  uploads: 0, lastUpload: null, error: null, uploading: false,
}

afterEach(() => {
  vi.restoreAllMocks()
  delete window.cyberGoose
})

describe('external editor', () => {
  it('downloads the remote file and opens the local copy with the default app', async () => {
    const openPath = vi.fn().mockResolvedValue(undefined)
    window.cyberGoose = { platform: 'win32', openExternal: vi.fn(), openPath }
    const opened = vi.spyOn(api, 'openExternalEdit').mockResolvedValue(edit)
    const onError = vi.fn()
    const { result } = renderHook(() => useExternalEdits(onError))
    await act(() => result.current.open('/etc/nginx.conf', 4))
    expect(opened).toHaveBeenCalledWith('/etc/nginx.conf', 4)
    expect(openPath).toHaveBeenCalledWith('C:/data/edits/e1/nginx.conf')
    expect(result.current.edits).toEqual([edit])
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a real error when the download fails', async () => {
    vi.spyOn(api, 'openExternalEdit').mockRejectedValue(new Error('Uzak dosya bulunamadı'))
    const onError = vi.fn()
    const { result } = renderHook(() => useExternalEdits(onError))
    await act(() => result.current.open('/yok.txt', 4))
    expect(onError).toHaveBeenCalledWith('Uzak dosya bulunamadı')
    expect(result.current.edits).toEqual([])
  })

  it('shows upload state and stops an edit', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const onSync = vi.fn()
    render(
      <ExternalEditsPanel
        edits={[edit, { ...edit, id: 'e2', name: 'app.js', error: 'Hedef klasöre yazma izniniz yok' }]}
        onSync={onSync}
        onStop={onStop}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Kaydettiğinizde sunucuya yüklenir')).toBeInTheDocument()
    expect(screen.getByText('Hedef klasöre yazma izniniz yok')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'nginx.conf düzenlemesini bitir' }))
    expect(onStop).toHaveBeenCalledWith('e1')
    await user.click(screen.getAllByRole('button', { name: 'Şimdi yükle' })[1])
    expect(onSync).toHaveBeenCalledWith('e2')
  })
})
