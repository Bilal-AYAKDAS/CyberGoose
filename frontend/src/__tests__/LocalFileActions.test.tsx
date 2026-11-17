import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { api } from '../services/apiClient'

beforeEach(() => {
  vi.spyOn(api, 'session').mockResolvedValue({ connected: false, type: null, connectionId: null })
  vi.spyOn(api, 'localHome').mockResolvedValue({ path: 'C:/Users/bilal' })
  vi.spyOn(api, 'listLocal').mockResolvedValue({
    path: 'C:/Users/bilal', parent: null, crumbs: [],
    entries: [{ name: 'site.zip', kind: 'file', size: 1000, modified: null, path: 'C:/Users/bilal/site.zip' }],
  })
  vi.spyOn(api, 'listBookmarks').mockResolvedValue([])
  vi.spyOn(api, 'providers').mockResolvedValue({ dropbox: true, googledrive: true, onedrive: true })
  vi.spyOn(api, 'listConnections').mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  delete window.cyberGoose
})

async function openMenu() {
  const table = await screen.findByRole('table', { name: 'Yerel dosyalar' })
  fireEvent.contextMenu(await within(table).findByText('site.zip'))
  return screen.findByRole('menu')
}

describe('local file actions', () => {
  it('extracts a zip archive next to it and refreshes the folder', async () => {
    const user = userEvent.setup()
    const extract = vi.spyOn(api, 'extractZip').mockResolvedValue({ path: 'C:/Users/bilal/site', name: 'site', files: 12, skipped: 1 })
    render(<App />)
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: /Buraya çıkar/ }))
    expect(extract).toHaveBeenCalledWith('C:/Users/bilal/site.zip')
    expect(await screen.findByText('12 dosya "site" klasörüne çıkarıldı. Güvenli olmayan 1 öğe atlandı.')).toBeInTheDocument()
  })

  it('opens with the default app and shows in Explorer through the desktop bridge', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn().mockResolvedValue(undefined)
    const showItemInFolder = vi.fn().mockRejectedValue(new Error('Dosya bulunamadı'))
    window.cyberGoose = { platform: 'win32', openExternal: vi.fn(), openPath, showItemInFolder }
    render(<App />)
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: /Varsayılan uygulamayla aç/ }))
    expect(openPath).toHaveBeenCalledWith('C:/Users/bilal/site.zip')
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: /Gezgin'de göster/ }))
    await waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith('C:/Users/bilal/site.zip'))
    expect(await screen.findByText('Dosya bulunamadı')).toBeInTheDocument()
  })

  it('hides desktop-only actions in the browser', async () => {
    render(<App />)
    await openMenu()
    expect(screen.queryByRole('menuitem', { name: /Varsayılan uygulamayla aç/ })).not.toBeInTheDocument()
  })
})
