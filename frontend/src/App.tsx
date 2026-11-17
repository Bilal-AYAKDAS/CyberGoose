import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import './styles/app.css'
import { StatusBar, TitleBar, Toolbar } from './components/AppChrome'
import { BookmarksPanel } from './components/BookmarksPanel'
import { ChunkBoundary } from './components/ChunkBoundary'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ConnectionModal } from './components/ConnectionModal'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { FileInspector } from './components/FileInspector'
import { FileManagerView } from './components/FileManagerView'
import { LeftSourcePicker } from './components/LeftSourcePicker'
import { Icon } from './components/Icon'
import { Notice } from './components/Notice'
import { PromptDialog } from './components/PromptDialog'
import { QuickConnectBar } from './components/QuickConnectBar'
import { Sidebar } from './components/Sidebar'
import { TransferQueue } from './components/TransferQueue'
import { useBookmarks } from './hooks/useBookmarks'
import { QUICK_ID, toProfile, useConnections } from './hooks/useConnections'
import { useDirectory } from './hooks/useDirectory'
import { useExternalEdits } from './hooks/useExternalEdits'
import { ExternalEditsPanel } from './components/ExternalEditsPanel'
import { useFileActions } from './hooks/useFileActions'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useOverlays, type ConfirmState, type PromptState } from './hooks/useOverlays'
import { useSettings } from './hooks/useSettings'
import { useTheme } from './hooks/useTheme'
import { useUpdateCheck } from './hooks/useUpdateCheck'
import { useTransferQueue } from './hooks/useTransferQueue'
import { ApiError, api, hostKeyOf, type HostKeyInfo } from './services/apiClient'
import { connectionLabel } from './utils/formatters'
import type { ConnectionProfile, FileEntry, FolderBookmark, PaneId } from './types'

