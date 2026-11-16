import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { api } from '../services/apiClient'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(api, 'getLocalFileInfo').mockRejectedValue(new Error('offline'))
})

describe('CyberGoose application window', () => {
  it('renders the design system window anatomy', () => {
    render(<App />)
    expect(screen.getByRole('toolbar', { name: 'Dosya işlemleri' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Bağlantılar' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Yerel dosyalar' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Üretim sunucusu dosyaları' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Transfer kuyruğu' })).toHaveTextContent('1 etkin · 1 sırada · 1 hata')
    expect(screen.getByText('deploy@server.cybergoose.com:22')).toBeInTheDocument()
  })

  it('moves the single primary action with the focused pane', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Yükle' })).toHaveClass('cg-btn-primary')
    await user.click(within(screen.getByRole('table', { name: 'Üretim sunucusu dosyaları' })).getByText('deploy.zip'))
    expect(screen.getByRole('button', { name: 'İndir' })).toHaveClass('cg-btn-primary')
    expect(screen.getByRole('button', { name: 'Yükle' })).not.toHaveClass('cg-btn-primary')
    expect(screen.getByRole('region', { name: 'Üretim sunucusu paneli' })).toHaveClass('is-focused')
  })

  it('queues an upload for the selected local file', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(within(screen.getByRole('table', { name: 'Yerel dosyalar' })).getByText('rapor.pdf'))
    await user.click(screen.getByRole('button', { name: 'Yükle' }))
    const queue = screen.getByRole('region', { name: 'Transfer kuyruğu' })
    expect(within(queue).getByRole('article', { name: 'rapor.pdf' })).toHaveTextContent('Sırada')
    expect(queue).toHaveTextContent('2 sırada')
  })

  it('opens file details with double click', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.dblClick(within(screen.getByRole('table', { name: 'Yerel dosyalar' })).getByText('README.md'))
    expect(screen.getByRole('complementary', { name: 'Dosya detayları' })).toHaveTextContent('README.md')
  })

  it('switches between Graphite and Paper themes', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Tema değiştir' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('filters bookmarks and opens the connection dialog', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Yer imleri' }))
    const panel = screen.getByRole('region', { name: 'Yer imleri' })
    await user.type(within(panel).getByRole('textbox', { name: 'Yer imlerinde ara' }), 'yedek')
    expect(within(panel).getByText('Günlük yedekler')).toBeInTheDocument()
    expect(within(panel).queryByText('Üretim web kökü')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Yeni bağlantı/i }))
    expect(screen.getByRole('dialog', { name: 'Yeni bağlantı' })).toBeInTheDocument()
  })

  it('retries a failed transfer and keeps the queue open while errors exist', async () => {
    const user = userEvent.setup()
    render(<App />)
    const queue = screen.getByRole('region', { name: 'Transfer kuyruğu' })
    expect(within(queue).getByRole('button', { name: /Aktarımlar/ })).toBeDisabled()
    await user.click(within(queue).getByRole('button', { name: 'Yeniden dene' }))
    expect(within(queue).getByRole('article', { name: 'config.json' })).toHaveTextContent('Sırada')
    expect(within(queue).getByRole('button', { name: /Aktarımlar/ })).toBeEnabled()
  })

  it('shows an offline connection with a connect action', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /Eski FTP/ }))
    expect(screen.getByText('Eski FTP bağlı değil')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(screen.getByRole('dialog', { name: 'Bağlantıyı düzenle' })).toBeInTheDocument()
  })
})
