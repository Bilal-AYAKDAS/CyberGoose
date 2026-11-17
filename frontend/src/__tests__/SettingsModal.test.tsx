import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../components/SettingsModal'
import { defaultSettings } from '../hooks/useSettings'

afterEach(cleanup)

describe('SettingsModal', () => {
  it('updates density, overwrite default, parallel transfers and hidden files', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SettingsModal
        themePreference="dark"
        onThemeChange={vi.fn()}
        settings={defaultSettings}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'Sıkışık' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, density: 'compact' })

    await user.click(screen.getByRole('radio', { name: 'Üzerine yaz' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, overwriteDefault: 'overwrite' })

    await user.click(screen.getByRole('radio', { name: '4' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, maxParallel: 4 })

    await user.click(screen.getByRole('checkbox', { name: /Gizli dosyaları göster/ }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, showHidden: true })
  })

  it('offers a system theme that follows the OS setting', async () => {
    const user = userEvent.setup()
    const onThemeChange = vi.fn()
    render(<SettingsModal themePreference="dark" onThemeChange={onThemeChange} settings={defaultSettings} onChange={vi.fn()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: 'Sistem' }))
    expect(onThemeChange).toHaveBeenCalledWith('system')
  })
})
