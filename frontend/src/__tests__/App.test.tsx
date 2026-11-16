import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('CyberGoose application shell', () => {
  it('renders both file panels and supports selecting a file', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Yerel bilgisayar' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Üretim sunucusu' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /README\.md/i }))
    expect(screen.getByRole('complementary', { name: 'Dosya detayları' })).toHaveTextContent('README.md')
  })

  it('switches between Graphite and Paper themes', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Tema değiştir' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('filters bookmarks and opens the connection modal', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /Yer imleri/i }))
    expect(screen.getByRole('region', { name: 'Yer imleri' })).toBeInTheDocument()
    const filter = screen.getByRole('textbox', { name: 'Yer imlerinde ara' })
    await user.type(filter, 'yedek')
    expect(screen.getByText('Günlük yedekler')).toBeInTheDocument()
    expect(screen.queryByText('Üretim web kökü')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Yeni bağlantı/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Yeni bağlantı')
  })

  it('updates and retries transfer queue items', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /Aktarımlar/i }))
    expect(screen.getByRole('region', { name: 'Transfer kuyruğu' })).toHaveTextContent('Aktarılıyor')
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))
    expect(screen.getByRole('region', { name: 'Transfer kuyruğu' })).toHaveTextContent('Bekliyor')
  })
})
