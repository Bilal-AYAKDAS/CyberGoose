import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { SearchModal } from '../components/SearchModal'
import { api } from '../services/apiClient'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('deep search', () => {
  it('searches the focused local folder and opens the folder of a hit', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'session').mockResolvedValue({ connected: false, type: null, connectionId: null })
    vi.spyOn(api, 'localHome').mockResolvedValue({ path: 'C:/Users/bilal' })
    const listLocal = vi.spyOn(api, 'listLocal').mockImplementation(async (path) => ({
      path: path ?? 'C:/Users/bilal', parent: null, crumbs: [], entries: [],
    }))
    vi.spyOn(api, 'listBookmarks').mockResolvedValue([])
    vi.spyOn(api, 'providers').mockResolvedValue({ dropbox: true, googledrive: true, onedrive: true })
    vi.spyOn(api, 'listConnections').mockResolvedValue([])
    const search = vi.spyOn(api, 'search').mockResolvedValue({
      results: [{ name: 'fatura.pdf', kind: 'file', path: 'C:/Users/bilal/Belgeler/2026/fatura.pdf', parent: 'C:/Users/bilal/Belgeler/2026', size: 2048, modified: null }],
      truncated: false,
      scanned: 120,
    })
    render(<App />)
    await waitFor(() => expect(listLocal).toHaveBeenCalled())
    const box = screen.getByLabelText('Bu klasörde ara')
    await user.type(box, 'fatura{enter}')
    await waitFor(() => expect(search).toHaveBeenCalledWith('local', 'C:/Users/bilal', 'fatura', undefined))
    expect(await screen.findByLabelText('Arama özeti')).toHaveTextContent('1 sonuç · 120 öğe tarandı')
    await user.click(screen.getByText('fatura.pdf'))
    await waitFor(() => expect(listLocal).toHaveBeenCalledWith('C:/Users/bilal/Belgeler/2026'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows remote search errors', async () => {
    vi.spyOn(api, 'search').mockRejectedValue(new Error('Bu aktarımın bağlantısı kapandı.'))
    render(<SearchModal side="remote" path="/var/www" query="index" sessionId={5} onOpen={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Bu aktarımın bağlantısı kapandı.')).toBeInTheDocument()
  })

  it('tells the user when the result limit was reached', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ results: [], truncated: true, scanned: 50000 })
    render(<SearchModal side="remote" path="/" query="a" sessionId={5} onOpen={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Arama özeti')).toHaveTextContent('sınıra ulaşıldı')
  })
})
