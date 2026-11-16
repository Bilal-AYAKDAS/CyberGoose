import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteAccessModal } from '../components/RemoteAccessModal'

afterEach(cleanup)

describe('RemoteAccessModal', () => {
  it('opens direct SSH terminal with entered host, port, and credentials', async () => {
    const user = userEvent.setup()
    const onOpenSsh = vi.fn()
    const onClose = vi.fn()
    render(
      <RemoteAccessModal
        initialMode="ssh"
        savedConnections={[]}
        onOpenSsh={onOpenSsh}
        onClose={onClose}
      />,
    )

    await user.type(screen.getByLabelText('Sunucu / IP'), '10.0.4.21')
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'root')
    await user.type(screen.getByLabelText('Parola'), 'sifre')
    await user.click(screen.getByRole('button', { name: 'Terminali aç' }))

    expect(onOpenSsh).toHaveBeenCalledWith(expect.objectContaining({
      label: 'root@10.0.4.21',
      host: '10.0.4.21',
      port: '22',
      username: 'root',
      password: 'sifre',
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('switches to RDP mode and defaults port to 3389', async () => {
    const user = userEvent.setup()
    render(
      <RemoteAccessModal
        initialMode="ssh"
        savedConnections={[]}
        onOpenSsh={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'Uzak Masaüstü (RDP)' }))
    expect(screen.getByLabelText('Port')).toHaveValue('3389')
  })
})
