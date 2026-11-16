import { useMemo, useState } from 'react'
import './styles/app.css'
import { StatusBar, TitleBar, Toolbar } from './components/AppChrome'
import { BookmarksPanel } from './components/BookmarksPanel'
import { ConnectionModal } from './components/ConnectionModal'
import { FileInspector } from './components/FileInspector'
import { FileManagerView } from './components/FileManagerView'
import { Sidebar } from './components/Sidebar'
import { TransferQueue } from './components/TransferQueue'
import { initialBookmarks, initialConnections, initialTransfers, LOCAL_ROOT, localEntries, remoteEntriesByConnection } from './data/sampleData'
import { useTheme } from './hooks/useTheme'
import type { ConnectionProfile, FileEntry, PaneId, TransferItem, TransferStatus } from './types'

type DialogState = { open: false } | { open: true; initial?: ConnectionProfile }

function matches(entry: FileEntry, query: string) {
  return entry.name.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'))
}

/**
 * Uygulama penceresi (tasarımdaki AppWindow):
 * başlık 36 · araç çubuğu 40 · [kenar çubuğu 220 | panel | 1px | panel] · transfer kuyruğu · durum 24.
 */
function App() {
  const { theme, toggleTheme } = useTheme()
  const [connections, setConnections] = useState(initialConnections)
  const [activeConnectionId, setActiveConnectionId] = useState(initialConnections[0].id)
  const [bookmarks] = useState(initialBookmarks)
  const [transfers, setTransfers] = useState<TransferItem[]>(initialTransfers)
  const [queueOpen, setQueueOpen] = useState(true)
  const [focusedPane, setFocusedPane] = useState<PaneId>('local')
  const [selection, setSelection] = useState<Record<PaneId, string | null>>({ local: null, remote: null })
  const [query, setQuery] = useState('')
  const [inspectedEntry, setInspectedEntry] = useState<FileEntry | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ open: false })
  const [bookmarksOpen, setBookmarksOpen] = useState(false)

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === activeConnectionId) ?? connections[0],
    [activeConnectionId, connections],
  )
  const remoteEntries = useMemo(() => remoteEntriesByConnection[activeConnection.id] ?? [], [activeConnection.id])

  // Arama yalnızca odaktaki paneli süzer ("Bu klasörde ara").
  const visibleLocal = useMemo(() => focusedPane === 'local' && query ? localEntries.filter((entry) => matches(entry, query)) : localEntries, [focusedPane, query])
  const visibleRemote = useMemo(() => focusedPane === 'remote' && query ? remoteEntries.filter((entry) => matches(entry, query)) : remoteEntries, [focusedPane, query, remoteEntries])

  const selectedLocal = localEntries.find((entry) => entry.name === selection.local) ?? null
  const selectedRemote = remoteEntries.find((entry) => entry.name === selection.remote) ?? null
  const focusedEntries = focusedPane === 'local' ? visibleLocal : visibleRemote
  const focusedSelection = focusedPane === 'local' ? selectedLocal : selectedRemote
  const isConnected = activeConnection.status === 'connected'
  const remoteLocation = `${activeConnection.host}:${activeConnection.path}`

  const focusPane = (pane: PaneId) => {
    if (pane !== focusedPane) setQuery('')
    setFocusedPane(pane)
  }

  const enqueue = (entry: FileEntry, direction: TransferItem['direction']) => {
    setTransfers((items) => [...items, {
      id: crypto.randomUUID(),
      name: entry.name,
      direction,
      from: direction === 'upload' ? LOCAL_ROOT : remoteLocation,
      to: direction === 'upload' ? remoteLocation : LOCAL_ROOT,
      size: entry.size ?? 0,
      progress: 0,
      status: 'queued',
    }])
    setQueueOpen(true)
  }

  const updateTransfer = (id: string, status: TransferStatus) => {
    setTransfers((items) => items.map((item) => item.id === id
      ? { ...item, status, rate: undefined, error: status === 'queued' ? undefined : item.error, progress: status === 'queued' ? 0 : item.progress }
      : item))
  }

  const saveConnection = (profile: ConnectionProfile) => {
    setConnections((items) => items.some((item) => item.id === profile.id)
      ? items.map((item) => item.id === profile.id ? profile : item)
      : [...items, profile])
    setActiveConnectionId(profile.id)
    setSelection((current) => ({ ...current, remote: null }))
  }

  const rate = transfers.filter((item) => item.status === 'transferring').reduce((sum, item) => sum + (item.rate ?? 0), 0)

  return (
    <div className="cg-window">
      <TitleBar connection={activeConnection} theme={theme} onToggleTheme={toggleTheme} />
      <Toolbar
        focusedPane={focusedPane}
        canUpload={Boolean(selectedLocal && selectedLocal.kind === 'file' && isConnected)}
        canDownload={Boolean(selectedRemote && selectedRemote.kind === 'file' && isConnected)}
        canInspect={Boolean(focusedSelection)}
        query={query}
        bookmarksOpen={bookmarksOpen}
        onNewConnection={() => setDialog({ open: true })}
        onUpload={() => selectedLocal && enqueue(selectedLocal, 'upload')}
        onDownload={() => selectedRemote && enqueue(selectedRemote, 'download')}
        onRefresh={() => setSelection({ local: null, remote: null })}
        onInspect={() => focusedSelection && setInspectedEntry(focusedSelection)}
        onToggleBookmarks={() => setBookmarksOpen((open) => !open)}
        onQueryChange={setQuery}
      />
      <div className="cg-main">
        <Sidebar
          localRoot={LOCAL_ROOT}
          connections={connections}
          activeConnectionId={activeConnection.id}
          onLocalSelect={() => focusPane('local')}
          onConnectionSelect={(id) => {
            setActiveConnectionId(id)
            setSelection((current) => ({ ...current, remote: null }))
            focusPane('remote')
          }}
        />
        <FileManagerView
          localRoot={LOCAL_ROOT}
          localEntries={visibleLocal}
          remoteEntries={visibleRemote}
          activeConnection={activeConnection}
          focusedPane={focusedPane}
          selection={selection}
          onFocusPane={focusPane}
          onSelect={(pane, entry) => {
            focusPane(pane)
            setSelection((current) => ({ ...current, [pane]: entry.name }))
            if (inspectedEntry) setInspectedEntry(entry)
          }}
          onOpen={setInspectedEntry}
          onRefresh={(pane) => setSelection((current) => ({ ...current, [pane]: null }))}
          onConnect={(connection) => setDialog({ open: true, initial: connection })}
        />
        {bookmarksOpen && (
          <BookmarksPanel
            bookmarks={bookmarks}
            connections={connections}
            onClose={() => setBookmarksOpen(false)}
            onSelect={(bookmark) => {
              setConnections((items) => items.map((item) => item.id === bookmark.connectionId ? { ...item, path: bookmark.path } : item))
              setActiveConnectionId(bookmark.connectionId)
              setSelection((current) => ({ ...current, remote: null }))
              focusPane('remote')
              setBookmarksOpen(false)
            }}
          />
        )}
        <FileInspector entry={inspectedEntry} onClose={() => setInspectedEntry(null)} />
      </div>
      <TransferQueue
        items={transfers}
        open={queueOpen}
        onToggle={() => setQueueOpen((open) => !open)}
        onUpdate={updateTransfer}
        onRemove={(id) => setTransfers((items) => items.filter((item) => item.id !== id))}
        onClearCompleted={() => setTransfers((items) => items.filter((item) => item.status !== 'completed' && item.status !== 'cancelled'))}
      />
      <StatusBar
        itemCount={focusedEntries.length}
        selectedCount={focusedSelection ? 1 : 0}
        selectedSize={focusedSelection?.kind === 'file' ? focusedSelection.size : null}
        rate={rate}
        connection={activeConnection}
      />
      {dialog.open && <ConnectionModal initial={dialog.initial} onClose={() => setDialog({ open: false })} onSaved={saveConnection} />}
    </div>
  )
}

export default App
