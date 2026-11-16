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

    render(<FileInspector entry={{ name: 'notes.txt', kind: 'file', size: '12 B', modified: 'now', path: 'C:/notes.txt' }} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('abc123')).toBeInTheDocument())
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
