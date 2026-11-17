import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { LeftSourcePicker } from '../components/LeftSourcePicker'
import { useTransferQueue } from '../hooks/useTransferQueue'
import { ApiError, api } from '../services/apiClient'
import type { ConnectionProfile, DirectoryListing, FileEntry } from '../types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const sftp: ConnectionProfile = { id: '1', name: 'Kaynak', type: 'SFTP', host: 'a', port: '22', username: 'u', hasPassword: true, saved: true }

describe('LeftSourcePicker', () => {
  it('lists local and usable connections and reports the choice', () => {
    const onChange = vi.fn()
    render(
      <LeftSourcePicker
        connections={[
          sftp,
          { ...sftp, id: 'quick', name: 'Hızlı', quick: true },
          { id: 'dropbox', name: 'Dropbox', type: 'Dropbox', host: '', port: '', username: '', hasPassword: false, saved: false, configured: false },
          { id: 'drive', name: 'Google Drive', type: 'GoogleDrive', host: '', port: '', username: '', hasPassword: false, saved: false, configured: true },
        ]}
        value="local"
        onChange={onChange}
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Sol panel kaynağı' })
    const labels = within(select).getAllByRole('option').map((option) => option.textContent)
    expect(labels).toEqual(['YEREL', 'SFTP · Kaynak', expect.stringContaining('Google Drive')])
    fireEvent.change(select, { target: { value: '1' } })
    expect(onChange).toHaveBeenCalledWith('1')
  })
})

describe('useTransferQueue copy', () => {
  const remoteFile = (name: string, path = `/src/${name}`): FileEntry => ({ name, path, kind: 'file', size: 5, modified: null, source: 'remote' })

  function setup(reloadLocal = vi.fn(), reloadRemote = vi.fn()) {
    return renderHook(() => useTransferQueue({
      localPath: null,
      remotePath: '/',
      activeConnection: sftp,
      sessionId: 2,
      notifications: false,
      overwriteDefault: 'skip',
      reloadLocal,
      reloadRemote,
    }))
  }

  it('copies files between two sessions and reloads the target pane', async () => {
    const start = vi.spyOn(api, 'startTransfer').mockResolvedValue({
      id: 'job-1', status: 'completed', transferred: 5, total: 5, result: { name: 'a.txt', size: 5, to: '/dst/a.txt' },
    })
    const reloadRemote = vi.fn()
    const { result } = setup(vi.fn(), reloadRemote)
    await act(async () => {
      await result.current.enqueueCopy(
        [remoteFile('a.txt')],
        { dir: '/src', sessionId: 7, label: 'u@a:22', pane: 'local' },
        { dir: '/dst', sessionId: 2, label: 'Drive', pane: 'remote' },
      )
    })
    await waitFor(() => expect(result.current.transfers[0].status).toBe('completed'))
    expect(start).toHaveBeenCalledWith({
      direction: 'copy', name: 'a.txt', sourceDir: '/src', targetDir: '/dst',
      sourceSessionId: 7, sessionId: 2, overwrite: false, conflict: 'skip',
    })
    expect(result.current.transfers[0]).toMatchObject({ from: 'u@a:22:/src', to: 'Drive:/dst', direction: 'copy' })
    expect(reloadRemote).toHaveBeenCalled()
  })

  it('expands folders on the source session and creates them on the target session', async () => {
    const plan = vi.spyOn(api, 'planFolderTransfer').mockResolvedValue({
      rootName: 'site', files: [{ relativeDir: '', name: 'index.html', size: 3 }, { relativeDir: 'css/alt', name: 'a.css', size: 1 }],
    })
    const mkdir = vi.spyOn(api, 'mkdir').mockResolvedValue({ name: 'x', path: '/x' })
    vi.spyOn(api, 'startTransfer').mockResolvedValue({ id: 'j', status: 'completed', transferred: 1, total: 1, result: { name: 'x', size: 1, to: 'x' } })
    const reloadLocal = vi.fn()
    const { result } = setup(reloadLocal)
    let count = 0
    await act(async () => {
      count = await result.current.enqueueCopy(
        [{ name: 'site', path: '/www/site', kind: 'folder', size: null, modified: null, source: 'remote' }],
        { dir: '/www', sessionId: 2, label: 'sağ', pane: 'remote' },
        { dir: '/yedek', sessionId: 9, label: 'sol', pane: 'local' },
      )
    })
    expect(count).toBe(2)
    expect(plan).toHaveBeenCalledWith('remote', '/www/site', 2)
    expect(mkdir.mock.calls).toEqual([
      ['remote', '/yedek', 'site', 9],
      ['remote', '/yedek/site', 'css', 9],
      ['remote', '/yedek/site/css', 'alt', 9],
    ])
    const items = result.current.transfers
    expect(items.map((item) => [item.sourceDir, item.remoteDir, item.sourceSessionId, item.sessionId])).toEqual([
      ['/www/site', '/yedek/site', 2, 9],
      ['/www/site/css/alt', '/yedek/site/css/alt', 2, 9],
    ])
    await waitFor(() => expect(reloadLocal).toHaveBeenCalled())
  })
})

const localListing: DirectoryListing = {
  path: 'C:/Users/bilal', parent: 'C:/Users', crumbs: [{ name: 'bilal', path: 'C:/Users/bilal' }],
  entries: [{ name: 'yerel.txt', kind: 'file', size: 1, modified: null, path: 'C:/Users/bilal/yerel.txt' }],
}
const leftListing: DirectoryListing = {
  path: '/', parent: null, crumbs: [],
  entries: [{ name: 'yedek.tar', kind: 'file', size: 50, modified: null, path: '/yedek.tar' }],
}
const rightListing: DirectoryListing = {
  path: '/', parent: null, crumbs: [],
  entries: [{ name: 'site.zip', kind: 'file', size: 9, modified: null, path: '/site.zip' }],
}

describe('App remote-to-remote', () => {
  beforeEach(() => {
    vi.spyOn(api, 'session').mockResolvedValue({ connected: false, type: null, connectionId: null })
    vi.spyOn(api, 'localHome').mockResolvedValue({ path: 'C:/Users/bilal' })
    vi.spyOn(api, 'listLocal').mockResolvedValue(localListing)
    vi.spyOn(api, 'listRemote').mockImplementation(async (_path, sessionId) => (sessionId === 11 ? leftListing : rightListing))
    vi.spyOn(api, 'listBookmarks').mockResolvedValue([])
    vi.spyOn(api, 'providers').mockResolvedValue({ dropbox: false, googledrive: false, onedrive: false })
    vi.spyOn(api, 'listConnections').mockResolvedValue([
      { id: 8, name: 'Web', type: 'SFTP', host: 'web', port: '22', username: 'deploy', hasPassword: true },
      { id: 9, name: 'Yedek', type: 'FTP', host: 'nas', port: '21', username: 'bilal', hasPassword: true },
    ])
  })

  it('opens a second server in the left pane and copies a file to the right server', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connect').mockResolvedValue({ connected: true, type: 'SFTP', sessionId: 4 })
    const connectSide = vi.spyOn(api, 'connectSide').mockResolvedValue({ connected: true, type: 'FTP', sessionId: 11 })
    const disconnectSide = vi.spyOn(api, 'disconnectSide').mockResolvedValue({ connected: false })
    const start = vi.spyOn(api, 'startTransfer').mockResolvedValue({
      id: 'job', status: 'completed', transferred: 50, total: 50, result: { name: 'yedek.tar', size: 50, to: '/yedek.tar' },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Web/ }))
    await screen.findByRole('table', { name: 'Web dosyaları' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sol panel kaynağı' }), '9')
    expect(connectSide).toHaveBeenCalledWith(expect.objectContaining({ type: 'FTP', connectionId: '9' }))
    const leftTable = await screen.findByRole('table', { name: 'Yedek dosyaları' })
    const row = await within(leftTable).findByText('yedek.tar')
    expect(api.listRemote).toHaveBeenCalledWith('/', 11)

    fireEvent.contextMenu(row)
    await user.click(await screen.findByRole('menuitem', { name: /Sağ panele kopyala/ }))
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'copy', name: 'yedek.tar', sourceDir: '/', targetDir: '/', sourceSessionId: 11, sessionId: 4,
    })))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sol panel kaynağı' }), 'local')
    expect(disconnectSide).toHaveBeenCalledWith(11)
    expect(await screen.findByRole('table', { name: 'Yerel dosyalar' })).toBeInTheDocument()
  })

  it('asks for a right-hand connection before copying', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connectSide').mockResolvedValue({ connected: true, type: 'FTP', sessionId: 11 })
    const start = vi.spyOn(api, 'startTransfer')
    render(<App />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Sol panel kaynağı' }), '9')
    const leftTable = await screen.findByRole('table', { name: 'Yedek dosyaları' })
    fireEvent.contextMenu(await within(leftTable).findByText('yedek.tar'))
    const item = await screen.findByRole('menuitem', { name: /Sağ panele kopyala/ })
    expect(item).toBeDisabled()
    expect(start).not.toHaveBeenCalled()
  })

  it('shows why the left connection failed and stays local', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connectSide').mockRejectedValue(new ApiError('Bu bağlantı için parola kayıtlı değil', 400, 'password_required'))
    render(<App />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Sol panel kaynağı' }), '9')
    expect(await screen.findByText(/Yedek sol panelde açılamadı: Bu bağlantı için parola kayıtlı değil/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Yerel dosyalar' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sol panel kaynağı' })).toHaveValue('local')
  })
})
