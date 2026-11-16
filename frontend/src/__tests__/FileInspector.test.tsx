import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileInspector } from '../components/FileInspector'
import { api } from '../services/apiClient'

afterEach(() => vi.restoreAllMocks())

describe('FileInspector', () => {
  it('renders hash and preview returned by the inspection API', async () => {
    vi.spyOn(api, 'getLocalFileInfo').mockResolvedValue({
      FileName: 'notes.txt',
      FilePath: 'C:/notes.txt',
      Type: 'File',
      Size: 12,
      Change: '2026-11-16 20:00:00',
      filemod: '0644',
      sha256: 'abc123',
      preview: 'hello',
      previewTruncated: false,
    })

    render(<FileInspector entry={{ name: 'notes.txt', kind: 'file', source: 'local', size: 12, modified: '2026-11-16T20:00:00', path: 'C:/notes.txt' }} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('abc123')).toBeInTheDocument())
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('does not call the local endpoint for remote files', () => {
    const spy = vi.spyOn(api, 'getLocalFileInfo')
    render(<FileInspector entry={{ name: 'deploy.zip', kind: 'file', source: 'remote', size: 28_000_000, modified: '2026-11-11T17:45:00', path: '/var/www/deploy.zip' }} onClose={vi.fn()} />)
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByText('28.0 MB')).toBeInTheDocument()
  })

  it('shows an error notice when the API fails', async () => {
    vi.spyOn(api, 'getLocalFileInfo').mockRejectedValue(new Error('offline'))
    render(<FileInspector entry={{ name: 'a.txt', kind: 'file', source: 'local', size: 1, modified: '2026-11-16T20:00:00', path: 'C:/a.txt' }} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Dosya bilgisi alınamadı.')
  })
})
