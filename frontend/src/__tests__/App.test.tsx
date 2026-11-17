import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { ApiError, api } from '../services/apiClient'
import type { DirectoryListing } from '../types'

const localListing: DirectoryListing = {
  path: 'C:/Users/bilal',
  parent: 'C:/Users',
  crumbs: [{ name: 'C:', path: 'C:/' }, { name: 'Users', path: 'C:/Users' }, { name: 'bilal', path: 'C:/Users/bilal' }],
  entries: [
    { name: 'Belgeler', kind: 'folder', size: null, modified: '2026-11-10T09:00:00', path: 'C:/Users/bilal/Belgeler' },
    { name: 'rapor.pdf', kind: 'file', size: 2_400_000, modified: '2026-11-12T10:00:00', path: 'C:/Users/bilal/rapor.pdf' },
    { name: '.gizli', kind: 'file', size: 10, modified: '2026-11-12T10:00:00', path: 'C:/Users/bilal/.gizli', hidden: true },
  ],
}

const remoteListing: DirectoryListing = {
  path: '/',
  parent: null,
  crumbs: [],
  entries: [{ name: 'readme.txt', kind: 'file', size: 379, modified: '2023-03-23T12:00:00', path: '/readme.txt' }],
}

function mockBackend() {
  vi.spyOn(api, 'session').mockResolvedValue({ connected: false, type: null, connectionId: null })
  vi.spyOn(api, 'localHome').mockResolvedValue({ path: 'C:/Users/bilal' })
  vi.spyOn(api, 'listLocal').mockResolvedValue(localListing)
  vi.spyOn(api, 'listRemote').mockResolvedValue(remoteListing)
  vi.spyOn(api, 'listBookmarks').mockResolvedValue([])
  vi.spyOn(api, 'providers').mockResolvedValue({ dropbox: false, googledrive: true, onedrive: true })
  vi.spyOn(api, 'listConnections').mockResolvedValue([
    { id: 8, name: 'Rebex test', type: 'SFTP', host: 'test.rebex.net', port: '22', username: 'demo', hasPassword: true },
  ])
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
  mockBackend()
})

