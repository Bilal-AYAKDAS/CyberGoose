import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TunnelModal } from '../components/TunnelModal'
import { api } from '../services/apiClient'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TunnelModal', () => {
  it('creates and closes an SSH port-forwarding tunnel', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listTunnels').mockResolvedValue([])
    const createSpy = vi.spyOn(api, 'createTunnel').mockResolvedValue({
      id: 'tun-1', localPort: 5432, remoteHost: '127.0.0.1', remotePort: 5432,
    })
    const deleteSpy = vi.spyOn(api, 'deleteTunnel').mockResolvedValue({ closed: 'tun-1' })

    render(<TunnelModal onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Tünel aç' }))
    expect(createSpy).toHaveBeenCalledWith({ localPort: 5432, remoteHost: '127.0.0.1', remotePort: 5432 })
    expect(await screen.findByText('127.0.0.1:5432 → 127.0.0.1:5432')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tüneli kapat' }))
    expect(deleteSpy).toHaveBeenCalledWith('tun-1')
  })
})