// Seyrek açılan katmanlar ayrı parçalara bölünür: açılış paketi küçülür (xterm.js yalnızca
// terminal açılınca yüklenir).
const TerminalDrawer = lazy(() => import('./components/TerminalDrawer').then((m) => ({ default: m.TerminalDrawer })))
const RemoteEditorModal = lazy(() => import('./components/RemoteEditorModal').then((m) => ({ default: m.RemoteEditorModal })))
const SheetEditorModal = lazy(() => import('./components/SheetEditorModal').then((m) => ({ default: m.SheetEditorModal })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const TunnelModal = lazy(() => import('./components/TunnelModal').then((m) => ({ default: m.TunnelModal })))
const SearchModal = lazy(() => import('./components/SearchModal').then((m) => ({ default: m.SearchModal })))
const CompareModal = lazy(() => import('./components/CompareModal').then((m) => ({ default: m.CompareModal })))
const RemoteAccessModal = lazy(() => import('./components/RemoteAccessModal').then((m) => ({ default: m.RemoteAccessModal })))

type PaneNotice = { tone: 'warn' | 'error'; title: string } | null

function matches(entry: FileEntry, query: string) {
  return entry.name.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Dosya seçimine etki eden kısayollar yalnızca panellerden ya da araç çubuğundan gelirse çalışır. */
function fromWorkspace(target: EventTarget | null) {
  if (!(target instanceof Element) || target === document.body) return true
  return Boolean(target.closest('.cg-pane, .cg-toolbar'))
}

/**
 * Uygulama penceresi (tasarımdaki AppWindow):
 * başlık 36 · araç çubuğu 40 · [kenar çubuğu 220 | panel | 1px | panel] · transfer kuyruğu · durum 24.
 * Durum mantığı özel hook'lara ayrılmıştır: bağlantılar (useConnections), aktarımlar
 * (useTransferQueue), dosya eylemleri (useFileActions) ve tüm diyalog/menü katmanları (useOverlays).
 */
function App({ onReady }: { onReady?: () => void }) {
  const { theme, preference: themePreference, setPreference: setThemePreference, toggleTheme } = useTheme()
  const { settings, setSettings } = useSettings()
  const updates = useUpdateCheck(settings.checkUpdates)
  const { overlays, set: setOverlay, toggle: toggleOverlay, blocking } = useOverlays()

  // ---------------------------------------------------------------- paneller
  const [homePath, setHomePath] = useState<string | null>(null)
  const [drives, setDrives] = useState<string[]>([])
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [remotePath, setRemotePath] = useState('/')
  /** Sol panelde açık ikinci uzak bağlantı (uzaktan uzağa aktarım); null ise sol panel yereldir. */
  const [leftRemote, setLeftRemote] = useState<{ connection: ConnectionProfile; sessionId: number } | null>(null)
  const [leftRemotePath, setLeftRemotePath] = useState('/')
  const [leftConnecting, setLeftConnecting] = useState<string | null>(null)
  const leftSessionId = leftRemote?.sessionId ?? null
  const [focusedPane, setFocusedPane] = useState<PaneId>('local')
  const [selection, setSelection] = useState<Record<PaneId, string[]>>({ local: [], remote: [] })
  const [query, setQuery] = useState('')
  const [editSignal, setEditSignal] = useState<Record<PaneId, number>>({ local: 0, remote: 0 })
  const [remoteNotice, setRemoteNotice] = useState<PaneNotice>(null)
  const openDownload = useCallback((url: string) => {
    window.cyberGoose?.openExternal(url).catch((error: unknown) => {
      setRemoteNotice({ tone: 'error', title: error instanceof Error ? error.message : 'İndirme sayfası açılamadı' })
    })
  }, [])

  const openConfirm = useCallback((confirm: ConfirmState) => setOverlay({ confirm }), [setOverlay])
  const openPrompt = useCallback((prompt: PromptState) => setOverlay({ prompt }), [setOverlay])

  const focusPane = useCallback((pane: PaneId) => {
    setFocusedPane((current) => {
      if (current !== pane) setQuery('')
      return pane
    })
  }, [])

  const navigate = useCallback((pane: PaneId, path: string) => {
    setSelection((current) => ({ ...current, [pane]: [] }))
    setQuery('')
    if (pane === 'local') {
      if (leftSessionId !== null) setLeftRemotePath(path)
      else setLocalPath(path)
    } else setRemotePath(path)
  }, [leftSessionId])

  const setPaneSelection = useCallback((pane: PaneId, names: string[]) => {
    setSelection((current) => ({ ...current, [pane]: names }))
  }, [])

  // ---------------------------------------------------------------- bağlantılar
  const handleConnected = useCallback((startPath: string) => {
    setRemotePath(startPath)
    setSelection((current) => ({ ...current, remote: [] }))
    focusPane('remote')
  }, [focusPane])

  const handleDisconnected = useCallback(() => {
    setSelection((current) => ({ ...current, remote: [] }))
    focusPane('local')
  }, [focusPane])

  const handleNeedPassword = useCallback((connection: ConnectionProfile) => {
    setOverlay({ connectionDialog: { initial: connection } })
  }, [setOverlay])

  /** Kenar çubuğundan açılan SFTP sunucusu ilk kez görülüyor: parmak izini onaylat. */
  const handleHostKey = useCallback((info: HostKeyInfo, trust: () => Promise<void>) => {
    setOverlay({
      confirm: {
        title: 'Sunucu anahtarını doğrulayın',
        message: (
          <>
            <p>{info.host} sunucusuna ilk kez bağlanıyorsunuz. Bu parmak izini sunucu yöneticisinden aldığınız değerle karşılaştırın.</p>
            <code className="cg-fingerprint">{info.type} {info.fingerprint}</code>
            <p>Onaylarsanız anahtar kaydedilir ve sonraki bağlantılarda değişirse uyarılırsınız.</p>
          </>
        ),
        confirmLabel: 'Güven ve bağlan',
        busyLabel: 'Bağlanıyor',
        tone: 'default',
        action: trust,
      },
    })
  }, [setOverlay])

  const {
    connections,
    connectionsError,
    activeId,
    activeConnection,
    activeStatus,
    isConnected,
    sessionId,
    statusOf,
    setSavedConnections,
    setConnectionsError,
    setActiveId,
    setConnectedId,
    setSessionId,
    loadConnections,
    openConnection,
    disconnect,
    saveFromDialog,
    connectFromDialog,
    quickConnect,
    dropOrphanQuickSession,
  } = useConnections({
    onConnected: handleConnected,
    onDisconnected: handleDisconnected,
    onNeedPassword: handleNeedPassword,
    onNotice: setRemoteNotice,
    onHostKey: handleHostKey,
  })

  // ---------------------------------------------------------------- klasörler ve seçimler
  const local = useDirectory(
    leftRemote ? 'remote' : 'local',
    leftRemote ? leftRemotePath : localPath,
    true,
    leftRemote ? `side-${leftRemote.sessionId}` : undefined,
    leftRemote?.sessionId,
  )
  /** Gerçek yerel klasör: sol panel uzak bağlantıdayken yok. */
  const localDir = leftRemote ? null : local.path
  const remote = useDirectory('remote', remotePath, isConnected, sessionId)
  const { showHidden } = settings

  const visibleEntries = useCallback((pane: PaneId, entries: FileEntry[]) => {
    const shown = showHidden ? entries : entries.filter((entry) => !entry.hidden)
    return focusedPane === pane && query ? shown.filter((entry) => matches(entry, query)) : shown
  }, [focusedPane, query, showHidden])
  const visibleLocal = useMemo(() => visibleEntries('local', local.entries), [visibleEntries, local.entries])
  const visibleRemote = useMemo(() => visibleEntries('remote', remote.entries), [visibleEntries, remote.entries])

  // Seçim yalnızca görünen öğelerden oluşur: gizlenen dosya yanlışlıkla silinmez ya da aktarılmaz.
  const selectedLocalEntries = useMemo(() => visibleLocal.filter((entry) => selection.local.includes(entry.name)), [visibleLocal, selection.local])
  const selectedRemoteEntries = useMemo(() => isConnected ? visibleRemote.filter((entry) => selection.remote.includes(entry.name)) : [], [isConnected, visibleRemote, selection.remote])
  const focusedSelections = focusedPane === 'local' ? selectedLocalEntries : selectedRemoteEntries
  const focusedSelection = focusedSelections.at(-1) ?? null
  const focusedDir = focusedPane === 'local' ? local : remote

  const selectedFilesSize = useMemo(() => {
    const files = focusedSelections.filter((entry) => entry.kind === 'file')
    return files.length ? files.reduce((sum, entry) => sum + (entry.size ?? 0), 0) : null
  }, [focusedSelections])

  // ---------------------------------------------------------------- ilk yükleme
  const readySent = useRef(false)
  useEffect(() => {
    let active = true
    Promise.allSettled([
      api.listConnections()
        .then((items) => { if (active) { setSavedConnections(items.map(toProfile)); setConnectionsError(null) } })
        .catch((error) => { if (active) setConnectionsError(messageOf(error, 'Kayıtlı bağlantılar yüklenemedi')) }),
      api.localHome().then(({ path }) => { if (active) setHomePath(path) }),
      api.localDrives?.().then(({ drives: found }) => { if (active) setDrives(found) }).catch(() => undefined),
      api.session().then((session) => {
        if (active && session.connected && session.connectionId === QUICK_ID) {
          // Hızlı bağlantının adresi saklanmaz; pencere yeniden yüklendiyse oturumu kapat.
          dropOrphanQuickSession()
        } else if (active && session.connected && session.connectionId) {
          setConnectedId(session.connectionId)
          setActiveId(session.connectionId)
          setSessionId(session.sessionId ?? null)
        }
      }),
    ]).finally(() => {
      if (!readySent.current) {
        readySent.current = true
        onReady?.()
      }
    })
    return () => { active = false }
  }, [dropOrphanQuickSession, onReady, setActiveId, setConnectedId, setConnectionsError, setSavedConnections, setSessionId])

  // ---------------------------------------------------------------- yer imleri ve transferler
  const { bookmarks, bookmarksError, bookmarksOpen, setBookmarksOpen, addBookmark, deleteBookmark } = useBookmarks()
  const { transfers, queueOpen, activeTransfer, activeCount, setQueueOpen, enqueueMany, enqueueFolders, enqueueRelative, enqueueCopy, cancelTransfer, retryTransfer, retryAll, resolveConflicts, removeTransfer, clearFinished } = useTransferQueue({
    localPath: localDir,
    remotePath,
    activeConnection: isConnected ? activeConnection : null,
    sessionId,
    overwriteDefault: settings.overwriteDefault,
    notifications: settings.notifications,
    maxParallel: settings.maxParallel,
    reloadLocal: local.reload,
    reloadRemote: remote.reload,
  })

  const enqueueSelected = useCallback(async (entries: FileEntry[], direction: 'upload' | 'download') => {
    if (leftRemote) {
      // Sol panel uzak bağlantıda: iki sunucu arasında kopya (upload: sol → sağ, download: sağ → sol).
      if (!entries.length) return
      if (sessionId === null || !activeConnection || !remote.path || !local.path) {
        setRemoteNotice({ tone: 'warn', title: 'Uzaktan uzağa aktarım için sağ panelde de bir bağlantı açın.' })
        return
      }
      const left = { dir: local.path, sessionId: leftRemote.sessionId, label: connectionLabel(leftRemote.connection), pane: 'local' as const }
      const right = { dir: remote.path, sessionId, label: connectionLabel(activeConnection), pane: 'remote' as const }
      try {
        if (direction === 'upload') await enqueueCopy(entries, left, right)
        else await enqueueCopy(entries, right, left)
      } catch (error) {
        setRemoteNotice({ tone: 'error', title: messageOf(error, 'Aktarıma eklenemedi') })
      }
      return
    }
    const filesOnly = entries.filter((entry) => entry.kind === 'file')
    const foldersOnly = entries.filter((entry) => entry.kind === 'folder')
    if (filesOnly.length) enqueueMany(filesOnly, direction)
    if (!foldersOnly.length) return
    try {
      await enqueueFolders(foldersOnly, direction)
    } catch (error) {
      setRemoteNotice({ tone: 'error', title: messageOf(error, 'Klasör aktarıma eklenemedi') })
    }
  }, [activeConnection, enqueueCopy, enqueueFolders, enqueueMany, leftRemote, local.path, remote.path, sessionId])

  /** Windows Gezgini'nden uzak panele bırakılan yollar: her birini yerelde sorgulayıp kuyruğa ekler. */
  const enqueueExternal = useCallback(async (paths: string[]) => {
    const results = await Promise.allSettled(paths.map((path) => api.localStat(path)))
    const entries: FileEntry[] = results.flatMap((result) => result.status === 'fulfilled'
      ? [{ name: result.value.name, path: result.value.path, kind: result.value.kind, size: result.value.size, modified: result.value.modified, source: 'local' as const }]
      : [])
    const failed = results.length - entries.length
    if (failed) setRemoteNotice({ tone: 'warn', title: `${failed} öğe okunamadığı için kuyruğa eklenmedi.` })
    if (entries.length) await enqueueSelected(entries, 'upload')
  }, [enqueueSelected])

  const currentFolder = focusedPane === 'local'
    ? (localDir ? { label: local.crumbs.at(-1)?.name || localDir, path: localDir, connectionId: null } : null)
    : (isConnected && remote.path && activeConnection?.saved ? { label: remote.crumbs.at(-1)?.name === '/' ? activeConnection.name : remote.crumbs.at(-1)?.name ?? remote.path, path: remote.path, connectionId: activeConnection.id } : null)

  // ---------------------------------------------------------------- FileZilla içe aktarma
  const importFileZilla = useCallback(async (xml: string) => {
    try {
      const outcome = await api.importFileZilla(xml)
      await loadConnections()
      const parts = [`${outcome.imported} bağlantı içe aktarıldı.`]
      if (outcome.skipped.length) parts.push(`${outcome.skipped.length} tanesi zaten kayıtlıydı.`)
      if (outcome.warnings.length) parts.push(outcome.warnings.join(' '))
      setRemoteNotice({ tone: 'warn', title: parts.join(' ') })
    } catch (error) {
      setRemoteNotice({ tone: 'error', title: messageOf(error, 'FileZilla dosyası içe aktarılamadı') })
    }
  }, [loadConnections])

  // ---------------------------------------------------------------- sol panel kaynağı (uzaktan uzağa)
  const switchLeftSource = useCallback(async (value: string) => {
    const previous = leftRemote
    if (value === 'local') {
      setLeftRemote(null)
      setSelection((current) => ({ ...current, local: [] }))
      if (previous) await api.disconnectSide(previous.sessionId).catch(() => undefined)
      return
    }
    const connection = connections.find((item) => item.id === value)
    if (!connection) return
    const attempt = async (trustHostKey?: string) => {
      setLeftConnecting(connection.id)
      try {
        const opened = await api.connectSide({
          type: connection.type,
          connectionId: connection.saved ? connection.id : undefined,
          clientId: connection.id,
          trustHostKey,
        })
        if (previous) await api.disconnectSide(previous.sessionId).catch(() => undefined)
        setLeftRemote({ connection, sessionId: opened.sessionId })
        setLeftRemotePath('/')
        setSelection((current) => ({ ...current, local: [] }))
        focusPane('local')
      } catch (error) {
        const hostKey = hostKeyOf(error)
        if (hostKey && !trustHostKey) {
          handleHostKey(hostKey, () => attempt(hostKey.fingerprint))
          return
        }
        const hint = error instanceof ApiError && (error.code === 'password_required' || error.code === 'key_passphrase_required')
          ? ' Parolayı kaydedin ya da önce sağ panelden bağlanın.'
          : ''
        setRemoteNotice({ tone: 'error', title: `${connection.name} sol panelde açılamadı: ${messageOf(error, 'Bağlantı kurulamadı')}${hint}` })
      } finally {
        setLeftConnecting(null)
      }
    }
    await attempt()
  }, [connections, focusPane, handleHostKey, leftRemote])

  // ---------------------------------------------------------------- yerel dosyayı aç / göster / arşivi çıkar
  const openLocalPath = useCallback(async (path: string) => {
    try {
      await window.cyberGoose?.openPath?.(path)
    } catch (error) {
      setRemoteNotice({ tone: 'error', title: messageOf(error, 'Dosya açılamadı') })
    }
  }, [])

  const showInFolder = useCallback(async (path: string) => {
    try {
      await window.cyberGoose?.showItemInFolder?.(path)
    } catch (error) {
      setRemoteNotice({ tone: 'error', title: messageOf(error, "Gezgin'de gösterilemedi") })
    }
  }, [])

  const extractZip = useCallback(async (path: string) => {
    try {
      const extracted = await api.extractZip(path)
      local.reload()
      const skipped = extracted.skipped ? ` Güvenli olmayan ${extracted.skipped} öğe atlandı.` : ''
      setRemoteNotice({ tone: 'warn', title: `${extracted.files} dosya "${extracted.name}" klasörüne çıkarıldı.${skipped}` })
    } catch (error) {
      setRemoteNotice({ tone: 'error', title: messageOf(error, 'Arşiv açılamadı') })
    }
  }, [local])

  // ---------------------------------------------------------------- harici düzenleyici
  const showEditError = useCallback((message: string) => setRemoteNotice({ tone: 'error', title: message }), [])
  const externalEdits = useExternalEdits(showEditError)
  const [editsOpen, setEditsOpen] = useState(false)

  // ---------------------------------------------------------------- dosya eylemleri
  const reloadPane = useCallback((pane: PaneId) => {
    if (pane === 'local') local.reload()
    else remote.reload()
  }, [local, remote])

  const { askDelete, askCreateFolder, askRename, askCreateZip } = useFileActions({
    localPath: local.path,
    leftSessionId,
    remotePath: remote.path,
    isConnected,
    inspectedPath: overlays.inspected?.path ?? null,
    openConfirm,
    openPrompt,
    clearInspected: useCallback(() => setOverlay({ inspected: null }), [setOverlay]),
    setPaneSelection,
    reloadPane,
  })

  /** Sol paneldeki uzak dosyanın detayları sağ oturumdan okunamaz; yalnızca klasörler açılır. */
  const inspectable = (pane: PaneId) => !(pane === 'local' && leftRemote)

  const openEntry = (pane: PaneId, entry: FileEntry) => {
    if (entry.kind === 'folder') navigate(pane, entry.path)
    else if (inspectable(pane)) setOverlay({ inspected: entry })
  }

  const canUpload = Boolean(selectedLocalEntries.length > 0 && isConnected && remote.path)
  const canDownload = Boolean(selectedRemoteEntries.length > 0 && local.path)
  const canCreateFolder = Boolean(focusedPane === 'local' ? local.path : (isConnected && remote.path))
  const toggleHidden = () => setSettings({ ...settings, showHidden: !settings.showHidden })

  // ---------------------------------------------------------------- menüler
  const openMenu = (event: MouseEvent, items: MenuItem[]) => setOverlay({ menu: { x: event.clientX, y: event.clientY, items } })

  const fileMenu = (pane: PaneId, entry: FileEntry, event: MouseEvent) => {
    const paneSelections = pane === 'local' ? selectedLocalEntries : selectedRemoteEntries
    const targets = paneSelections.some((item) => item.name === entry.name) ? paneSelections : [entry]
    const count = targets.length > 1 ? ` (${targets.length})` : ''
    const transferItem: MenuItem = leftRemote
      ? (pane === 'local'
        ? { label: `Sağ panele kopyala${count}`, onSelect: () => { void enqueueSelected(targets, 'upload') }, disabled: !isConnected, hint: 'Ctrl+U' }
        : { label: `Sol panele kopyala${count}`, onSelect: () => { void enqueueSelected(targets, 'download') }, hint: 'Ctrl+D' })
      : pane === 'local'
        ? { label: targets.length > 1 ? `Yükle (${targets.length})` : entry.kind === 'folder' ? 'Klasörü yükle' : 'Yükle', onSelect: () => { void enqueueSelected(targets, 'upload') }, disabled: !isConnected, hint: 'Ctrl+U' }
        : { label: targets.length > 1 ? `İndir (${targets.length})` : entry.kind === 'folder' ? 'Klasörü indir' : 'İndir', onSelect: () => { void enqueueSelected(targets, 'download') }, hint: 'Ctrl+D' }
    const leftIsRemote = pane === 'local' && Boolean(leftRemote)
    const zipItem: MenuItem[] = pane === 'local' && !leftIsRemote ? [{ label: targets.length > 1 ? `Zip arşivi oluştur (${targets.length})` : 'Zip arşivi oluştur', onSelect: () => askCreateZip(targets) }] : []
    const deleteLabel = pane === 'local' && !leftIsRemote ? "Geri Dönüşüm Kutusu'na taşı" : 'Sil'
    const items: MenuItem[] = targets.length > 1
      ? [
        transferItem,
        ...zipItem,
        { label: `${deleteLabel} (${targets.length})`, onSelect: () => askDelete(pane, targets), danger: true, hint: 'Del' },
      ]
      : [
        ...(entry.kind === 'folder'
          ? [{ label: 'Aç', onSelect: () => navigate(pane, entry.path), hint: 'Enter' }]
          : leftIsRemote ? [] : [{ label: 'Detaylar', onSelect: () => setOverlay({ inspected: entry }), hint: 'Enter' }]),
        ...(() => {
          // Sol paneldeki uzak bağlantıda düzenleyiciler ve yerel eylemler yok (yalnızca kopya, ad, sil).
          if (entry.kind !== 'file' || leftIsRemote) return []
          const lower = entry.name.toLowerCase()
          const isXlsx = lower.endsWith('.xlsx')
          const isCsv = lower.endsWith('.csv')
          const editItems: MenuItem[] = []
          if (isXlsx || isCsv) {
            editItems.push({ label: 'Tablo olarak düzenle', onSelect: () => setOverlay({ editing: { entry, side: pane, mode: 'sheet' } }) })
          }
          if (!isXlsx) {
            editItems.push({ label: 'Metin olarak düzenle', onSelect: () => setOverlay({ editing: { entry, side: pane, mode: 'text' } }) })
          }
          if (pane === 'local') {
            const desktop = window.cyberGoose
            if (desktop?.openPath) {
              editItems.push({ label: 'Varsayılan uygulamayla aç', onSelect: () => { void openLocalPath(entry.path) } })
            }
            if (desktop?.showItemInFolder) {
              editItems.push({ label: "Gezgin'de göster", onSelect: () => { void showInFolder(entry.path) } })
            }
            if (lower.endsWith('.zip')) {
              editItems.push({ label: 'Buraya çıkar', onSelect: () => { void extractZip(entry.path) } })
            }
          }
          if (pane === 'remote') {
            editItems.push({
              label: 'Düzenleyicide aç (kaydedince yüklenir)',
              onSelect: () => {
                setEditsOpen(true)
                void externalEdits.open(entry.path, sessionId)
              },
            })
          }
          return editItems
        })(),
        transferItem,
        ...zipItem,
        { label: 'Yeniden adlandır', onSelect: () => askRename(pane, entry), hint: 'F2' },
        { label: 'Yolu kopyala', onSelect: () => { void navigator.clipboard?.writeText(entry.path) } },
        { label: deleteLabel, onSelect: () => askDelete(pane, [entry]), danger: true, hint: 'Del' },
      ]
    openMenu(event, items)
  }

  const backgroundMenu = (pane: PaneId, event: MouseEvent) => {
    const canCreate = Boolean(pane === 'local' ? local.path : (isConnected && remote.path))
    if (!canCreate) return
    openMenu(event, [
      { label: 'Yeni klasör', onSelect: () => askCreateFolder(pane), hint: 'Ctrl+Shift+N' },
      { label: 'Yenile', onSelect: () => reloadPane(pane), hint: 'F5' },
      { label: settings.showHidden ? 'Gizli dosyaları sakla' : 'Gizli dosyaları göster', onSelect: toggleHidden, hint: 'Ctrl+H' },
    ])
  }

  const connectionMenu = (connection: ConnectionProfile, event: MouseEvent) => {
    const connected = statusOf(connection.id) === 'connected'
    const items: MenuItem[] = [
      connected
        ? { label: 'Bağlantıyı kes', onSelect: () => { void disconnect() } }
        : { label: 'Bağlan', onSelect: () => { void openConnection(connection) } },
    ]
    if (connection.saved) {
      if (window.cyberGoose?.launchRdp) {
        items.push({
          label: 'Uzak Masaüstü (RDP)',
          onSelect: () => {
            void window.cyberGoose?.launchRdp?.(connection.host)?.catch((error) => {
              setRemoteNotice({ tone: 'error', title: messageOf(error, 'Uzak Masaüstü başlatılamadı') })
            })
          },
        })
      }
      items.push(
        { label: 'Düzenle', onSelect: () => setOverlay({ connectionDialog: { initial: connection } }) },
        { label: 'Adresi kopyala', onSelect: () => { void navigator.clipboard?.writeText(`${connection.username ? `${connection.username}@` : ''}${connection.host}:${connection.port}`) } },
        {
          label: 'Sil',
          danger: true,
          onSelect: () => openConfirm({
            title: 'Bağlantıyı sil',
            message: `${connection.name} kayıtlı bağlantılardan ve yer imlerinden silinecek. Kayıtlı parolası da Windows Kimlik Bilgileri'nden kaldırılır.`,
            confirmLabel: 'Sil',
            busyLabel: 'Siliniyor',
            action: async () => {
              if (connected) await disconnect()
              await api.deleteConnection(connection.id)
              if (activeId === connection.id) setActiveId(null)
              await loadConnections()
            },
          }),
        },
      )
    }
    openMenu(event, items)
  }

  // ---------------------------------------------------------------- terminal
  const canTerminal = Boolean(isConnected && activeConnection?.type === 'SFTP')
  const { terminal } = overlays
  const showTerminalDrawer = terminal.open && (Boolean(terminal.direct) || (canTerminal && Boolean(activeConnection)))

  const handleOpenTerminal = () => {
    if (canTerminal) {
      setOverlay({ terminal: { open: !showTerminalDrawer || Boolean(terminal.direct), direct: null } })
      return
    }
    if (terminal.open && terminal.direct) {
      setOverlay({ terminal: { open: false, direct: null } })
      return
    }
    setOverlay({ remoteAccess: 'ssh' })
  }

  // ---------------------------------------------------------------- kısayollar
  // Gezgin'den bırakılan dosya bir bırakma alanının dışına düşerse tarayıcı dosyayı açmaya çalışmasın.
  useEffect(() => {
    const block = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  useKeyboardShortcuts((event) => {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    const selectionShortcut = event.key === 'Delete' || event.key === 'F2' || (mod && (key === 'u' || key === 'd' || (event.shiftKey && key === 'n')))
    if (selectionShortcut && !fromWorkspace(event.target)) return
    if (mod && key === 'l') {
      event.preventDefault()
      setEditSignal((current) => ({ ...current, [focusedPane]: current[focusedPane] + 1 }))
    } else if (mod && key === 'f') {
      event.preventDefault()
      document.getElementById('cg-search-input')?.focus()
    } else if (mod && key === 'k') {
      event.preventDefault()
      toggleOverlay('quickConnect')
    } else if (mod && key === 'h') {
      event.preventDefault()
      toggleHidden()
    } else if (event.key === 'F5') {
      event.preventDefault()
      focusedDir.reload()
    } else if (event.key === 'F2' && focusedSelection) {
      event.preventDefault()
      askRename(focusedPane, focusedSelection)
    } else if (mod && event.shiftKey && key === 'n' && canCreateFolder) {
      event.preventDefault()
      askCreateFolder(focusedPane)
    } else if (event.key === 'Delete' && focusedSelections.length) {
      event.preventDefault()
      askDelete(focusedPane, focusedSelections, event.shiftKey)
    } else if (mod && key === 'u' && canUpload) {
      event.preventDefault()
      void enqueueSelected(selectedLocalEntries, 'upload')
    } else if (mod && key === 'd' && canDownload) {
      event.preventDefault()
      void enqueueSelected(selectedRemoteEntries, 'download')
    }
  }, blocking)

  // ---------------------------------------------------------------- görünüm
  const localPane = { ...local, visibleEntries: visibleLocal, editSignal: editSignal.local }
  const remotePane = { ...remote, visibleEntries: visibleRemote, editSignal: editSignal.remote }
  const closeConfirm = () => setOverlay({ confirm: null })

  const selectBookmark = (bookmark: FolderBookmark) => {
    setBookmarksOpen(false)
    if (bookmark.connectionId === null) {
      if (leftRemote) void switchLeftSource('local')
      setLocalPath(bookmark.path)
      setSelection((current) => ({ ...current, local: [] }))
      focusPane('local')
      return
    }
    const connection = connections.find((item) => item.id === String(bookmark.connectionId))
    if (connection) void openConnection(connection, bookmark.path)
    else setRemoteNotice({ tone: 'warn', title: `${bookmark.name} yer iminin bağlantısı artık yok.` })
  }

  return (
    <div className="cg-window">
      <TitleBar connection={isConnected ? activeConnection : null} theme={theme} onToggleTheme={toggleTheme} onOpenSettings={() => setOverlay({ settings: true })} />
      <Toolbar
        focusedPane={focusedPane}
        canUpload={canUpload}
        canDownload={canDownload}
        canCreateFolder={canCreateFolder}
        canInspect={Boolean(focusedSelection && focusedSelection.kind === 'file' && inspectable(focusedPane))}
        canDelete={Boolean(focusedSelections.length)}
        terminalOpen={showTerminalDrawer}
        quickOpen={overlays.quickConnect}
        showHidden={settings.showHidden}
        query={query}
        bookmarksOpen={bookmarksOpen}
        onNewConnection={() => setOverlay({ connectionDialog: {} })}
        onQuickConnect={() => toggleOverlay('quickConnect')}
        onUpload={() => { void enqueueSelected(selectedLocalEntries, 'upload') }}
        onDownload={() => { void enqueueSelected(selectedRemoteEntries, 'download') }}
        onCreateFolder={() => askCreateFolder(focusedPane)}
        onRefresh={() => focusedDir.reload()}
        onDelete={() => askDelete(focusedPane, focusedSelections)}
        onInspect={() => focusedSelection && setOverlay({ inspected: focusedSelection })}
        onOpenTerminal={handleOpenTerminal}
        onToggleHidden={toggleHidden}
        onToggleBookmarks={() => setBookmarksOpen((open) => !open)}
        onQueryChange={setQuery}
        canCompare={Boolean(isConnected && localDir && remote.path)}
        onCompare={() => setOverlay({ compare: true })}
        onDeepSearch={() => {
          const path = focusedPane === 'local' ? localDir : (isConnected ? remote.path : null)
          if (path && query.trim()) setOverlay({ search: { side: focusedPane, path, query: query.trim() } })
        }}
      />
      {overlays.quickConnect && (
        <QuickConnectBar onConnect={quickConnect} onClose={() => setOverlay({ quickConnect: false })} />
      )}
      <div className="cg-main">
        <Sidebar
          homePath={homePath}
          connections={connections}
          bookmarks={bookmarks}
          activeConnectionId={activeId}
          statusOf={statusOf}
          loadError={connectionsError}
          onLocalSelect={() => {
            if (leftRemote) void switchLeftSource('local')
            setLocalPath(homePath ?? '')
            setSelection((current) => ({ ...current, local: [] }))
            focusPane('local')
          }}
          onConnectionSelect={(connection) => { void openConnection(connection) }}
          onConnectionMenu={connectionMenu}
          onBookmarkSelect={selectBookmark}
          onManageBookmarks={() => setBookmarksOpen(true)}
          onImportFileZilla={(xml) => { void importFileZilla(xml) }}
        />
        <div className="cg-workspace">
          {updates.available && (
            <div className="cg-workspace-notice">
              <Notice
                tone="ok"
                title={`CyberGoose ${updates.available.latest} yayınlandı (kurulu: ${updates.available.current})`}
                action={(
                  <span className="cg-inline">
                    {updates.available.url && <button className="cg-btn cg-btn-sm cg-btn-primary" onClick={() => openDownload(updates.available!.url)}>İndir</button>}
                    <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Güncelleme bildirimini kapat" onClick={updates.dismiss}><Icon name="close" /></button>
                  </span>
                )}
              />
            </div>
          )}
          {remoteNotice && (
            <div className="cg-workspace-notice">
              <Notice tone={remoteNotice.tone} title={remoteNotice.title} action={<button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Bildirimi kapat" onClick={() => setRemoteNotice(null)}><Icon name="close" /></button>} />
            </div>
          )}
          <FileManagerView
            local={localPane}
            remote={remotePane}
            drives={drives}
            connection={activeConnection}
            connectionStatus={activeStatus}
            focusedPane={focusedPane}
            selection={selection}
            onFocusPane={focusPane}
            onSelect={(pane, names, primary) => {
              focusPane(pane)
              setPaneSelection(pane, names)
              if (overlays.inspected && primary?.kind === 'file' && inspectable(pane)) setOverlay({ inspected: primary })
            }}
            onOpen={openEntry}
            onNavigate={navigate}
            onConnect={(connection) => { void openConnection(connection) }}
            onNewConnection={() => setOverlay({ connectionDialog: {} })}
            onQuickConnect={overlays.quickConnect ? undefined : () => setOverlay({ quickConnect: true })}
            onContextMenu={fileMenu}
            onBackgroundMenu={backgroundMenu}
            onDropTransfer={(targetPane, names) => {
              // Yalnızca görünen öğeler: gizli ya da aramayla süzülmüş seçimler aktarılmaz.
              if (targetPane === 'remote') void enqueueSelected(visibleLocal.filter((entry) => names.includes(entry.name)), 'upload')
              else void enqueueSelected(visibleRemote.filter((entry) => names.includes(entry.name)), 'download')
            }}
            onDropExternal={(paths) => { void enqueueExternal(paths) }}
            leftTag={(
              <LeftSourcePicker
                connections={connections}
                value={leftConnecting ?? leftRemote?.connection.id ?? 'local'}
                busy={leftConnecting !== null}
                onChange={(value) => { void switchLeftSource(value) }}
              />
            )}
            leftRemoteLabel={leftRemote?.connection.name}
            leftRootLabel={leftRemote ? connectionLabel(leftRemote.connection) : undefined}
          />
        </div>
        {bookmarksOpen && (
          <BookmarksPanel
            bookmarks={bookmarks}
            connections={connections}
            currentFolder={currentFolder}
            error={bookmarksError}
            onClose={() => setBookmarksOpen(false)}
            onAdd={async () => { if (currentFolder) await addBookmark(currentFolder) }}
            onDelete={deleteBookmark}
            onSelect={selectBookmark}
          />
        )}
        {editsOpen && externalEdits.edits.length > 0 && (
          <ExternalEditsPanel
            edits={externalEdits.edits}
            onSync={(id) => { void externalEdits.syncNow(id) }}
            onStop={(id) => { void externalEdits.close(id) }}
            onClose={() => setEditsOpen(false)}
          />
        )}
        <FileInspector entry={overlays.inspected} sessionId={sessionId} onClose={() => setOverlay({ inspected: null })} />
      </div>
      <ChunkBoundary onReset={() => setOverlay({ terminal: { open: false, direct: null } })}>
      <Suspense fallback={null}>
        {showTerminalDrawer && (
          <TerminalDrawer
            connection={terminal.direct ? null : activeConnection}
            directTarget={terminal.direct}
            theme={theme}
            onOpenTunnels={() => setOverlay({ tunnels: true })}
            onClose={() => setOverlay({ terminal: { open: false, direct: null } })}
          />
        )}
      </Suspense>
      </ChunkBoundary>
      <TransferQueue
        items={transfers}
        open={queueOpen}
        onToggle={() => setQueueOpen((open) => !open)}
        onRetry={retryTransfer}
        onRetryAll={retryAll}
        onResolveConflicts={resolveConflicts}
        onCancel={cancelTransfer}
        onRemove={removeTransfer}
        onClearFinished={clearFinished}
      />
      <StatusBar
        itemCount={focusedPane === 'local' ? visibleLocal.length : visibleRemote.length}
        selectedCount={focusedSelections.length}
        selectedSize={selectedFilesSize}
        activeTransfer={activeTransfer ? (activeCount > 1 ? `${activeTransfer.name} ve ${activeCount - 1} dosya daha` : activeTransfer.name) : null}
        connection={isConnected ? activeConnection : null}
        editsCount={externalEdits.edits.length}
        onShowEdits={() => setEditsOpen((open) => !open)}
      />
      {overlays.connectionDialog && (
        <ConnectionModal
          initial={overlays.connectionDialog.initial}
          onClose={() => setOverlay({ connectionDialog: null })}
          onSave={async (values) => { await saveFromDialog(values, overlays.connectionDialog?.initial) }}
          onConnect={(values, trustHostKey) => connectFromDialog(values, overlays.connectionDialog?.initial, trustHostKey)}
        />
      )}
      <ChunkBoundary onReset={() => setOverlay({ remoteAccess: null, settings: false, tunnels: false, editing: null, compare: false, search: null })}>
      <Suspense fallback={null}>
        {overlays.remoteAccess && (
          <RemoteAccessModal
            initialMode={overlays.remoteAccess}
            savedConnections={connections}
            onOpenSsh={(target) => setOverlay({ terminal: { open: true, direct: target } })}
            onClose={() => setOverlay({ remoteAccess: null })}
          />
        )}
        {overlays.settings && (
          <SettingsModal
            themePreference={themePreference}
            onThemeChange={setThemePreference}
            settings={settings}
            onChange={setSettings}
            update={updates.supported ? { state: updates.state, onCheck: () => { void updates.check(true) }, onDownload: openDownload } : undefined}
            onClose={() => setOverlay({ settings: false })}
          />
        )}
        {overlays.compare && localDir && remote.path && (
          <CompareModal
            localPath={localDir}
            remotePath={remote.path}
            sessionId={sessionId}
            onSync={(rows, direction) => enqueueRelative(
              rows.map((row) => ({ relativeDir: row.relativeDir, name: row.name, size: direction === 'upload' ? row.localSize : row.remoteSize })),
              direction,
              localDir,
              remote.path as string,
              true,
            )}
            onClose={() => setOverlay({ compare: false })}
          />
        )}
        {overlays.search && (
          <SearchModal
            side={overlays.search.side}
            path={overlays.search.path}
            query={overlays.search.query}
            sessionId={sessionId}
            onOpen={(hit) => {
              const pane = overlays.search?.side ?? 'local'
              setOverlay({ search: null })
              focusPane(pane)
              if (hit.kind === 'folder') {
                navigate(pane, hit.path)
              } else {
                navigate(pane, hit.parent)
                setPaneSelection(pane, [hit.name])
              }
            }}
            onClose={() => setOverlay({ search: null })}
          />
        )}
        {overlays.tunnels && <TunnelModal onClose={() => setOverlay({ tunnels: false })} />}
        {overlays.editing && (
          overlays.editing.mode === 'sheet' ? (
            <SheetEditorModal
              side={overlays.editing.side}
              path={overlays.editing.entry.path}
              name={overlays.editing.entry.name}
              onSaved={overlays.editing.side === 'local' ? local.reload : remote.reload}
              onClose={() => setOverlay({ editing: null })}
            />
          ) : (
            <RemoteEditorModal
              side={overlays.editing.side}
              path={overlays.editing.entry.path}
              name={overlays.editing.entry.name}
              onSaved={overlays.editing.side === 'local' ? local.reload : remote.reload}
              onClose={() => setOverlay({ editing: null })}
            />
          )
        )}
      </Suspense>
      </ChunkBoundary>
      {overlays.confirm && (
        <ConfirmDialog
          title={overlays.confirm.title}
          message={overlays.confirm.message}
          confirmLabel={overlays.confirm.confirmLabel}
          tone={overlays.confirm.tone}
          busyLabel={overlays.confirm.busyLabel}
          secondary={overlays.confirm.secondary}
          onConfirm={overlays.confirm.action}
          onClose={closeConfirm}
        />
      )}
      {overlays.prompt && (
        <PromptDialog
          title={overlays.prompt.title}
          label={overlays.prompt.label}
          initialValue={overlays.prompt.initialValue}
          confirmLabel={overlays.prompt.confirmLabel}
          placeholder={overlays.prompt.placeholder}
          onConfirm={overlays.prompt.action}
          onClose={() => setOverlay({ prompt: null })}
        />
      )}
      {overlays.menu && <ContextMenu x={overlays.menu.x} y={overlays.menu.y} items={overlays.menu.items} onClose={() => setOverlay({ menu: null })} />}
    </div>
  )
}

export default App