describe('CyberGoose application window', () => {
  it('shows the real local folder and saved connections from the API', async () => {
    const onReady = vi.fn()
    render(<App onReady={onReady} />)
    const table = await screen.findByRole('table', { name: 'Yerel dosyalar' })
    expect(await within(table).findByText('rapor.pdf')).toBeInTheDocument()
    expect(screen.getByText('demo@test.rebex.net:22')).toBeInTheDocument()
    expect(screen.getByText('Henüz bağlantı yok')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Transfer kuyruğu' })).toHaveTextContent('0 etkin · 0 sırada · 0 hata')
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
  })

  it('shows a real error instead of sample data when the backend is down', async () => {
    const offline = new ApiError("CyberGoose API'sine ulaşılamadı.", 0, 'offline')
    vi.spyOn(api, 'listLocal').mockRejectedValue(offline)
    vi.spyOn(api, 'listConnections').mockRejectedValue(offline)
    render(<App />)
    const pane = screen.getByRole('region', { name: 'Yerel panel' })
    expect(await within(pane).findByRole('alert')).toHaveTextContent("CyberGoose API'sine ulaşılamadı.")
    expect(within(pane).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Yerel dosyalar' })).not.toBeInTheDocument()
  })

  it('connects a saved server with its stored password and lists the remote folder', async () => {
    const user = userEvent.setup()
    const connect = vi.spyOn(api, 'connect').mockResolvedValue({ connected: true, type: 'SFTP', sessionId: 1 })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Rebex test/ }))
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ type: 'SFTP', connectionId: '8' }))
    const table = await screen.findByRole('table', { name: 'Rebex test dosyaları' })
    expect(await within(table).findByText('readme.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'İndir' })).toHaveClass('cg-btn-primary')
  })

  it('shows the backend error when a connection fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connect').mockRejectedValue(new ApiError('Kimlik doğrulama başarısız', 401, 'auth_failed'))
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Rebex test/ }))
    expect(await screen.findByText('Kimlik doğrulama başarısız')).toBeInTheDocument()
  })

  it('downloads a remote file through the transfer API', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connect').mockResolvedValue({ connected: true, type: 'SFTP', sessionId: 1 })
    const startTransfer = vi.spyOn(api, 'startTransfer').mockResolvedValue({
      id: 'job-1',
      status: 'completed',
      transferred: 379,
      total: 379,
      result: { name: 'readme.txt', size: 379, to: 'C:/Users/bilal/readme.txt' },
    })
    render(<App />)
    await screen.findByText('rapor.pdf')
    await user.click(await screen.findByRole('button', { name: /Rebex test/ }))
    const table = await screen.findByRole('table', { name: 'Rebex test dosyaları' })
    await user.click(await within(table).findByText('readme.txt'))
    await user.click(screen.getByRole('button', { name: 'İndir' }))
    await waitFor(() => expect(startTransfer).toHaveBeenCalledWith(expect.objectContaining({ direction: 'download', name: 'readme.txt', localDir: 'C:/Users/bilal', remoteDir: '/' })))
    const queue = screen.getByRole('region', { name: 'Transfer kuyruğu' })
    expect(await within(queue).findByText(/Tamamlandı/)).toBeInTheDocument()
  })

  it('supports multi-select with Ctrl+Click and updates selection count', async () => {
    const user = userEvent.setup()
    render(<App />)
    const table = await screen.findByRole('table', { name: 'Yerel dosyalar' })
    const folderRow = (await within(table).findByText('Belgeler')).closest('tr')!
    const fileRow = (await within(table).findByText('rapor.pdf')).closest('tr')!
    await user.click(folderRow)
    await user.keyboard('{Control>}')
    await user.click(fileRow)
    await user.keyboard('{/Control}')
    expect(screen.getByText(/2 öğe · 2 seçili/)).toBeInTheDocument()
  })

  it('switches between Graphite and Paper themes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('rapor.pdf')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Tema değiştir' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
  it('hides hidden files until Ctrl+H toggles them', async () => {
    const user = userEvent.setup()
    render(<App />)
    const table = await screen.findByRole('table', { name: 'Yerel dosyalar' })
    await within(table).findByText('rapor.pdf')
    expect(within(table).queryByText('.gizli')).not.toBeInTheDocument()
    await user.keyboard('{Control>}h{/Control}')
    expect(await within(table).findByText('.gizli')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gizli dosyaları göster' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('moves local files to the recycle bin by default and deletes permanently on request', async () => {
    const user = userEvent.setup()
    const remove = vi.spyOn(api, 'deleteEntry').mockResolvedValue(undefined as never)
    render(<App />)
    const table = await screen.findByRole('table', { name: 'Yerel dosyalar' })
    await user.click(await within(table).findByText('rapor.pdf'))
    await user.keyboard('{Delete}')
    const dialog = await screen.findByRole('dialog', { name: 'Dosyayı sil' })
    expect(dialog).toHaveTextContent("Geri Dönüşüm Kutusu'na taşınacak")
    await user.click(within(dialog).getByRole('button', { name: "Geri Dönüşüm Kutusu'na taşı" }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('local', 'C:/Users/bilal/rapor.pdf', false))

    await user.click(await within(table).findByText('rapor.pdf'))
    await user.keyboard('{Shift>}{Delete}{/Shift}')
    const permanent = await screen.findByRole('dialog', { name: 'Dosyayı sil' })
    expect(permanent).toHaveTextContent('kalıcı olarak silinecek')
    await user.click(within(permanent).getByRole('button', { name: 'Kalıcı olarak sil' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('local', 'C:/Users/bilal/rapor.pdf', true))
  })

  it('quick-connects without saving and binds transfers to the new session', async () => {
    const user = userEvent.setup()
    const connect = vi.spyOn(api, 'connect').mockResolvedValue({ connected: true, type: 'SFTP', sessionId: 7 })
    const create = vi.spyOn(api, 'createConnection')
    const startTransfer = vi.spyOn(api, 'startTransfer').mockResolvedValue({ id: 'job-9', status: 'completed', transferred: 379, total: 379, result: { name: 'readme.txt', size: 379, to: 'C:/Users/bilal/readme.txt' } })
    render(<App />)
    await screen.findByText('rapor.pdf')
    await user.keyboard('{Control>}k{/Control}')
    const bar = await screen.findByRole('search', { name: 'Hızlı bağlan' })
    await user.type(within(bar).getByRole('textbox', { name: 'Sunucu' }), 'demo@test.rebex.net:2222')
    await user.type(within(bar).getByLabelText('Parola'), 'gizli')
    await user.click(within(bar).getByRole('button', { name: 'Bağlan' }))
    await waitFor(() => expect(connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'test.rebex.net', port: '2222', username: 'demo', clientId: 'quick' })))
    expect(create).not.toHaveBeenCalled()
    const table = await screen.findByRole('table', { name: 'demo@test.rebex.net dosyaları' })
    await user.click(await within(table).findByText('readme.txt'))
    await user.click(screen.getByRole('button', { name: 'İndir' }))
    await waitFor(() => expect(startTransfer).toHaveBeenCalledWith(expect.objectContaining({ name: 'readme.txt', sessionId: 7 })))
  })

  it('asks the user to verify an unknown SFTP host key before trusting it', async () => {
    const user = userEvent.setup()
    const hostKeyError = new ApiError('anahtar ilk kez görülüyor', 409, 'host_key_unknown', { hostKey: { host: 'test.rebex.net', type: 'ssh-ed25519', fingerprint: 'SHA256:abc' } })
    const connect = vi.spyOn(api, 'connect')
      .mockRejectedValueOnce(hostKeyError)
      .mockResolvedValueOnce({ connected: true, type: 'SFTP', sessionId: 2 })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Rebex test/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Sunucu anahtarını doğrulayın' })
    expect(dialog).toHaveTextContent('SHA256:abc')
    await user.click(within(dialog).getByRole('button', { name: 'Güven ve bağlan' }))
    await waitFor(() => expect(connect).toHaveBeenLastCalledWith(expect.objectContaining({ trustHostKey: 'SHA256:abc' })))
    expect(await screen.findByRole('table', { name: 'Rebex test dosyaları' })).toBeInTheDocument()
  })

  it('explains how to set up a cloud account that is not configured', async () => {
    const user = userEvent.setup()
    const connect = vi.spyOn(api, 'connect')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Dropbox/ }))
    expect(await screen.findByText(/DROPBOX_APP_KEY/)).toBeInTheDocument()
    expect(connect).not.toHaveBeenCalled()
  })
  it('reloads the remote listing when switching servers at the same path', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connect')
      .mockResolvedValueOnce({ connected: true, type: 'SFTP', sessionId: 1 })
      .mockResolvedValueOnce({ connected: true, type: 'SFTP', sessionId: 2 })
    const listRemote = vi.spyOn(api, 'listRemote')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Rebex test/ }))
    await screen.findByRole('table', { name: 'Rebex test dosyaları' })
    expect(listRemote).toHaveBeenCalledTimes(1)
    await user.keyboard('{Control>}k{/Control}')
    const bar = await screen.findByRole('search', { name: 'Hızlı bağlan' })
    await user.type(within(bar).getByRole('textbox', { name: 'Sunucu' }), 'demo@diger.example')
    await user.type(within(bar).getByLabelText('Parola'), 'x')
    await user.click(within(bar).getByRole('button', { name: 'Bağlan' }))
    await screen.findByRole('table', { name: 'demo@diger.example dosyaları' })
    await waitFor(() => expect(listRemote).toHaveBeenCalledTimes(2))
  })
})
