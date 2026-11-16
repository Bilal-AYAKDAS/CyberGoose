import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import './styles/app.css'
import { StatusBar, TitleBar, Toolbar } from './components/AppChrome'
import { BookmarksPanel } from './components/BookmarksPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ConnectionModal } from './components/ConnectionModal'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { FileInspector } from './components/FileInspector'
import { FileManagerView } from './components/FileManagerView'
import { Notice } from './components/Notice'
import { PromptDialog } from './components/PromptDialog'
import { Sidebar } from './components/Sidebar'
import { TerminalDrawer } from './components/TerminalDrawer'
import { TransferQueue } from './components/TransferQueue'
import { useBookmarks } from './hooks/useBookmarks'
import { toProfile, useConnections } from './hooks/useConnections'
import { useDirectory } from './hooks/useDirectory'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useTheme } from './hooks/useTheme'
import { useTransferQueue } from './hooks/useTransferQueue'
import { api } from './services/apiClient'
import type { ConnectionProfile, FileEntry, PaneId } from './types'

type DialogState = { open: false } | { open: true; initial?: ConnectionProfile }
type MenuState = { x: number; y: number; items: MenuItem[] } | null
type ConfirmState = { title: string; message: string; confirmLabel: string; action: () => Promise<void> } | null
type PromptState = { title: string; label: string; initialValue?: string; confirmLabel: string; placeholder?: string; action: (value: string) => Promise<void> } | null
type PaneNotice = { tone: 'warn' | 'error'; title: string } | null

