import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../components/SettingsModal'

afterEach(cleanup)

describe('SettingsModal', () => {
  it('updates density, overwrite default, and notifications', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SettingsModal
        theme="dark"
        onToggleTheme={vi.fn()}
        settings={{ density: 'comfortable', overwriteDefault: 'ask', notifications: true }}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'Sıkışık (22px)' }))
    expect(onChange).toHaveBeenCalledWith({ density: 'compact', overwriteDefault: 'ask', notifications: true })

    await user.click(screen.getByRole('radio', { name: 'Üzerine yaz' }))
    expect(onChange).toHaveBeenCalledWith({ density: 'comfortable', overwriteDefault: 'overwrite', notifications: true })
  })
})
