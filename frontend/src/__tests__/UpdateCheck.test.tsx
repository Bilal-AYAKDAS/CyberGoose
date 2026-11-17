import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../components/SettingsModal'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import { defaultSettings } from '../hooks/useSettings'

const info = { current: '1.0.0', latest: '1.1.0', available: true, url: 'https://github.com/o/r/releases/tag/v1.1.0', notes: '', publishedAt: '' }

afterEach(() => {
  delete window.cyberGoose
  vi.useRealTimers()
})

describe('useUpdateCheck', () => {
  it('checks automatically once after startup when enabled', async () => {
    vi.useFakeTimers()
    const checkForUpdate = vi.fn().mockResolvedValue(info)
    window.cyberGoose = { platform: 'win32', openExternal: vi.fn(), checkForUpdate }
    const { result } = renderHook(() => useUpdateCheck(true))
    expect(checkForUpdate).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    expect(result.current.available?.latest).toBe('1.1.0')
    act(() => result.current.dismiss())
    expect(result.current.available).toBeNull()
  })

  it('does not check automatically when disabled and reports errors on manual check', async () => {
    vi.useFakeTimers()
    const checkForUpdate = vi.fn().mockRejectedValue(new Error("Error invoking remote method 'cybergoose:check-update': Error: Güncelleme denetlenemedi (HTTP 503)"))
    window.cyberGoose = { platform: 'win32', openExternal: vi.fn(), checkForUpdate }
    const { result } = renderHook(() => useUpdateCheck(false))
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(checkForUpdate).not.toHaveBeenCalled()
    await act(async () => { await result.current.check(true) })
    expect(result.current.state).toEqual({ status: 'error', error: 'Güncelleme denetlenemedi (HTTP 503)' })
  })

  it('explains that the browser build cannot check for updates', async () => {
    const { result } = renderHook(() => useUpdateCheck(true))
    expect(result.current.supported).toBe(false)
    await act(async () => { await result.current.check(true) })
    expect(result.current.state.error).toMatch(/masaüstü/)
  })
})

describe('SettingsModal updates', () => {
  const base = { themePreference: 'system' as const, onThemeChange: vi.fn(), settings: defaultSettings, onClose: vi.fn() }

  it('toggles the startup check setting', () => {
    const onChange = vi.fn()
    render(<SettingsModal {...base} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Açılışta yeni sürümü denetle'))
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, checkUpdates: false })
    expect(screen.queryByText('Güncellemeleri denetle')).not.toBeInTheDocument()
  })

  it('shows the result and download button for a new version', async () => {
    const onCheck = vi.fn()
    const onDownload = vi.fn()
    render(<SettingsModal {...base} onChange={vi.fn()} update={{ state: { status: 'done', info }, onCheck, onDownload }} />)
    fireEvent.click(screen.getByText('Güncellemeleri denetle'))
    expect(onCheck).toHaveBeenCalled()
    expect(screen.getByText('Yeni sürüm var: 1.1.0 (kurulu: 1.0.0)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('1.1.0 sürümünü indir'))
    expect(onDownload).toHaveBeenCalledWith(info.url)
  })

  it('shows up-to-date and error states', async () => {
    const props = { onCheck: vi.fn(), onDownload: vi.fn() }
    const { rerender } = render(<SettingsModal {...base} onChange={vi.fn()} update={{ state: { status: 'done', info: { ...info, available: false, latest: '1.0.0' } }, ...props }} />)
    expect(screen.getByText('CyberGoose güncel (1.0.0).')).toBeInTheDocument()
    rerender(<SettingsModal {...base} onChange={vi.fn()} update={{ state: { status: 'error', error: 'Yayınlanmış bir sürüm bulunamadı' }, ...props }} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Yayınlanmış bir sürüm bulunamadı'))
  })
})
