import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompareModal } from '../components/CompareModal'
import { FileTable, VIRTUAL_THRESHOLD } from '../components/FileTable'
import { api, type CompareResult } from '../services/apiClient'
import type { FileEntry, TransferItem } from '../types'
import { batchProgress, useTaskbarProgress } from '../hooks/useTaskbarProgress'
import { joinRelative } from '../utils/compare'

afterEach(() => vi.restoreAllMocks())

function makeEntries(count: number): FileEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `dosya-${String(i).padStart(5, '0')}.txt`,
    path: `/k/dosya-${String(i).padStart(5, '0')}.txt`,
    kind: 'file' as const,
    size: i,
    modified: '2024-01-01T00:00:00',
    source: 'local' as const,
  }))
}

describe('Büyük klasörlerde sanal liste', () => {
  it('eşiğin altında tüm satırları çizer', () => {
    render(<FileTable label="Dosyalar" entries={makeEntries(50)} selected={[]} onSelect={vi.fn()} onOpen={vi.fn()} />)
    expect(document.querySelectorAll('tr[data-entry]')).toHaveLength(50)
  })

  it('10 000 dosyada yalnızca görünen pencereyi çizer ve kaydırınca pencere kayar', () => {
    const entries = makeEntries(10_000)
    render(<FileTable label="Dosyalar" entries={entries} selected={[]} onSelect={vi.fn()} onOpen={vi.fn()} />)
    const rows = document.querySelectorAll('tr[data-entry]')
    expect(rows.length).toBeGreaterThan(10)
    expect(rows.length).toBeLessThan(VIRTUAL_THRESHOLD)
    expect(screen.getByText('dosya-00000.txt')).toBeInTheDocument()
    expect(screen.queryByText('dosya-05000.txt')).not.toBeInTheDocument()
    // Boşluk satırı toplam yüksekliği korur.
    const spacer = document.querySelector<HTMLElement>('tr.cg-spacer')
    expect(parseInt(spacer!.style.height, 10)).toBeGreaterThan(9000 * 28)

    const scroller = document.querySelector<HTMLElement>('.cg-list-scroll')!
    act(() => {
      scroller.scrollTop = 5000 * 28
      fireEvent.scroll(scroller)
    })
    expect(screen.getByText('dosya-05000.txt')).toBeInTheDocument()
    expect(screen.queryByText('dosya-00000.txt')).not.toBeInTheDocument()
  })

  it('ok tuşuyla pencerenin dışına inildiğinde satır çizilip odaklanır', () => {
    const entries = makeEntries(2000)
    function Harness() {
      const [selected, setSelected] = useState<string[]>([])
      return <FileTable label="Dosyalar" entries={entries} selected={selected} onSelect={setSelected} onOpen={vi.fn()} />
    }
    render(<Harness />)
    const rendered = document.querySelectorAll<HTMLElement>('tr[data-entry]')
    const last = rendered[rendered.length - 1]
    const lastIndex = Number(last.dataset.index)
    fireEvent.click(last)
    fireEvent.keyDown(last, { key: 'ArrowDown' })
    const target = document.querySelector<HTMLElement>(`tr[data-index="${lastIndex + 1}"]`)
    expect(target).not.toBeNull()
    expect(document.activeElement).toBe(target)
    expect(target).toHaveAttribute('aria-selected', 'true')
  })

  it('Ctrl+A tüm dosyaları seçer, yalnızca çizilenleri değil', () => {
    const onSelect = vi.fn()
    render(<FileTable label="Dosyalar" entries={makeEntries(1000)} selected={[]} onSelect={onSelect} onOpen={vi.fn()} />)
    fireEvent.keyDown(document.querySelector('tr[data-entry]')!, { key: 'a', ctrlKey: true })
    expect(onSelect.mock.calls[0][0]).toHaveLength(1000)
  })
})

