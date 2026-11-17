import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileInspector } from '../components/FileInspector'
import { api } from '../services/apiClient'
import { previewKind } from '../utils/preview'

const createObjectURL = vi.fn(() => 'blob:preview-1')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  vi.spyOn(api, 'getLocalFileInfo').mockResolvedValue({
    FileName: 'x', FilePath: 'x', Type: 'File', Size: 1, Change: '2026-11-16 20:00:00', filemod: '0644', sha256: 'h', preview: '', previewTruncated: false,
  })
  vi.spyOn(api, 'getRemoteDetails').mockResolvedValue({ path: '/r', permissions: '644', canChmod: false })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

const file = (name: string, source: 'local' | 'remote' = 'local') => ({
  name, kind: 'file' as const, source, size: 10, modified: '2026-11-16T20:00:00', path: source === 'local' ? `C:/${name}` : `/srv/${name}`,
})

describe('previewKind', () => {
  it('maps extensions to preview kinds', () => {
    expect(previewKind('a.PNG')).toBe('image')
    expect(previewKind('logo.svg')).toBe('image')
    expect(previewKind('doc.pdf')).toBe('pdf')
    expect(previewKind('notes.txt')).toBeNull()
    expect(previewKind('Makefile')).toBeNull()
  })
})

describe('FileInspector media preview', () => {
  it('shows a local image from the preview endpoint and revokes the URL on close', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<FileInspector entry={file('photo.png')} onClose={vi.fn()} />)
    const image = await screen.findByRole('img', { name: 'photo.png önizleme' })
    expect(image).toHaveAttribute('src', 'blob:preview-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/local\/preview$/)
    expect(JSON.parse(init.body)).toEqual({ path: 'C:/photo.png' })
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  })

  it('renders a remote PDF in a frame and sends the session id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['%PDF'], { type: 'application/pdf' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<FileInspector entry={file('report.pdf', 'remote')} sessionId={7} onClose={vi.fn()} />)
    expect(await screen.findByTitle('PDF önizleme')).toHaveAttribute('src', 'blob:preview-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/remote\/preview$/)
    expect(JSON.parse(init.body)).toEqual({ path: '/srv/report.pdf', sessionId: 7 })
  })

  it('shows the backend error when the preview fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Önizleme için dosya çok büyük' }), { status: 413 })))
    render(<FileInspector entry={file('huge.jpg')} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Önizleme için dosya çok büyük')).toBeInTheDocument())
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('does not request a preview for other file types', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<FileInspector entry={file('notes.txt')} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('h')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Önizleme yükleniyor…')).not.toBeInTheDocument()
  })
})
