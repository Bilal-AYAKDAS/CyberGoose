import { useMemo, useState } from 'react'
import './styles/app.css'
import { BookmarksPanel } from './components/BookmarksPanel'
import { ConnectionModal } from './components/ConnectionModal'
import { FileInspector } from './components/FileInspector'
import { FileManagerView } from './components/FileManagerView'
import { Sidebar } from './components/Sidebar'
import { TransferQueue } from './components/TransferQueue'
import { useTheme } from './hooks/useTheme'
import type { Bookmark, ConnectionProfile, FileEntry, TransferItem, TransferStatus } from './types'

const initialConnections: ConnectionProfile[] = [
  { id: 'local', name: 'Yerel bilgisayar', type: 'SFTP', host: 'localhost', port: '22', username: '', path: '/', status: 'connected' },
  { id: 'production', name: 'Üretim sunucusu', type: 'SFTP', host: 'server.cybergoose.com', port: '22', username: 'deploy', path: '/var/www', status: 'connected' },
  { id: 'drive', name: 'Google Drive', type: 'GoogleDrive', host: 'drive.google.com', port: '', username: '', path: '/', status: 'offline' },
]

const initialBookmarks: Bookmark[] = [
  { id: 'bookmark-production', name: 'Üretim web kökü', connectionId: 'production', path: '/var/www', type: 'directory' },
  { id: 'bookmark-backups', name: 'Günlük yedekler', connectionId: 'production', path: '/var/www/backups', type: 'directory' },
  { id: 'bookmark-drive', name: 'Drive ana dizini', connectionId: 'drive', path: '/', type: 'connection' },
]

const initialTransfers: TransferItem[] = [
  { id: 'transfer-1', name: 'deploy.zip', direction: 'upload', size: '28 MB', progress: 68, status: 'transferring' },
  { id: 'transfer-2', name: 'README.md', direction: 'download', size: '3 KB', progress: 100, status: 'completed' },
  { id: 'transfer-3', name: 'backup.tar.gz', direction: 'download', size: '642 MB', progress: 0, status: 'queued' },
  { id: 'transfer-4', name: 'config.json', direction: 'upload', size: '12 KB', progress: 34, status: 'error', error: 'Bağlantı koptu' },
]

function App() {
  const { theme, toggleTheme } = useTheme()
  const [activeView, setActiveView] = useState<'files' | 'bookmarks' | 'transfers'>('files')
  const [connections, setConnections] = useState(initialConnections)
  const [activeConnectionId, setActiveConnectionId] = useState('production')
  const [bookmarks] = useState(initialBookmarks)
  const [transfers, setTransfers] = useState(initialTransfers)
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showTransfers, setShowTransfers] = useState(false)
  const [inspectedEntry, setInspectedEntry] = useState<FileEntry | null>(null)
  const activeConnection = useMemo(() => connections.find((connection) => connection.id === activeConnectionId) ?? connections[0], [activeConnectionId, connections])

  const updateTransfer = (id: string, status: TransferStatus) => {
    setTransfers((items) => items.map((item) => item.id === id ? { ...item, status, progress: status === 'queued' ? 0 : item.progress } : item))
  }

  const changeView = (view: 'files' | 'bookmarks' | 'transfers') => {
    setActiveView(view)
    setShowBookmarks(view === 'bookmarks')
    setShowTransfers(view === 'transfers')
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">C</div><div><strong>cybergoose</strong><span>secure file operations</span></div></div><div className="top-actions"><button className="icon-button" aria-label="Tema değiştir" onClick={toggleTheme}>{theme === 'dark' ? '☼' : '◐'}</button><button className="avatar" aria-label="Kullanıcı menüsü">BA</button></div></header>
    <div className="workspace">
      <Sidebar activeView={activeView} onViewChange={changeView} connections={connections} activeConnectionId={activeConnectionId} onConnectionSelect={(id) => { setActiveConnectionId(id); setActiveView('files') }} onAddConnection={() => setShowConnectionModal(true)} />
      {activeView === 'files' && <FileManagerView activeConnection={activeConnection} onOpenInspector={setInspectedEntry} onAddConnection={() => setShowConnectionModal(true)} />}
      {activeView === 'bookmarks' && <section className="content empty-view"><div className="content-heading"><div><div className="eyebrow">KAYITLI KONUMLAR</div><h1>Yer imleri</h1><p>Sık kullandığınız bağlantı ve dizinlere hızlı erişin.</p></div></div></section>}
      {activeView === 'transfers' && <section className="content empty-view"><div className="content-heading"><div><div className="eyebrow">İŞLEM GEÇMİŞİ</div><h1>Aktarımlar</h1><p>Dosya transferlerini takip edin ve yönetin.</p></div></div></section>}
    </div>
    {showConnectionModal && <ConnectionModal onClose={() => setShowConnectionModal(false)} onSaved={(profile) => setConnections((items) => [...items, profile])} />}
    {showBookmarks && <BookmarksPanel bookmarks={bookmarks} connections={connections} onClose={() => { setShowBookmarks(false); setActiveView('files') }} onSelect={(bookmark) => { setActiveConnectionId(bookmark.connectionId); setShowBookmarks(false); setActiveView('files') }} />}
    {showTransfers && <TransferQueue items={transfers} onUpdate={updateTransfer} onClose={() => { setShowTransfers(false); setActiveView('files') }} />}
    <FileInspector entry={inspectedEntry} onClose={() => setInspectedEntry(null)} />
  </main>
}

export default App