describe('Karşılaştırma: kayıtlı saat farkı ve fazla dosyaları silme', () => {
  const compareResult: CompareResult = {
    localPath: 'C:\\site',
    remotePath: '/www',
    summary: { onlyLocal: 1, onlyRemote: 1, different: 1, same: 0 },
    items: [
      { relativeDir: '', name: 'index.html', status: 'different', localSize: 10, remoteSize: 8, localModified: null, remoteModified: null, newer: 'local' },
      { relativeDir: 'css', name: 'yeni.css', status: 'onlyLocal', localSize: 5, remoteSize: null, localModified: null, remoteModified: null, newer: null },
      { relativeDir: 'eski', name: 'kalinti.txt', status: 'onlyRemote', localSize: null, remoteSize: 3, localModified: null, remoteModified: null, newer: null },
    ],
  }

  it('kayıtlı saat farkıyla açılır ve değişikliği kaydeder', async () => {
    const user = userEvent.setup()
    const compare = vi.spyOn(api, 'compareFolders').mockResolvedValue(compareResult)
    const onSaveOffset = vi.fn().mockResolvedValue(undefined)
    render(<CompareModal localPath={'C:\\site'} remotePath="/www" sessionId={3} savedOffset={180} onSaveOffset={onSaveOffset} onSync={vi.fn()} onClose={vi.fn()} />)
    await screen.findByLabelText('Karşılaştırma özeti')
    expect(compare).toHaveBeenCalledWith('C:\\site', '/www', 3, { timeOffsetMinutes: 180 })
    expect(screen.getByLabelText('Sunucu saat farkı')).toHaveValue('180')

    await user.selectOptions(screen.getByLabelText('Sunucu saat farkı'), '-120')
    expect(onSaveOffset).toHaveBeenCalledWith(-120)
    expect(await screen.findByText('Bu sunucu için hatırlanacak.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Sunucu saat farkı'), 'auto')
    expect(onSaveOffset).toHaveBeenLastCalledWith(null)
  })

  it('fazla dosyaları yalnızca onaydan sonra siler', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'compareFolders').mockResolvedValue(compareResult)
    const onSync = vi.fn().mockResolvedValue(2)
    const onDeleteExtras = vi.fn().mockResolvedValue(1)
    render(<CompareModal localPath={'C:\\site'} remotePath="/www" sessionId={3} onDeleteExtras={onDeleteExtras} onSync={onSync} onClose={vi.fn()} />)
    await screen.findByLabelText('Karşılaştırma özeti')
    // Seçenek kapalıyken fazla dosya silinmez.
    expect(screen.getByRole('button', { name: 'Yerelden sunucuya eşitle (2)' })).toBeEnabled()

    await user.click(screen.getByLabelText('Eşitlerken hedefte fazla olan seçili dosyaları sil'))
    await user.click(screen.getByRole('button', { name: 'Yerelden sunucuya eşitle (2, 1 silme)' }))
    expect(onSync).not.toHaveBeenCalled()
    expect(screen.getByText('1 dosya sunucuda kalıcı olarak silinecek.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sil ve eşitle' }))
    expect(onSync).toHaveBeenCalledWith([compareResult.items[0], compareResult.items[1]], 'upload')
    expect(onDeleteExtras).toHaveBeenCalledWith([compareResult.items[2]], 'right')
    expect(await screen.findByText('2 dosya kuyruğa eklendi. 1 fazla dosya silindi.')).toBeInTheDocument()
    expect(screen.queryByText('eski/kalinti.txt')).not.toBeInTheDocument()
  })

  it('yerel fazla dosyalar için Geri Dönüşüm Kutusu uyarısı gösterir', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'compareFolders').mockResolvedValue(compareResult)
    render(<CompareModal localPath={'C:\\site'} remotePath="/www" sessionId={3} onDeleteExtras={vi.fn()} onSync={vi.fn()} onClose={vi.fn()} />)
    await screen.findByLabelText('Karşılaştırma özeti')
    await user.click(screen.getByLabelText('Eşitlerken hedefte fazla olan seçili dosyaları sil'))
    await user.click(screen.getByRole('button', { name: 'Sunucudan yerele eşitle (2, 1 silme)' }))
    expect(screen.getByText("1 dosya yerelde Geri Dönüşüm Kutusu'na taşınacak.")).toBeInTheDocument()
  })

  it('satır yollarını taraf ayıracıyla birleştirir', () => {
    expect(joinRelative('C:\\site', 'css/alt', 'a.css')).toBe('C:\\site\\css\\alt\\a.css')
    expect(joinRelative('C:\\', '', 'a.txt')).toBe('C:\\a.txt')
    expect(joinRelative('/www/', 'css', 'a.css')).toBe('/www/css/a.css')
    expect(joinRelative('/', '', 'a.txt')).toBe('/a.txt')
  })
})

describe('Görev çubuğu ilerlemesi', () => {
  const item = (id: string, status: TransferItem['status'], size: number | null, transferred = 0): TransferItem => ({
    id, name: id, direction: 'upload', localDir: 'C:/', remoteDir: '/', sessionId: 1, from: '', to: '', size, status, transferred,
  })

  it('bayt oranını hesaplar, hata varsa kırmızı gösterir', () => {
    expect(batchProgress([item('a', 'completed', 300), item('b', 'transferring', 100, 50)])).toEqual({ fraction: 350 / 400, mode: 'normal' })
    expect(batchProgress([item('a', 'error', 100), item('b', 'queued', 100)])).toEqual({ fraction: 0.5, mode: 'error' })
    expect(batchProgress([item('a', 'completed', null), item('b', 'queued', 10)])?.fraction).toBe(0.5)
    expect(batchProgress([item('a', 'cancelled', 10)])).toBeNull()
  })

  it('kuyruk çalışırken ilerlemeyi gönderir ve bitince çubuğu kaldırır', () => {
    const send = vi.fn()
    window.cyberGoose = { ...(window.cyberGoose ?? {}), setTaskbarProgress: send } as typeof window.cyberGoose
    function Harness({ transfers }: { transfers: TransferItem[] }) {
      useTaskbarProgress(transfers)
      return null
    }
    const { rerender } = render(<Harness transfers={[item('a', 'transferring', 100, 25), item('b', 'queued', 100)]} />)
    expect(send).toHaveBeenLastCalledWith(0.125, 'normal')
    rerender(<Harness transfers={[item('a', 'completed', 100, 100), item('b', 'transferring', 100, 50)]} />)
    expect(send).toHaveBeenLastCalledWith(0.75, 'normal')
    rerender(<Harness transfers={[item('a', 'completed', 100, 100), item('b', 'completed', 100, 100)]} />)
    expect(send).toHaveBeenLastCalledWith(null, undefined)
    // Yeni grup eskisinden bağımsız başlar.
    rerender(<Harness transfers={[item('a', 'completed', 100, 100), item('b', 'completed', 100, 100), item('c', 'queued', 100)]} />)
    expect(send).toHaveBeenLastCalledWith(0, 'normal')
    delete (window.cyberGoose as { setTaskbarProgress?: unknown }).setTaskbarProgress
  })
})
