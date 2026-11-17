import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { Sidebar } from '../components/Sidebar'
import { api } from '../services/apiClient'
import type { ConnectionProfile } from '../types'
import { groupServers } from '../utils/groups'

const profile = (id: string, name: string, group?: string): ConnectionProfile => ({
  id, name, type: 'SFTP', host: `${id}.example.com`, port: '22', username: 'u', hasPassword: true, saved: true, group,
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const sidebarProps = {
  homePath: 'C:/Users/bilal',
  bookmarks: [],
  activeConnectionId: null,
  statusOf: () => 'offline' as const,
  onLocalSelect: vi.fn(),
  onConnectionSelect: vi.fn(),
  onConnectionMenu: vi.fn(),
  onBookmarkSelect: vi.fn(),
  onManageBookmarks: vi.fn(),
}

describe('connection groups', () => {
  it('puts ungrouped servers first and sorts groups', () => {
    const groups = groupServers([profile('a', 'A', 'Zeta'), profile('b', 'B'), profile('c', 'C', 'Alfa'), profile('d', 'D', 'Zeta')])
    expect(groups.map(([name, members]) => [name, members.map((item) => item.id)])).toEqual([
      ['', ['b']], ['Alfa', ['c']], ['Zeta', ['a', 'd']],
    ])
  })

  it('shows group headings that collapse', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...sidebarProps} connections={[profile('1', 'Web', 'Müşteriler/ACME'), profile('2', 'Depo')]} />)
    const head = screen.getByRole('button', { name: /Müşteriler\/ACME/ })
    expect(screen.getByRole('button', { name: /Web/ })).toBeInTheDocument()
    await user.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Web/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Depo/ })).toBeInTheDocument()
  })

  it('imports a FileZilla file from the sidebar and reports the result', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'session').mockResolvedValue({ connected: false, type: null, connectionId: null })
    vi.spyOn(api, 'localHome').mockResolvedValue({ path: 'C:/Users/bilal' })
    vi.spyOn(api, 'listLocal').mockResolvedValue({ path: 'C:/Users/bilal', parent: null, crumbs: [], entries: [] })
    vi.spyOn(api, 'listBookmarks').mockResolvedValue([])
    vi.spyOn(api, 'providers').mockResolvedValue({ dropbox: true, googledrive: true, onedrive: true })
    const list = vi.spyOn(api, 'listConnections').mockResolvedValue([])
    const importer = vi.spyOn(api, 'importFileZilla').mockResolvedValue({ imported: 2, skipped: ['Eski'], warnings: ['Beta: parola FileZilla ana parolasıyla şifreli, bağlanırken sorulacak.'] })
    render(<App />)
    const input = await screen.findByLabelText('FileZilla dosyası seç')
    await user.upload(input, new File(['<FileZilla3/>'], 'sitemanager.xml', { type: 'text/xml' }))
    await waitFor(() => expect(importer).toHaveBeenCalledWith('<FileZilla3/>'))
    expect(await screen.findByText(/2 bağlantı içe aktarıldı. 1 tanesi zaten kayıtlıydı. Beta:/)).toBeInTheDocument()
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
