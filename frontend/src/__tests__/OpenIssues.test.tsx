import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { CompareModal } from '../components/CompareModal'
import { describeOffset } from '../utils/compare'
import { FileInspector } from '../components/FileInspector'
import { RemoteEditorModal } from '../components/RemoteEditorModal'
import { UpdateActions } from '../components/UpdateActions'
import { useTransferQueue } from '../hooks/useTransferQueue'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import { api, type CompareResult } from '../services/apiClient'
import type { ConnectionProfile, DirectoryListing } from '../types'
import type { UpdateProgress } from '../types/electron'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  delete window.cyberGoose
})

// ---------------------------------------------------------------- 2. saat dilimi

const compared: CompareResult = {
  localPath: '/sol', remotePath: '/sag',
  summary: { onlyLocal: 0, onlyRemote: 0, different: 1, same: 2 },
  items: [{ relativeDir: '', name: 'a.txt', status: 'different', localSize: 1, remoteSize: 2, localModified: null, remoteModified: null, newer: 'local' }],
  timeOffsetMinutes: 180,
  timeOffsetDetected: true,
}

describe('CompareModal time offset', () => {
  it('shows the detected offset and re-compares with a manual one', async () => {
    const compare = vi.spyOn(api, 'compareFolders').mockResolvedValue(compared)
    render(<CompareModal localPath="C:/site" remotePath="/www" sessionId={3} onSync={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Otomatik bulundu: sunucu 3 saat ileride.')).toBeInTheDocument()
    expect(compare).toHaveBeenLastCalledWith('C:/site', '/www', 3)

    fireEvent.change(screen.getByLabelText('Sunucu saat farkı'), { target: { value: '-120' } })
    await waitFor(() => expect(compare).toHaveBeenLastCalledWith('C:/site', '/www', 3, { timeOffsetMinutes: -120 }))
    expect(screen.queryByText(/Otomatik bulundu/)).not.toBeInTheDocument()
  })

  it('compares two servers when the left pane is remote', async () => {
    const compare = vi.spyOn(api, 'compareFolders').mockResolvedValue({ ...compared, timeOffsetDetected: false })
    const onSync = vi.fn().mockResolvedValue(1)
    render(<CompareModal localPath="/sol" remotePath="/sag" sessionId={3} leftSessionId={11} leftLabel="Yedek" onSync={onSync} onClose={vi.fn()} />)
    expect(await screen.findByRole('columnheader', { name: 'Yedek' })).toBeInTheDocument()
    expect(compare).toHaveBeenCalledWith('/sol', '/sag', 3, { leftSessionId: 11 })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Soldan sağa eşitle (1)' }))
    expect(onSync).toHaveBeenCalledWith([compared.items[0]], 'upload')
  })

  it('describes offsets in words', () => {
    expect(describeOffset(0)).toBe('saat farkı yok')
    expect(describeOffset(-60)).toBe('sunucu 1 saat geride')
    expect(describeOffset(330)).toBe('sunucu 330 dakika ileride')
  })
})

// ---------------------------------------------------------------- 3. sol paneldeki uzak bağlantı

describe('left-pane remote files', () => {
  it('reads details with the left session', async () => {
    const details = vi.spyOn(api, 'getRemoteDetails').mockResolvedValue({ path: '/a.txt', permissions: '644', canChmod: false })
    render(<FileInspector entry={{ name: 'a.txt', path: '/a.txt', kind: 'file', size: 1, modified: null, source: 'remote', sessionId: 11 }} sessionId={4} onClose={vi.fn()} />)
    await waitFor(() => expect(details).toHaveBeenCalledWith('/a.txt', 11))
  })

  it('reads and saves text with the left session', async () => {
    const read = vi.spyOn(api, 'readRemoteText').mockResolvedValue({ path: '/a.txt', content: 'x', encoding: 'utf-8', newline: '\n' })
    const write = vi.spyOn(api, 'writeRemoteText').mockResolvedValue({ path: '/a.txt', size: 2 })
    render(<RemoteEditorModal side="remote" sessionId={11} path="/a.txt" name="a.txt" onSaved={vi.fn()} onClose={vi.fn()} />)
    const box = await screen.findByDisplayValue('x')
    expect(read).toHaveBeenCalledWith('/a.txt', 11)
    fireEvent.change(box, { target: { value: 'xy' } })
    await userEvent.setup().click(screen.getByRole('button', { name: /kaydet/i }))
    expect(write).toHaveBeenCalledWith('/a.txt', 'xy', { encoding: 'utf-8', newline: '\n', sessionId: 11 })
  })

  it('copies compare rows between two servers, creating folders on the target', async () => {
    const mkdir = vi.spyOn(api, 'mkdir').mockResolvedValue({ name: 'x', path: '/x' })
    vi.spyOn(api, 'startTransfer').mockResolvedValue({ id: 'j', status: 'completed', transferred: 1, total: 1, result: { name: 'x', size: 1, to: 'x' } })
    const sftp: ConnectionProfile = { id: '1', name: 'Web', type: 'SFTP', host: 'a', port: '22', username: 'u', hasPassword: true, saved: true }
    const { result } = renderHook(() => useTransferQueue({
      localPath: null, remotePath: '/', activeConnection: sftp, sessionId: 4, notifications: false, reloadLocal: vi.fn(), reloadRemote: vi.fn(),
    }))
    let count = 0
    await act(async () => {
      count = await result.current.enqueueCopyRelative(
        [{ relativeDir: 'css/alt', name: 'a.css', size: 1 }, { relativeDir: '', name: 'index.html', size: 2 }],
        { dir: '/sol', sessionId: 11, label: 'sol', pane: 'local' },
        { dir: '/sag', sessionId: 4, label: 'sağ', pane: 'remote' },
        true,
      )
    })
    expect(count).toBe(2)
    expect(mkdir.mock.calls).toEqual([['remote', '/sag', 'css', 4], ['remote', '/sag/css', 'alt', 4]])
    expect(result.current.transfers.map((item) => [item.sourceDir, item.remoteDir, item.conflict])).toEqual([
      ['/sol/css/alt', '/sag/css/alt', 'overwrite'],
      ['/sol', '/sag', 'overwrite'],
    ])
  })

  describe('App menu', () => {
    const listing = (entries: DirectoryListing['entries']): DirectoryListing => ({ path: '/', parent: null, crumbs: [], entries })
    beforeEach(() => {
      vi.spyOn(api, 'session').mockResolvedValue({ connected: false, type: null, connectionId: null })
      vi.spyOn(api, 'localHome').mockResolvedValue({ path: 'C:/Users/bilal' })
      vi.spyOn(api, 'listLocal').mockResolvedValue({ path: 'C:/Users/bilal', parent: null, crumbs: [], entries: [] })
      vi.spyOn(api, 'listRemote').mockResolvedValue(listing([
        { name: 'paket.zip', kind: 'file', size: 9, modified: null, path: '/paket.zip' },
        { name: 'ayar.ini', kind: 'file', size: 9, modified: null, path: '/ayar.ini' },
      ]))
      vi.spyOn(api, 'listBookmarks').mockResolvedValue([])
      vi.spyOn(api, 'providers').mockResolvedValue({ dropbox: false, googledrive: false, onedrive: false })
      vi.spyOn(api, 'listConnections').mockResolvedValue([{ id: 9, name: 'Yedek', type: 'FTP', host: 'nas', port: '21', username: 'bilal', hasPassword: true }])
      vi.spyOn(api, 'connectSide').mockResolvedValue({ connected: true, type: 'FTP', sessionId: 11 })
    })

    it('offers editors, details and remote unzip for left-pane server files', async () => {
      const user = userEvent.setup()
      const extract = vi.spyOn(api, 'extractZip').mockResolvedValue({ path: '/paket', name: 'paket', files: 3, skipped: 0 })
      const openEdit = vi.spyOn(api, 'openExternalEdit').mockResolvedValue({ id: 'e', sessionId: 11, remotePath: '/ayar.ini', localPath: 'C:/t/ayar.ini', name: 'ayar.ini', uploads: 0, lastUpload: null, error: null, uploading: false })
      render(<App />)
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Sol panel kaynağı' }), '9')
      const left = await screen.findByRole('table', { name: 'Yedek dosyaları' })

      fireEvent.contextMenu(await within(left).findByText('paket.zip'))
      await user.click(await screen.findByRole('menuitem', { name: 'Sunucuda buraya çıkar' }))
      await waitFor(() => expect(extract).toHaveBeenCalledWith('/paket.zip', 'remote', 11))
      expect(await screen.findByText('3 dosya "paket" klasörüne çıkarıldı.')).toBeInTheDocument()

      fireEvent.contextMenu(within(left).getByText('ayar.ini'))
      expect(await screen.findByRole('menuitem', { name: 'Metin olarak düzenle' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /^Detaylar/ })).toBeInTheDocument()
      await user.click(screen.getByRole('menuitem', { name: 'Düzenleyicide aç (kaydedince yüklenir)' }))
      await waitFor(() => expect(openEdit).toHaveBeenCalledWith('/ayar.ini', 11))
    })
  })
})

// ---------------------------------------------------------------- 5. uygulama içi güncelleme

const info = { current: '1.0.0', latest: '1.1.0', available: true, url: 'https://github.com/o/r/releases/tag/v1.1.0', notes: '', publishedAt: '', canInstall: true }

describe('in-app update', () => {
  it('downloads with progress and restarts', async () => {
    let emit: (progress: UpdateProgress) => void = () => {}
    let finish: () => void = () => {}
    const applyUpdate = vi.fn().mockResolvedValue({ restarting: true })
    window.cyberGoose = {
      platform: 'win32', openExternal: vi.fn(),
      checkForUpdate: vi.fn().mockResolvedValue(info),
      downloadUpdate: vi.fn(() => new Promise<{ ready: boolean; version: string; mode: 'portable' }>((resolve) => { finish = () => resolve({ ready: true, version: '1.1.0', mode: 'portable' }) })),
      applyUpdate,
      onUpdateProgress: (callback) => { emit = callback; return vi.fn() },
    }
    const { result } = renderHook(() => useUpdateCheck(false))
    await act(async () => { await result.current.check(true) })
    expect(result.current.canInstall).toBe(true)
    let downloading: Promise<void> = Promise.resolve()
    act(() => { downloading = result.current.download() })
    act(() => emit({ received: 50, total: 200 }))
    expect(result.current.install).toEqual({ phase: 'downloading', progress: { received: 50, total: 200 } })
    await act(async () => { finish(); await downloading })
    expect(result.current.install.phase).toBe('ready')
    await act(async () => { await result.current.restart() })
    expect(applyUpdate).toHaveBeenCalled()
    expect(result.current.install.phase).toBe('restarting')
  })

  it('reports download errors without the IPC prefix', async () => {
    window.cyberGoose = {
      platform: 'win32', openExternal: vi.fn(),
      checkForUpdate: vi.fn().mockResolvedValue(info),
      downloadUpdate: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'cybergoose:download-update': Error: İndirilen güncelleme doğrulanamadı (SHA-256 uyuşmuyor)")),
      applyUpdate: vi.fn(),
    }
    const { result } = renderHook(() => useUpdateCheck(false))
    await act(async () => { await result.current.check(true) })
    await act(async () => { await result.current.download() })
    expect(result.current.install).toEqual({ phase: 'error', error: 'İndirilen güncelleme doğrulanamadı (SHA-256 uyuşmuyor)' })
  })

  it('renders install, progress, restart and fallback states', () => {
    const props = { info, onInstall: vi.fn(), onRestart: vi.fn(), onOpenPage: vi.fn() }
    const { rerender } = render(<UpdateActions {...props} canInstall install={{ phase: 'idle' }} />)
    fireEvent.click(screen.getByRole('button', { name: '1.1.0 sürümünü kur' }))
    expect(props.onInstall).toHaveBeenCalled()
    rerender(<UpdateActions {...props} canInstall install={{ phase: 'downloading', progress: { received: 1, total: 4 } }} />)
    expect(screen.getByText('%25')).toBeInTheDocument()
    rerender(<UpdateActions {...props} canInstall install={{ phase: 'ready' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden başlat ve güncelle' }))
    expect(props.onRestart).toHaveBeenCalled()
    rerender(<UpdateActions {...props} canInstall install={{ phase: 'error', error: 'olmadı' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('olmadı')
    fireEvent.click(screen.getByRole('button', { name: 'İndirme sayfası' }))
    expect(props.onOpenPage).toHaveBeenCalledWith(info.url)
    rerender(<UpdateActions {...props} canInstall={false} install={{ phase: 'idle' }} />)
    expect(screen.getByRole('button', { name: '1.1.0 sürümünü indir' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------- tarama: diyalog odak tuzağı

describe('Modal focus trap', () => {
  it('keeps Tab inside the dialog', async () => {
    const { Modal } = await import('../components/Modal')
    render(
      <>
        <button>Arkadaki</button>
        <Modal title="Deneme" onClose={vi.fn()} footer={<button>Tamam</button>}><input aria-label="Ad" /></Modal>
      </>,
    )
    const user = userEvent.setup()
    expect(screen.getByLabelText('Ad')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Tamam' })).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('Ad')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Tamam' })).toHaveFocus()
  })
})
