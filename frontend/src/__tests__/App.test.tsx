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
    const connect = vi.spyOn(api, 'connect').mockResolvedValue({ connected: true, type: 'SFTP' })
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
    vi.spyOn(api, 'connect').mockResolvedValue({ connected: true, type: 'SFTP' })
    const transfer = vi.spyOn(api, 'transfer').mockResolvedValue({ name: 'readme.txt', size: 379, to: 'C:/Users/bilal/readme.txt' })
    render(<App />)
    await screen.findByText('rapor.pdf')
    await user.click(await screen.findByRole('button', { name: /Rebex test/ }))
    const table = await screen.findByRole('table', { name: 'Rebex test dosyaları' })
    await user.click(await within(table).findByText('readme.txt'))
    await user.click(screen.getByRole('button', { name: 'İndir' }))
    await waitFor(() => expect(transfer).toHaveBeenCalledWith(expect.objectContaining({ direction: 'download', name: 'readme.txt', localDir: 'C:/Users/bilal', remoteDir: '/' })))
    const queue = screen.getByRole('region', { name: 'Transfer kuyruğu' })
    expect(await within(queue).findByText(/Tamamlandı/)).toBeInTheDocument()
  })

  it('switches between Graphite and Paper themes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('rapor.pdf')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Tema değiştir' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
