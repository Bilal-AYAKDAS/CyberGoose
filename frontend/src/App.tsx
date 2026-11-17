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
import { Icon } from './components/Icon'
import { Notice } from './components/Notice'
import { PromptDialog } from './components/PromptDialog'
import { QuickConnectBar } from './components/QuickConnectBar'
import { Sidebar } from './components/Sidebar'
import { TransferQueue } from './components/TransferQueue'
import { useBookmarks } from './hooks/useBookmarks'
import { QUICK_ID, toProfile, useConnections } from './hooks/useConnections'
import { useDirectory } from './hooks/useDirectory'
import { useFileActions } from './hooks/useFileActions'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useOverlays, type ConfirmState, type PromptState } from './hooks/useOverlays'
import { useSettings } from './hooks/useSettings'
import { useTheme } from './hooks/useTheme'
import { useTransferQueue } from './hooks/useTransferQueue'
import { api, type HostKeyInfo } from './services/apiClient'
import type { ConnectionProfile, FileEntry, FolderBookmark, PaneId } from './types'

// Seyrek açılan katmanlar ayrı parçalara bölünür: açılış paketi küçülür (xterm.js yalnızca
// terminal açılınca yüklenir).
const TerminalDrawer = lazy(() => import('./components/TerminalDrawer').then((m) => ({ default: m.TerminalDrawer })))
const RemoteEditorModal = lazy(() => import('./components/RemoteEditorModal').then((m) => ({ default: m.RemoteEditorModal })))
const SheetEditorModal = lazy(() => import('./components/SheetEditorModal').then((m) => ({ default: m.SheetEditorModal })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const TunnelModal = lazy(() => import('./components/TunnelModal').then((m) => ({ default: m.TunnelModal })))
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
  const { overlays, set: setOverlay, toggle: toggleOverlay, blocking } = useOverlays()

  // ---------------------------------------------------------------- paneller
  const [homePath, setHomePath] = useState<string | null>(null)
  const [drives, setDrives] = useState<string[]>([])
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [remotePath, setRemotePath] = useState('/')
  const [focusedPane, setFocusedPane] = useState<PaneId>('local')
  const [selection, setSelection] = useState<Record<PaneId, string[]>>({ local: [], remote: [] })
  const [query, setQuery] = useState('')
  const [editSignal, setEditSignal] = useState<Record<PaneId, number>>({ local: 0, remote: 0 })
  const [remoteNotice, setRemoteNotice] = useState<PaneNotice>(null)

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
    if (pane === 'local') setLocalPath(path)
    else setRemotePath(path)
  }, [])

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
  const local = useDirectory('local', localPath, true)
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
  const { transfers, queueOpen, activeTransfer, activeCount, setQueueOpen, enqueueMany, enqueueFolders, cancelTransfer, retryTransfer, removeTransfer, clearFinished } = useTransferQueue({
    localPath: local.path,
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
    const filesOnly = entries.filter((entry) => entry.kind === 'file')
    const foldersOnly = entries.filter((entry) => entry.kind === 'folder')
    if (filesOnly.length) enqueueMany(filesOnly, direction)
    if (!foldersOnly.length) return
    try {
      await enqueueFolders(foldersOnly, direction)
    } catch (error) {
      setRemoteNotice({ tone: 'error', title: messageOf(error, 'Klasör aktarıma eklenemedi') })
    }
  }, [enqueueFolders, enqueueMany])

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
    ? (local.path ? { label: local.crumbs.at(-1)?.name || local.path, path: local.path, connectionId: null } : null)
    : (isConnected && remote.path && activeConnection?.saved ? { label: remote.crumbs.at(-1)?.name === '/' ? activeConnection.name : remote.crumbs.at(-1)?.name ?? remote.path, path: remote.path, connectionId: activeConnection.id } : null)

  // ---------------------------------------------------------------- dosya eylemleri
  const reloadPane = useCallback((pane: PaneId) => {
    if (pane === 'local') local.reload()
    else remote.reload()
  }, [local, remote])

  const { askDelete, askCreateFolder, askRename, askCreateZip } = useFileActions({
    localPath: local.path,
    remotePath: remote.path,
    isConnected,
    inspectedPath: overlays.inspected?.path ?? null,
    openConfirm,
    openPrompt,
    clearInspected: useCallback(() => setOverlay({ inspected: null }), [setOverlay]),
    setPaneSelection,
    reloadPane,
  })

  const openEntry = (pane: PaneId, entry: FileEntry) => {
    if (entry.kind === 'folder') navigate(pane, entry.path)
    else setOverlay({ inspected: entry })
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
    const transferItem: MenuItem = pane === 'local'
      ? { label: targets.length > 1 ? `Yükle (${targets.length})` : entry.kind === 'folder' ? 'Klasörü yükle' : 'Yükle', onSelect: () => { void enqueueSelected(targets, 'upload') }, disabled: !isConnected, hint: 'Ctrl+U' }
      : { label: targets.length > 1 ? `İndir (${targets.length})` : entry.kind === 'folder' ? 'Klasörü indir' : 'İndir', onSelect: () => { void enqueueSelected(targets, 'download') }, hint: 'Ctrl+D' }
    const zipItem: MenuItem[] = pane === 'local' ? [{ label: targets.length > 1 ? `Zip arşivi oluştur (${targets.length})` : 'Zip arşivi oluştur', onSelect: () => askCreateZip(targets) }] : []
    const deleteLabel = pane === 'local' ? "Geri Dönüşüm Kutusu'na taşı" : 'Sil'
    const items: MenuItem[] = targets.length > 1
      ? [
        transferItem,
        ...zipItem,
        { label: `${deleteLabel} (${targets.length})`, onSelect: () => askDelete(pane, targets), danger: true, hint: 'Del' },
      ]
      : [
        entry.kind === 'folder'
          ? { label: 'Aç', onSelect: () => navigate(pane, entry.path), hint: 'Enter' }
          : { label: 'Detaylar', onSelect: () => setOverlay({ inspected: entry }), hint: 'Enter' },
        ...(() => {
          if (entry.kind !== 'file') return []
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
      navigate('local', bookmark.path)
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
        canInspect={Boolean(focusedSelection && focusedSelection.kind === 'file')}
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
          onLocalSelect={() => { navigate('local', homePath ?? ''); focusPane('local') }}
          onConnectionSelect={(connection) => { void openConnection(connection) }}
          onConnectionMenu={connectionMenu}
          onBookmarkSelect={selectBookmark}
          onManageBookmarks={() => setBookmarksOpen(true)}
        />
        <div className="cg-workspace">
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
              if (overlays.inspected && primary?.kind === 'file') setOverlay({ inspected: primary })
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
        <FileInspector entry={overlays.inspected} onClose={() => setOverlay({ inspected: null })} />
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
      />
      {overlays.connectionDialog && (
        <ConnectionModal
          initial={overlays.connectionDialog.initial}
          onClose={() => setOverlay({ connectionDialog: null })}
          onSave={async (values) => { await saveFromDialog(values, overlays.connectionDialog?.initial) }}
          onConnect={(values, trustHostKey) => connectFromDialog(values, overlays.connectionDialog?.initial, trustHostKey)}
        />
      )}
      <ChunkBoundary onReset={() => setOverlay({ remoteAccess: null, settings: false, tunnels: false, editing: null })}>
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
            onClose={() => setOverlay({ settings: false })}
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