function matches(entry: FileEntry, query: string) {
  return entry.name.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * Uygulama penceresi (tasarımdaki AppWindow):
 * başlık 36 · araç çubuğu 40 · [kenar çubuğu 220 | panel | 1px | panel] · transfer kuyruğu · durum 24.
 * Durum mantığı özel hook'lara (useConnections, useTransferQueue, useBookmarks, useDirectory) ayrılmıştır.
 */
function App({ onReady }: { onReady?: () => void }) {
  const { theme, toggleTheme } = useTheme()

  // ---------------------------------------------------------------- paneller
  const [homePath, setHomePath] = useState<string | null>(null)
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [remotePath, setRemotePath] = useState('/')
  const [focusedPane, setFocusedPane] = useState<PaneId>('local')
  const [selection, setSelection] = useState<Record<PaneId, string[]>>({ local: [], remote: [] })
  const [query, setQuery] = useState('')
  const [editSignal, setEditSignal] = useState<Record<PaneId, number>>({ local: 0, remote: 0 })
  const [remoteNotice, setRemoteNotice] = useState<PaneNotice>(null)
  const [dialog, setDialog] = useState<DialogState>({ open: false })

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
    setDialog({ open: true, initial: connection })
  }, [])

  const {
    connections,
    connectionsError,
    activeId,
    activeConnection,
    activeStatus,
    isConnected,
    statusOf,
    setSavedConnections,
    setConnectionsError,
    setActiveId,
    setConnectedId,
    loadConnections,
    openConnection,
    disconnect,
    saveFromDialog,
    connectFromDialog,
  } = useConnections({
    onConnected: handleConnected,
    onDisconnected: handleDisconnected,
    onNeedPassword: handleNeedPassword,
    onNotice: setRemoteNotice,
  })

  // ---------------------------------------------------------------- klasörler ve seçimler
  const local = useDirectory('local', localPath, true)
  const remote = useDirectory('remote', remotePath, isConnected)

  const visibleLocal = useMemo(() => focusedPane === 'local' && query ? local.entries.filter((entry) => matches(entry, query)) : local.entries, [focusedPane, query, local.entries])
  const visibleRemote = useMemo(() => focusedPane === 'remote' && query ? remote.entries.filter((entry) => matches(entry, query)) : remote.entries, [focusedPane, query, remote.entries])

  const selectedLocalEntries = useMemo(() => local.entries.filter((entry) => selection.local.includes(entry.name)), [local.entries, selection.local])
  const selectedRemoteEntries = useMemo(() => isConnected ? remote.entries.filter((entry) => selection.remote.includes(entry.name)) : [], [isConnected, remote.entries, selection.remote])
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
  }, [onReady, setActiveId, setConnectedId, setConnectionsError, setSavedConnections])

  // ---------------------------------------------------------------- yer imleri ve transferler
  const { bookmarks, bookmarksError, bookmarksOpen, setBookmarksOpen, addBookmark, deleteBookmark } = useBookmarks()
  const { transfers, queueOpen, activeTransfer, setQueueOpen, enqueue, enqueueMany, cancelTransfer, retryTransfer, removeTransfer, clearFinished } = useTransferQueue({
    localPath: local.path,
    remotePath,
    activeConnection,
    reloadLocal: local.reload,
    reloadRemote: remote.reload,
  })

  const currentFolder = focusedPane === 'local'
    ? (local.path ? { label: local.crumbs.at(-1)?.name || local.path, path: local.path, connectionId: null } : null)
    : (isConnected && remote.path && activeConnection ? { label: remote.crumbs.at(-1)?.name === '/' ? activeConnection.name : remote.crumbs.at(-1)?.name ?? remote.path, path: remote.path, connectionId: activeConnection.id } : null)

  // ---------------------------------------------------------------- dosya eylemleri, menüler, kısayollar
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [prompt, setPrompt] = useState<PromptState>(null)
  const [menu, setMenu] = useState<MenuState>(null)
  const [inspectedEntry, setInspectedEntry] = useState<FileEntry | null>(null)
  const [terminalOpen, setTerminalOpen] = useState(false)

  const reloadPane = (pane: PaneId) => {
    if (pane === 'local') local.reload()
    else remote.reload()
  }

  const askDelete = (pane: PaneId, entries: FileEntry[]) => {
    if (!entries.length) return
    const single = entries.length === 1 ? entries[0] : null
    const title = single ? (single.kind === 'folder' ? 'Klasörü sil' : 'Dosyayı sil') : `${entries.length} öğeyi sil`
    const message = single
      ? (single.kind === 'folder'
        ? `${single.name} klasörü ve içindeki tüm öğeler kalıcı olarak silinecek. Bu işlem geri alınamaz.`
        : `${single.name} kalıcı olarak silinecek. Bu işlem geri alınamaz.`)
      : `Seçili ${entries.length} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.`
    setConfirm({
      title,
      message,
      confirmLabel: 'Sil',
      action: async () => {
        for (const item of entries) {
          await api.deleteEntry(pane, item.path)
          if (inspectedEntry?.path === item.path) setInspectedEntry(null)
        }
        setSelection((current) => ({ ...current, [pane]: [] }))
        reloadPane(pane)
      },
    })
  }

  const askCreateFolder = (pane: PaneId) => {
    const parentPath = pane === 'local' ? local.path : (isConnected ? remote.path : null)
    if (!parentPath) return
    setPrompt({
      title: 'Yeni klasör',
      label: 'Klasör adı',
      confirmLabel: 'Oluştur',
      placeholder: 'Yeni klasör',
      action: async (name) => {
        await api.mkdir(pane, parentPath, name)
        reloadPane(pane)
      },
    })
  }

  const askRename = (pane: PaneId, entry: FileEntry) => {
    setPrompt({
      title: 'Yeniden adlandır',
      label: 'Yeni ad',
      initialValue: entry.name,
      confirmLabel: 'Kaydet',
      action: async (newName) => {
        if (newName === entry.name) return
        await api.renameEntry(pane, entry.path, newName)
        setSelection((current) => ({ ...current, [pane]: [newName] }))
        if (inspectedEntry?.path === entry.path) setInspectedEntry(null)
        reloadPane(pane)
      },
    })
  }

  const openEntry = (pane: PaneId, entry: FileEntry) => {
    if (entry.kind === 'folder') navigate(pane, entry.path)
    else setInspectedEntry(entry)
  }

  const canUpload = Boolean(selectedLocalEntries.some((entry) => entry.kind === 'file') && isConnected && remote.path)
  const canDownload = Boolean(selectedRemoteEntries.some((entry) => entry.kind === 'file') && local.path)
  const canCreateFolder = Boolean(focusedPane === 'local' ? local.path : (isConnected && remote.path))

  const fileMenu = (pane: PaneId, entry: FileEntry, event: MouseEvent) => {
    const paneSelections = pane === 'local' ? selectedLocalEntries : selectedRemoteEntries
    const targets = paneSelections.some((item) => item.name === entry.name) ? paneSelections : [entry]
    const items: MenuItem[] = targets.length > 1
      ? [
        pane === 'local'
          ? { label: `Yükle (${targets.filter((item) => item.kind === 'file').length})`, onSelect: () => enqueueMany(targets, 'upload'), disabled: !isConnected || !targets.some((item) => item.kind === 'file'), hint: 'Ctrl+U' }
          : { label: `İndir (${targets.filter((item) => item.kind === 'file').length})`, onSelect: () => enqueueMany(targets, 'download'), disabled: !targets.some((item) => item.kind === 'file'), hint: 'Ctrl+D' },
        { label: `Sil (${targets.length})`, onSelect: () => askDelete(pane, targets), danger: true, hint: 'Del' },
      ]
      : entry.kind === 'folder'
        ? [
          { label: 'Aç', onSelect: () => navigate(pane, entry.path), hint: 'Enter' },
          { label: 'Yeni klasör', onSelect: () => askCreateFolder(pane), hint: 'Ctrl+Shift+N' },
          { label: 'Yeniden adlandır', onSelect: () => askRename(pane, entry), hint: 'F2' },
          { label: 'Sil', onSelect: () => askDelete(pane, [entry]), danger: true, hint: 'Del' },
        ]
        : [
          { label: 'Detaylar', onSelect: () => setInspectedEntry(entry), hint: 'Enter' },
          pane === 'local'
            ? { label: 'Yükle', onSelect: () => enqueue(entry, 'upload'), disabled: !isConnected, hint: 'Ctrl+U' }
            : { label: 'İndir', onSelect: () => enqueue(entry, 'download'), hint: 'Ctrl+D' },
          { label: 'Yeni klasör', onSelect: () => askCreateFolder(pane), hint: 'Ctrl+Shift+N' },
          { label: 'Yeniden adlandır', onSelect: () => askRename(pane, entry), hint: 'F2' },
          { label: 'Yolu kopyala', onSelect: () => { void navigator.clipboard?.writeText(entry.path) } },
          { label: 'Sil', onSelect: () => askDelete(pane, [entry]), danger: true, hint: 'Del' },
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

  useKeyboardShortcuts((event) => {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (mod && key === 'l') {
      event.preventDefault()
      setEditSignal((current) => ({ ...current, [focusedPane]: current[focusedPane] + 1 }))
    } else if (mod && key === 'f') {
      event.preventDefault()
      document.getElementById('cg-search-input')?.focus()
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
      askDelete(focusedPane, focusedSelections)
    } else if (mod && key === 'u' && canUpload) {
      event.preventDefault()
      enqueueMany(selectedLocalEntries, 'upload')
    } else if (mod && key === 'd' && canDownload) {
      event.preventDefault()
      enqueueMany(selectedRemoteEntries, 'download')
    }
  }, dialog.open || Boolean(confirm) || Boolean(prompt) || Boolean(menu))

  // ---------------------------------------------------------------- görünüm
  const localPane = { ...local, visibleEntries: visibleLocal, editSignal: editSignal.local }
  const remotePane = { ...remote, visibleEntries: visibleRemote, editSignal: editSignal.remote }

  const canTerminal = Boolean(isConnected && activeConnection?.type === 'SFTP')

  return (
    <div className="cg-window">
      <TitleBar connection={isConnected ? activeConnection : null} theme={theme} onToggleTheme={toggleTheme} />
      <Toolbar
        focusedPane={focusedPane}
        canUpload={canUpload}
        canDownload={canDownload}
        canCreateFolder={canCreateFolder}
        canInspect={Boolean(focusedSelection && focusedSelection.kind === 'file')}
        canDelete={Boolean(focusedSelections.length)}
        canTerminal={canTerminal}
        terminalOpen={terminalOpen}
        query={query}
        bookmarksOpen={bookmarksOpen}
        onNewConnection={() => setDialog({ open: true })}
        onUpload={() => enqueueMany(selectedLocalEntries, 'upload')}
        onDownload={() => enqueueMany(selectedRemoteEntries, 'download')}
        onCreateFolder={() => askCreateFolder(focusedPane)}
        onRefresh={() => focusedDir.reload()}
        onDelete={() => askDelete(focusedPane, focusedSelections)}
        onInspect={() => focusedSelection && setInspectedEntry(focusedSelection)}
        onToggleTerminal={() => setTerminalOpen((open) => !open)}
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
            onSelect={(pane, names, primary) => {
              focusPane(pane)
              setSelection((current) => ({ ...current, [pane]: names }))
              if (inspectedEntry && primary?.kind === 'file') setInspectedEntry(primary)
            }}
            onOpen={openEntry}
            onNavigate={navigate}
            onConnect={(connection) => { void openConnection(connection) }}
            onNewConnection={() => setDialog({ open: true })}
            onContextMenu={fileMenu}
            onDropTransfer={(targetPane, names) => {
              if (targetPane === 'remote') {
                enqueueMany(local.entries.filter((entry) => names.includes(entry.name)), 'upload')
              } else {
                enqueueMany(remote.entries.filter((entry) => names.includes(entry.name)), 'download')
              }
            }}
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
      {terminalOpen && canTerminal && activeConnection && (
        <TerminalDrawer connection={activeConnection} theme={theme} onClose={() => setTerminalOpen(false)} />
      )}
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
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initialValue={prompt.initialValue}
          confirmLabel={prompt.confirmLabel}
          placeholder={prompt.placeholder}
          onConfirm={prompt.action}
          onClose={() => setPrompt(null)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

export default App
