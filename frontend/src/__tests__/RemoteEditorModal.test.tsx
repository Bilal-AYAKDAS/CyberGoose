import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteEditorModal } from '../components/RemoteEditorModal'
import { api } from '../services/apiClient'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RemoteEditorModal', () => {
  it('loads remote text and saves changes', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'readRemoteText').mockResolvedValue({ path: '/app.conf', content: 'port=80', encoding: 'cp1254', newline: '\r\n' })
    const writeSpy = vi.spyOn(api, 'writeRemoteText').mockResolvedValue({ path: '/app.conf', size: 9 })
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(<RemoteEditorModal path="/app.conf" name="app.conf" onSaved={onSaved} onClose={onClose} />)
    const box = await screen.findByLabelText('Dosya içeriği')
    expect(box).toHaveValue('port=80')
    await user.clear(box)
    await user.type(box, 'port=443')
    await user.click(screen.getByRole('button', { name: 'Uzak sunucuya kaydet' }))

    expect(writeSpy).toHaveBeenCalledWith('/app.conf', 'port=443', { encoding: 'cp1254', newline: '\r\n' })
    expect(screen.getByText('Windows-1254 · CRLF')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
