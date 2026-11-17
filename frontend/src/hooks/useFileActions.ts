import { useCallback } from 'react'
import { ApiError, api } from '../services/apiClient'
import type { FileEntry, PaneId } from '../types'
import type { ConfirmState, PromptState } from './useOverlays'

type UseFileActionsOptions = {
  localPath: string | null
  remotePath: string | null
  isConnected: boolean
  inspectedPath: string | null
  openConfirm: (confirm: ConfirmState) => void
  openPrompt: (prompt: PromptState) => void
  clearInspected: () => void
  setPaneSelection: (pane: PaneId, names: string[]) => void
  reloadPane: (pane: PaneId) => void
  /** Sol panelde uzak bağlantı açıksa onun oturumu: sol panel işlemleri bu sunucuya gider. */
  leftSessionId?: number | null
}

type Target = { side: 'local' | 'remote'; sessionId?: number }

function deleteTitle(entries: FileEntry[]) {
  if (entries.length > 1) return `${entries.length} öğeyi sil`
  return entries[0].kind === 'folder' ? 'Klasörü sil' : 'Dosyayı sil'
}

function subject(entries: FileEntry[]) {
  if (entries.length > 1) return `Seçili ${entries.length} öğe`
  const [single] = entries
  return single.kind === 'folder' ? `${single.name} klasörü ve içindeki her şey` : single.name
}

/**
 * Panel dosya eylemleri (sil, yeni klasör, yeniden adlandır, zip). Onay ve ad sorma
 * diyaloglarını açar; asıl işlem kullanıcı onaylayınca çalışır.
 *
 * Yerel silme varsayılan olarak Geri Dönüşüm Kutusu'na taşır. Shift+Delete ya da diyalogdaki
 * "Kalıcı olarak sil" doğrudan siler. Uzak sunucularda çöp kutusu olmadığından silme kalıcıdır.
 */
export function useFileActions(options: UseFileActionsOptions) {
  const { localPath, remotePath, isConnected, inspectedPath, openConfirm, openPrompt, clearInspected, setPaneSelection, reloadPane, leftSessionId } = options

  /** Panelin gerçek hedefi: sol panel uzak bağlantıdaysa yerel değil uzak işlem yapılır. */
  const targetOf = useCallback((pane: PaneId): Target => (
    pane === 'local' && leftSessionId != null ? { side: 'remote', sessionId: leftSessionId } : { side: pane }
  ), [leftSessionId])

  /** `done`: aynı diyalogda ilk deneme bazı öğeleri zaten silmiş olabilir; ikinci eylem onları atlar. */
  const removeEntries = useCallback(async (pane: PaneId, entries: FileEntry[], permanent: boolean, done: Set<string>) => {
    try {
      for (const item of entries) {
        if (done.has(item.path)) continue
        try {
          const target = targetOf(pane)
          if (target.sessionId !== undefined) await api.deleteEntry(target.side, item.path, permanent, target.sessionId)
          else await api.deleteEntry(target.side, item.path, permanent)
        } catch (error) {
          // Zaten yoksa (ör. önceki denemede taşındıysa) hedefe ulaşılmıştır.
          if (!(error instanceof ApiError && error.status === 404)) throw error
        }
        done.add(item.path)
        if (inspectedPath === item.path) clearInspected()
      }
    } finally {
      // Kısmen başarılı olsa bile listeyi tazele; silinmiş öğeler seçili kalmasın.
      setPaneSelection(pane, [])
      reloadPane(pane)
    }
  }, [clearInspected, inspectedPath, reloadPane, setPaneSelection, targetOf])

  const askDelete = useCallback((pane: PaneId, entries: FileEntry[], forcePermanent = false) => {
    if (!entries.length) return
    const remoteTarget = targetOf(pane).side === 'remote'
    const toTrash = !remoteTarget && !forcePermanent
    const what = subject(entries)
    const done = new Set<string>()
    if (toTrash) {
      openConfirm({
        title: deleteTitle(entries),
        message: `${what} Geri Dönüşüm Kutusu'na taşınacak. Gerekirse oradan geri alabilirsiniz.`,
        confirmLabel: "Geri Dönüşüm Kutusu'na taşı",
        tone: 'default',
        busyLabel: 'Taşınıyor',
        secondary: { label: 'Kalıcı olarak sil', action: () => removeEntries(pane, entries, true, done) },
        action: () => removeEntries(pane, entries, false, done),
      })
      return
    }
    openConfirm({
      title: deleteTitle(entries),
      message: remoteTarget
        ? `${what} sunucudan kalıcı olarak silinecek. Uzak sunucularda çöp kutusu yoktur; bu işlem geri alınamaz.`
        : `${what} kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmLabel: 'Kalıcı olarak sil',
      busyLabel: 'Siliniyor',
      action: () => removeEntries(pane, entries, true, done),
    })
  }, [openConfirm, removeEntries, targetOf])

  const askCreateFolder = useCallback((pane: PaneId) => {
    const parentPath = pane === 'local' ? localPath : (isConnected ? remotePath : null)
    if (!parentPath) return
    openPrompt({
      title: 'Yeni klasör',
      label: 'Klasör adı',
      confirmLabel: 'Oluştur',
      placeholder: 'Yeni klasör',
      action: async (name) => {
        const target = targetOf(pane)
        if (target.sessionId !== undefined) await api.mkdir(target.side, parentPath, name, target.sessionId)
        else await api.mkdir(target.side, parentPath, name)
        setPaneSelection(pane, [name])
        reloadPane(pane)
      },
    })
  }, [isConnected, localPath, openPrompt, reloadPane, remotePath, setPaneSelection, targetOf])

  const askRename = useCallback((pane: PaneId, entry: FileEntry) => {
    openPrompt({
      title: 'Yeniden adlandır',
      label: 'Yeni ad',
      initialValue: entry.name,
      confirmLabel: 'Kaydet',
      action: async (newName) => {
        if (newName === entry.name) return
        const target = targetOf(pane)
        if (target.sessionId !== undefined) await api.renameEntry(target.side, entry.path, newName, target.sessionId)
        else await api.renameEntry(target.side, entry.path, newName)
        setPaneSelection(pane, [newName])
        if (inspectedPath === entry.path) clearInspected()
        reloadPane(pane)
      },
    })
  }, [clearInspected, inspectedPath, openPrompt, reloadPane, setPaneSelection, targetOf])

  const askCreateZip = useCallback((entries: FileEntry[]) => {
    if (!localPath || !entries.length) return
    const parentDir = localPath
    openPrompt({
      title: 'Zip arşivi oluştur',
      label: 'Arşiv adı',
      initialValue: entries.length === 1 ? `${entries[0].name}.zip` : 'arsiv.zip',
      confirmLabel: 'Oluştur',
      action: async (archiveName) => {
        await api.createZip(parentDir, entries.map((item) => item.name), archiveName)
        reloadPane('local')
      },
    })
  }, [localPath, openPrompt, reloadPane])

  return { askDelete, askCreateFolder, askRename, askCreateZip }
}
