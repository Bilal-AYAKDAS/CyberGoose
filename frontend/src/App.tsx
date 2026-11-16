import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import './styles/app.css'
import { StatusBar, TitleBar, Toolbar } from './components/AppChrome'
import { BookmarksPanel } from './components/BookmarksPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ConnectionModal, type ConnectOutcome } from './components/ConnectionModal'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { FileInspector } from './components/FileInspector'
import { FileManagerView } from './components/FileManagerView'
import { Notice } from './components/Notice'
import { Sidebar } from './components/Sidebar'
import { TransferQueue } from './components/TransferQueue'
import { useDirectory } from './hooks/useDirectory'
import { useTheme } from './hooks/useTheme'
import { ApiError, api } from './services/apiClient'
import type {
  ConnectionFormValues,
  ConnectionProfile,
  ConnectionStatus,
  FileEntry,
  FolderBookmark,
  PaneId,
  SavedConnection,
  TransferItem,
} from './types'
import { connectionLabel, isCloud } from './utils/formatters'

/** Bulut hesapları kayıtlı bağlantı değildir; kenar çubuğunda her zaman görünür. */
const CLOUD_ACCOUNTS: ConnectionProfile[] = [
  { id: 'dropbox', name: 'Dropbox', type: 'Dropbox', host: '', port: '', username: '', hasPassword: false, saved: false },
  { id: 'drive', name: 'Google Drive', type: 'GoogleDrive', host: '', port: '', username: '', hasPassword: false, saved: false },
]

const toProfile = (saved: SavedConnection): ConnectionProfile => ({
  id: String(saved.id),
  name: saved.name,
  type: saved.type,
  host: saved.host,
  port: saved.port,
  username: saved.username,
  hasPassword: saved.hasPassword,
  saved: true,
})

type DialogState = { open: false } | { open: true; initial?: ConnectionProfile }
type MenuState = { x: number; y: number; items: MenuItem[] } | null
type ConfirmState = { title: string; message: string; confirmLabel: string; action: () => Promise<void> } | null
type PaneNotice = { tone: 'warn' | 'error'; title: string } | null

