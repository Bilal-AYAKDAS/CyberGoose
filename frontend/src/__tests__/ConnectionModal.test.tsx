import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionModal } from '../components/ConnectionModal'

describe('ConnectionModal', () => {
  it('validates required fields before submitting', async () => {
    const user = userEvent.setup()
    render(<ConnectionModal onClose={vi.fn()} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Bağlan ve kaydet' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Bağlantı adı, host ve port zorunludur.')
  })
})
