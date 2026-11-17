import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionModal } from '../components/ConnectionModal'
import { ApiError } from '../services/apiClient'

const noop = () => Promise.resolve()

describe('ConnectionModal', () => {
  it('validates required fields before connecting', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(<ConnectionModal onClose={vi.fn()} onSave={noop} onConnect={onConnect} />)
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(screen.getByText('Bağlantı adı gerekli.')).toBeInTheDocument()
    expect(screen.getByText('Sunucu gerekli.')).toBeInTheDocument()
    expect(screen.getByText('Bağlanmak için parolayı girin.')).toBeInTheDocument()
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('passes the form values to onConnect and closes on success', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<ConnectionModal onClose={onClose} onSave={noop} onConnect={onConnect} />)
    await user.type(screen.getByLabelText('Bağlantı adı'), 'Rebex')
    await user.type(screen.getByLabelText('Sunucu'), 'test.rebex.net')
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'demo')
    await user.type(screen.getByLabelText('Parola'), 'gizli{enter}')
    expect(onConnect).toHaveBeenCalledWith({ name: 'Rebex', type: 'SFTP', host: 'test.rebex.net', port: '22', username: 'demo', password: 'gizli', keyPath: '', group: '', useAgent: false, keyPassphrase: '' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the backend error message when the connection fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConnect = vi.fn().mockRejectedValue(new ApiError('Kimlik doğrulama başarısız', 401, 'auth_failed'))
    render(<ConnectionModal onClose={onClose} onSave={noop} onConnect={onConnect} />)
    await user.type(screen.getByLabelText('Bağlantı adı'), 'Rebex')
    await user.type(screen.getByLabelText('Sunucu'), 'test.rebex.net')
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'demo')
    await user.type(screen.getByLabelText('Parola'), 'yanlis')
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kimlik doğrulama başarısız')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uses the stored password for saved connections', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn().mockResolvedValue(undefined)
    render(<ConnectionModal
      initial={{ id: '8', name: 'Rebex', type: 'SFTP', host: 'test.rebex.net', port: '22', username: 'demo', hasPassword: true, saved: true }}
      onClose={vi.fn()} onSave={noop} onConnect={onConnect}
    />)
    expect(screen.getByLabelText('Parola')).toHaveAttribute('placeholder', 'Kayıtlı parola kullanılacak')
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ password: '' }))
  })

  it('warns about plain FTP but not about FTPS', async () => {
    const user = userEvent.setup()
    render(<ConnectionModal onClose={vi.fn()} onSave={noop} onConnect={noop} />)
    await user.click(screen.getByRole('radio', { name: 'FTPS' }))
    expect(screen.getByLabelText('Port')).toHaveValue('21')
    expect(screen.queryByText('Düz FTP şifrelenmez.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'FTP' }))
    expect(screen.getByLabelText('Port')).toHaveValue('21')
    expect(screen.getByText('Düz FTP şifrelenmez.')).toBeInTheDocument()
  })

  it('shows the pending Dropbox message instead of closing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConnect = vi.fn().mockResolvedValue({ pending: 'Tarayıcıda Dropbox iznini onaylayın.' })
    render(<ConnectionModal onClose={onClose} onSave={noop} onConnect={onConnect} />)
    await user.click(screen.getByRole('radio', { name: 'DROPBOX' }))
    expect(screen.queryByLabelText('Sunucu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(await screen.findByText('Tarayıcıda Dropbox iznini onaylayın.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('keeps the stored SFTP key path when editing a saved connection', () => {
    render(
      <ConnectionModal
        initial={{ id: '9', name: 'Anahtarlı', type: 'SFTP', host: 'web-01', port: '22', username: 'deploy', hasPassword: false, keyPath: 'C:/k/id_ed25519', saved: true }}
        onClose={vi.fn()}
        onSave={noop}
        onConnect={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('C:/k/id_ed25519')).toBeInTheDocument()
  })
  it('connects through the SSH agent without a password', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn().mockResolvedValue(undefined)
    render(<ConnectionModal onClose={vi.fn()} onSave={noop} onConnect={onConnect} />)
    await user.type(screen.getByLabelText('Bağlantı adı'), 'Pageant')
    await user.type(screen.getByLabelText('Sunucu'), 'web-01')
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'deploy')
    await user.click(screen.getByLabelText(/SSH agent kullan/))
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ useAgent: true, password: '' }))
  })

  it('asks for the key passphrase only when a key path is set', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn().mockResolvedValue(undefined)
    render(<ConnectionModal onClose={vi.fn()} onSave={noop} onConnect={onConnect} />)
    expect(screen.queryByLabelText('Anahtar parolası (varsa)')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Bağlantı adı'), 'Anahtar')
    await user.type(screen.getByLabelText('Sunucu'), 'web-01')
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'deploy')
    await user.type(screen.getByLabelText('Özel anahtar yolu (isteğe bağlı)'), 'C:/k/id')
    await user.type(screen.getByLabelText('Anahtar parolası (varsa)'), 'gizli-anahtar')
    await user.click(screen.getByRole('button', { name: 'Bağlan' }))
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ keyPath: 'C:/k/id', keyPassphrase: 'gizli-anahtar' }))
  })
})