function matches(entry: FileEntry, query: string) {
  return entry.name.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * Uygulama penceresi (tasarımdaki AppWindow):
 * başlık 36 · araç çubuğu 40 · [kenar çubuğu 220 | panel | 1px | panel] · transfer kuyruğu · durum 24.
 * Tüm veriler Flask API'sinden gelir.
 */
function App({ onReady }: { onReady?: () => void }) {
  const { theme, toggleTheme } = useTheme()

  // ---------------------------------------------------------------- bağlantılar
  const [savedConnections, setSavedConnections] = useState<ConnectionProfile[]>([])
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [connectedId, setConnectedId] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [remoteNotice, setRemoteNotice] = useState<PaneNotice>(null)

  const connections = useMemo(() => [...savedConnections, ...CLOUD_ACCOUNTS], [savedConnections])
  const activeConnection = connections.find((connection) => connection.id === activeId) ?? null
  const statusOf = useCallback((id: string): ConnectionStatus => {
    if (id === connectingId) return 'connecting'
    if (id === connectedId) return 'connected'
    if (id === failedId) return 'error'
    return 'offline'
  }, [connectedId, connectingId, failedId])
  const activeStatus: ConnectionStatus = activeConnection ? statusOf(activeConnection.id) : 'offline'
  const isConnected = activeStatus === 'connected'

  const loadConnections = useCallback(async () => {
    try {
      setSavedConnections((await api.listConnections()).map(toProfile))
      setConnectionsError(null)
    } catch (error) {
      setConnectionsError(messageOf(error, 'Kayıtlı bağlantılar yüklenemedi'))
    }
  }, [])

  // ---------------------------------------------------------------- paneller
  const [homePath, setHomePath] = useState<string | null>(null)
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [remotePath, setRemotePath] = useState('/')
  const [focusedPane, setFocusedPane] = useState<PaneId>('local')
  const [selection, setSelection] = useState<Record<PaneId, string | null>>({ local: null, remote: null })
  const [query, setQuery] = useState('')
  const [editSignal, setEditSignal] = useState<Record<PaneId, number>>({ local: 0, remote: 0 })

  const local = useDirectory('local', localPath, true)
  const remote = useDirectory('remote', remotePath, isConnected)

  const visibleLocal = useMemo(() => focusedPane === 'local' && query ? local.entries.filter((entry) => matches(entry, query)) : local.entries, [focusedPane, query, local.entries])
  const visibleRemote = useMemo(() => focusedPane === 'remote' && query ? remote.entries.filter((entry) => matches(entry, query)) : remote.entries, [focusedPane, query, remote.entries])

  const selectedLocal = local.entries.find((entry) => entry.name === selection.local) ?? null
  const selectedRemote = isConnected ? remote.entries.find((entry) => entry.name === selection.remote) ?? null : null
  const focusedSelection = focusedPane === 'local' ? selectedLocal : selectedRemote
  const focusedDir = focusedPane === 'local' ? local : remote

  const focusPane = useCallback((pane: PaneId) => {
    setFocusedPane((current) => {
      if (current !== pane) setQuery('')
      return pane
    })
  }, [])

  const navigate = useCallback((pane: PaneId, path: string) => {
    setSelection((current) => ({ ...current, [pane]: null }))
    setQuery('')
    if (pane === 'local') setLocalPath(path)
    else setRemotePath(path)
  }, [])

  // ---------------------------------------------------------------- ilk yükleme
  const readySent = useRef(false)
  useEffect(() => {
    let active = true
    Promise.allSettled([
      loadConnections(),
      api.localHome().then(({ path }) => { if (active) setHomePath(path) }),
      api.session().then((session) => {
        if (active && session.connected && session.connectionId) {
          setConnectedId(session.connectionId)
          setActiveId(session.connectionId)
        }
      }),
    ]).finally(() => {
      if (!readySent.current) {
        readySent.current = true
        onReady?.()
      }
    })
    return () => { active = false }
  }, [loadConnections, onReady])

  // ---------------------------------------------------------------- bağlanma
  const [dialog, setDialog] = useState<DialogState>({ open: false })

  const connectTo = useCallback(async (connection: ConnectionProfile, password?: string, startPath = '/'): Promise<ConnectOutcome> => {
    setConnectingId(connection.id)
    setFailedId(null)
    setActiveId(connection.id)
    setRemoteNotice(null)
    try {
      const result = await api.connect({
        type: connection.type,
        connectionId: connection.saved ? connection.id : undefined,
        clientId: connection.id,
        password,
      })
      if ('pending' in result) return { pending: result.message }
      setConnectedId(connection.id)
      setRemotePath(startPath)
      setSelection((current) => ({ ...current, remote: null }))
      focusPane('remote')
    } catch (error) {
      setFailedId(connection.id)
      throw error
    } finally {
      setConnectingId((current) => (current === connection.id ? null : current))
    }
  }, [focusPane])

  /** Kenar çubuğundan veya yer iminden bağlanma: parola gerekiyorsa diyaloğu açar. */
  const openConnection = useCallback(async (connection: ConnectionProfile, startPath = '/') => {
    if (statusOf(connection.id) === 'connected') {
      setActiveId(connection.id)
      if (startPath !== '/') navigate('remote', startPath)
      focusPane('remote')
      return
    }
    if (connection.saved && !connection.hasPassword) {
      setDialog({ open: true, initial: connection })
      return
    }
    try {
      const outcome = await connectTo(connection, undefined, startPath)
      if (outcome && 'pending' in outcome) setRemoteNotice({ tone: 'warn', title: outcome.pending })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'password_required') {
        setDialog({ open: true, initial: connection })
        return
      }
      setRemoteNotice({ tone: 'error', title: messageOf(error, 'Bağlantı kurulamadı') })
    }
  }, [connectTo, focusPane, navigate, statusOf])

  const disconnect = useCallback(async () => {
    await api.disconnect().catch(() => undefined)
    setConnectedId(null)
    setSelection((current) => ({ ...current, remote: null }))
    focusPane('local')
  }, [focusPane])

  const saveFromDialog = async (values: ConnectionFormValues, initial?: ConnectionProfile) => {
    const input = { name: values.name.trim(), type: values.type, host: values.host.trim(), port: values.port, username: values.username.trim() }
    const saved = initial?.saved ? await api.updateConnection(initial.id, input) : await api.createConnection(input)
    await loadConnections()
    return toProfile(saved)
  }

  const connectFromDialog = async (values: ConnectionFormValues, initial?: ConnectionProfile): Promise<ConnectOutcome> => {
    if (isCloud(values.type)) {
      const account = CLOUD_ACCOUNTS.find((item) => item.type === values.type) as ConnectionProfile
      return connectTo(account)
    }
    if (initial?.saved) {
      const profile = await saveFromDialog(values, initial)
      return connectTo(profile, values.password || undefined)
    }
    // Yeni sunucu: önce bağlan, başarılıysa parolasız kaydet.
    const draftId = `new-${Date.now()}`
    setConnectingId(draftId)
    try {
      await api.connect({ type: values.type, host: values.host.trim(), port: values.port, username: values.username.trim(), password: values.password, clientId: draftId })
    } finally {
      setConnectingId(null)
    }
    const profile = await saveFromDialog(values)
    setConnectedId(profile.id)
    setActiveId(profile.id)
    setRemotePath('/')
    setSelection((current) => ({ ...current, remote: null }))
    focusPane('remote')
  }

  // ---------------------------------------------------------------- yer imleri
  const [bookmarks, setBookmarks] = useState<FolderBookmark[]>([])
  const [bookmarksError, setBookmarksError] = useState<string | null>(null)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)

  useEffect(() => {
    if (!bookmarksOpen) return
    api.listBookmarks().then((items) => { setBookmarks(items); setBookmarksError(null) })
      .catch((error) => setBookmarksError(messageOf(error, 'Yer imleri yüklenemedi')))
  }, [bookmarksOpen])

  const currentFolder = focusedPane === 'local'
    ? (local.path ? { label: local.crumbs.at(-1)?.name || local.path, path: local.path, connectionId: null } : null)
    : (isConnected && remote.path && activeConnection ? { label: remote.crumbs.at(-1)?.name === '/' ? activeConnection.name : remote.crumbs.at(-1)?.name ?? remote.path, path: remote.path, connectionId: activeConnection.id } : null)

  // ---------------------------------------------------------------- transfer kuyruğu
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [queueOpen, setQueueOpen] = useState(true)
  const runningRef = useRef(false)
  const reloadLocal = local.reload
  const reloadRemote = remote.reload

  const enqueue = (entry: FileEntry, direction: TransferItem['direction']) => {
    if (!local.path || !remote.path || !activeConnection) return
    const remoteLabel = `${connectionLabel(activeConnection)}:${remote.path}`
    setTransfers((items) => [...items, {
      id: crypto.randomUUID(),
      name: entry.name,
      direction,
      localDir: local.path as string,
      remoteDir: remote.path as string,
      from: direction === 'upload' ? local.path as string : remoteLabel,
      to: direction === 'upload' ? remoteLabel : local.path as string,
      size: entry.size,
      status: 'queued',
    }])
    setQueueOpen(true)
  }

  useEffect(() => {
    if (runningRef.current || transfers.some((item) => item.status === 'transferring')) return
    const next = transfers.find((item) => item.status === 'queued')
    if (!next) return
    runningRef.current = true
    const startedAt = Date.now()
    setTransfers((items) => items.map((item) => item.id === next.id ? { ...item, status: 'transferring', startedAt, error: undefined, errorCode: undefined } : item))
    api.transfer({ direction: next.direction, name: next.name, localDir: next.localDir, remoteDir: next.remoteDir, overwrite: next.overwrite })
      .then((result) => {
        setTransfers((items) => items.map((item) => item.id === next.id ? { ...item, status: 'completed', size: result.size, finishedAt: Date.now() } : item))
        if (next.direction === 'upload') reloadRemote()
        else reloadLocal()
      })
      .catch((error: unknown) => {
        setTransfers((items) => items.map((item) => item.id === next.id ? {
          ...item,
          status: 'error',
          error: messageOf(error, 'Aktarım başarısız'),
          errorCode: error instanceof ApiError ? error.code : undefined,
          finishedAt: Date.now(),
        } : item))
      })
      .finally(() => { runningRef.current = false })
  }, [transfers, reloadLocal, reloadRemote])

  const activeTransfer = transfers.find((item) => item.status === 'transferring')

  // ---------------------------------------------------------------- silme, menüler, kısayollar
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [menu, setMenu] = useState<MenuState>(null)
  const [inspectedEntry, setInspectedEntry] = useState<FileEntry | null>(null)

  const askDelete = (pane: PaneId, entry: FileEntry) => {
    if (entry.kind === 'folder') return
    setConfirm({
      title: 'Dosyayı sil',
      message: `${entry.name} kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmLabel: 'Sil',
      action: async () => {
        await api.deleteEntry(pane, entry.path)
        setSelection((current) => ({ ...current, [pane]: null }))
        if (inspectedEntry?.path === entry.path) setInspectedEntry(null)
        if (pane === 'local') reloadLocal()
        else reloadRemote()
      },
    })
  }

  const openEntry = (pane: PaneId, entry: FileEntry) => {
    if (entry.kind === 'folder') navigate(pane, entry.path)
    else setInspectedEntry(entry)
  }

  const canUpload = Boolean(selectedLocal?.kind === 'file' && isConnected && remote.path)
  const canDownload = Boolean(selectedRemote?.kind === 'file' && local.path)

  const fileMenu = (pane: PaneId, entry: FileEntry, event: MouseEvent) => {
    const items: MenuItem[] = entry.kind === 'folder'
      ? [{ label: 'Aç', onSelect: () => navigate(pane, entry.path), hint: 'Enter' }]
      : [
        { label: 'Detaylar', onSelect: () => setInspectedEntry(entry), hint: 'Enter' },
        pane === 'local'
          ? { label: 'Yükle', onSelect: () => enqueue(entry, 'upload'), disabled: !isConnected, hint: 'Ctrl+U' }
          : { label: 'İndir', onSelect: () => enqueue(entry, 'download'), hint: 'Ctrl+D' },
        { label: 'Yolu kopyala', onSelect: () => { void navigator.clipboard?.writeText(entry.path) } },
        { label: 'Sil', onSelect: () => askDelete(pane, entry), danger: true, hint: 'Del' },
      ]
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  const connectionMenu = (connection: ConnectionProfile, event: MouseEvent) => {
    const connected = statusOf(connection.id) === 'connected'
    const items: MenuItem[] = [
      connected
        ? { label: 'Bağlantıyı kes', onSelect: () => { void disconnect() } }
        : { label: 'Bağlan', onSelect: () => { void openConnection(connection) } },
    ]
    if (connection.saved) {
      items.push(
        { label: 'Düzenle', onSelect: () => setDialog({ open: true, initial: connection }) },
        { label: 'Adresi kopyala', onSelect: () => { void navigator.clipboard?.writeText(`${connection.username ? `${connection.username}@` : ''}${connection.host}:${connection.port}`) } },
        {
          label: 'Sil',
          danger: true,
          onSelect: () => setConfirm({
            title: 'Bağlantıyı sil',
            message: `${connection.name} kayıtlı bağlantılardan ve yer imlerinden silinecek.`,
            confirmLabel: 'Sil',
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
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  const shortcutsRef = useRef<(event: KeyboardEvent) => void>(() => undefined)
  const handleShortcut = (event: KeyboardEvent) => {
    if (dialog.open || confirm || menu) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (mod && key === 'l') {
      event.preventDefault()
      setEditSignal((current) => ({ ...current, [focusedPane]: current[focusedPane] + 1 }))
      return
    }
    if (mod && key === 'f') {
      event.preventDefault()
      document.getElementById('cg-search-input')?.focus()
      return
    }
    if (isTypingTarget(event.target)) return
    if (event.key === 'F5') {
      event.preventDefault()
      focusedDir.reload()
    } else if (event.key === 'Delete' && focusedSelection) {
      event.preventDefault()
      askDelete(focusedPane, focusedSelection)
    } else if (mod && key === 'u' && canUpload && selectedLocal) {
      event.preventDefault()
      enqueue(selectedLocal, 'upload')
    } else if (mod && key === 'd' && canDownload && selectedRemote) {
      event.preventDefault()
      enqueue(selectedRemote, 'download')
    }
  }
  useEffect(() => { shortcutsRef.current = handleShortcut })
  useEffect(() => {
    const handler = (event: KeyboardEvent) => shortcutsRef.current(event)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ---------------------------------------------------------------- görünüm
  const localPane = { ...local, visibleEntries: visibleLocal, editSignal: editSignal.local }
  const remotePane = { ...remote, visibleEntries: visibleRemote, editSignal: editSignal.remote }

  return (
    <div className="cg-window">
      <TitleBar connection={isConnected ? activeConnection : null} theme={theme} onToggleTheme={toggleTheme} />
      <Toolbar
        focusedPane={focusedPane}
        canUpload={canUpload}
        canDownload={canDownload}
        canInspect={Boolean(focusedSelection && focusedSelection.kind === 'file')}
        canDelete={Boolean(focusedSelection && focusedSelection.kind === 'file')}
        query={query}
        bookmarksOpen={bookmarksOpen}
        onNewConnection={() => setDialog({ open: true })}
        onUpload={() => selectedLocal && enqueue(selectedLocal, 'upload')}
        onDownload={() => selectedRemote && enqueue(selectedRemote, 'download')}
        onRefresh={() => focusedDir.reload()}
        onDelete={() => focusedSelection && askDelete(focusedPane, focusedSelection)}
        onInspect={() => focusedSelection && setInspectedEntry(focusedSelection)}
        onToggleBookmarks={() => setBookmarksOpen((open) => !open)}
        onQueryChange={setQuery}
      />
      <div className="cg-main">
        <Sidebar
          homePath={homePath}
          connections={connections}
          activeConnectionId={activeId}
          statusOf={statusOf}
          loadError={connectionsError}
          onLocalSelect={() => { navigate('local', homePath ?? ''); focusPane('local') }}
          onConnectionSelect={(connection) => { void openConnection(connection) }}
          onConnectionMenu={connectionMenu}
        />
        <div className="cg-workspace">
          {remoteNotice && (
            <div className="cg-workspace-notice">
              <Notice tone={remoteNotice.tone} title={remoteNotice.title} action={<button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Bildirimi kapat" onClick={() => setRemoteNotice(null)}>×</button>} />
            </div>
          )}
          <FileManagerView
            local={localPane}
            remote={remotePane}
            connection={activeConnection}
            connectionStatus={activeStatus}
            focusedPane={focusedPane}
            selection={selection}
            onFocusPane={focusPane}
            onSelect={(pane, entry) => {
              focusPane(pane)
              setSelection((current) => ({ ...current, [pane]: entry.name }))
              if (inspectedEntry && entry.kind === 'file') setInspectedEntry(entry)
            }}
            onOpen={openEntry}
            onNavigate={navigate}
            onConnect={(connection) => { void openConnection(connection) }}
            onNewConnection={() => setDialog({ open: true })}
            onContextMenu={fileMenu}
          />
        </div>
        {bookmarksOpen && (
          <BookmarksPanel
            bookmarks={bookmarks}
            connections={connections}
            currentFolder={currentFolder}
            error={bookmarksError}
            onClose={() => setBookmarksOpen(false)}
            onAdd={async () => {
              if (!currentFolder) return
              const created = await api.createBookmark({ name: currentFolder.label, path: currentFolder.path, connectionId: currentFolder.connectionId })
              setBookmarks((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name, 'tr')))
            }}
            onDelete={async (bookmark) => {
              await api.deleteBookmark(bookmark.id)
              setBookmarks((items) => items.filter((item) => item.id !== bookmark.id))
            }}
            onSelect={(bookmark) => {
              setBookmarksOpen(false)
              if (bookmark.connectionId === null) {
                navigate('local', bookmark.path)
                focusPane('local')
                return
              }
              const connection = connections.find((item) => item.id === String(bookmark.connectionId))
              if (connection) void openConnection(connection, bookmark.path)
            }}
          />
        )}
        <FileInspector entry={inspectedEntry} onClose={() => setInspectedEntry(null)} />
      </div>
      <TransferQueue
        items={transfers}
        open={queueOpen}
        onToggle={() => setQueueOpen((open) => !open)}
        onRetry={(id, overwrite) => setTransfers((items) => items.map((item) => item.id === id ? { ...item, status: 'queued', overwrite: overwrite ?? item.overwrite, error: undefined, errorCode: undefined } : item))}
        onRemove={(id) => setTransfers((items) => items.filter((item) => item.id !== id))}
        onClearFinished={() => setTransfers((items) => items.filter((item) => item.status !== 'completed' && item.status !== 'cancelled'))}
      />
      <StatusBar
        itemCount={focusedPane === 'local' ? visibleLocal.length : visibleRemote.length}
        selectedCount={focusedSelection ? 1 : 0}
        selectedSize={focusedSelection?.kind === 'file' ? focusedSelection.size : null}
        activeTransfer={activeTransfer?.name ?? null}
        connection={isConnected ? activeConnection : null}
      />
      {dialog.open && (
        <ConnectionModal
          initial={dialog.initial}
          onClose={() => setDialog({ open: false })}
          onSave={async (values) => { await saveFromDialog(values, dialog.initial) }}
          onConnect={(values) => connectFromDialog(values, dialog.initial)}
        />
      )}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

export default App
