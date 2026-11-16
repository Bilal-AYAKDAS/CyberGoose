import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionModal } from '../components/ConnectionModal'
import { api } from '../services/apiClient'

afterEach(() => vi.restoreAllMocks())

describe('ConnectionModal', () => {
  it('validates required fields before connecting', async () => {
    const user = userEvent.setup()
    const connect = vi.spyOn(api, 'connect')
    render(<ConnectionModal onClose={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(screen.getByText('Bağlantı adı gerekli.')).toBeInTheDocument()
    expect(screen.getByText('Sunucu gerekli.')).toBeInTheDocument()
    expect(screen.getByText('Bağlanmak için parolayı girin.')).toBeInTheDocument()
    expect(connect).not.toHaveBeenCalled()
  })

  it('sends the password and saves a connected profile without storing it', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const connect = vi.spyOn(api, 'connect').mockResolvedValue({ 'Bağlantı': 'Başarılı' })
    render(<ConnectionModal onClose={vi.fn()} onSaved={onSaved} />)
    await user.type(screen.getByLabelText('Bağlantı adı'), 'web-01')
    await user.type(screen.getByLabelText('Sunucu'), '10.0.4.21')
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'deploy')
    await user.type(screen.getByLabelText('Parola'), 'gizli{enter}')
    expect(connect).toHaveBeenCalledWith({ type: 'SFTP', host: '10.0.4.21', port: '22', username: 'deploy', password: 'gizli' })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'web-01', status: 'connected' }))
    expect(JSON.stringify(onSaved.mock.calls[0][0])).not.toContain('gizli')
  })

  it('shows an error notice when the backend rejects the connection', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    vi.spyOn(api, 'connect').mockRejectedValue(new Error('var'))
    render(<ConnectionModal onClose={vi.fn()} onSaved={onSaved} />)
    await user.type(screen.getByLabelText('Bağlantı adı'), 'web-01')
    await user.type(screen.getByLabelText('Sunucu'), '10.0.4.21')
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'deploy')
    await user.type(screen.getByLabelText('Parola'), 'yanlis')
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('10.0.4.21 bağlantısı kurulamadı.')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('warns about plain FTP and disables FTPS', async () => {
    const user = userEvent.setup()
    render(<ConnectionModal onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'FTPS' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'FTP' }))
    expect(screen.getByLabelText('Port')).toHaveValue('21')
    expect(screen.getByText('Düz FTP şifrelenmez.')).toBeInTheDocument()
  })

  it('replaces server fields with account linking for cloud providers', async () => {
    const user = userEvent.setup()
    render(<ConnectionModal onClose={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: 'DROPBOX' }))
    expect(screen.queryByLabelText('Sunucu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hesabı bağla' })).toBeInTheDocument()
  })
})
