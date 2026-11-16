import type { ConnectionProfile } from '../types'

type SidebarProps = {
  activeView: 'files' | 'bookmarks' | 'transfers'
  onViewChange: (view: 'files' | 'bookmarks' | 'transfers') => void
  connections: ConnectionProfile[]
  activeConnectionId: string
  onConnectionSelect: (id: string) => void
  onAddConnection: () => void
}

export function Sidebar({ activeView, onViewChange, connections, activeConnectionId, onConnectionSelect, onAddConnection }: SidebarProps) {
  return <aside className="sidebar">
    <div className="sidebar-title">Çalışma alanı</div>
    <button className={`nav-item ${activeView === 'files' ? 'active' : ''}`} onClick={() => onViewChange('files')}><span>▦</span> Dosya yöneticisi</button>
    <button className={`nav-item ${activeView === 'bookmarks' ? 'active' : ''}`} onClick={() => onViewChange('bookmarks')}><span>★</span> Yer imleri</button>
    <button className={`nav-item ${activeView === 'transfers' ? 'active' : ''}`} onClick={() => onViewChange('transfers')}><span>↻</span> Aktarımlar</button>
    <div className="sidebar-title connections-title">Bağlantılar <button onClick={onAddConnection} aria-label="Bağlantı ekle">+</button></div>
    {connections.map((connection) => <button className={`connection-item ${connection.id === activeConnectionId ? 'active' : ''}`} key={connection.id} onClick={() => onConnectionSelect(connection.id)}><i className={`status-dot ${connection.status === 'connected' ? 'online' : ''}`} />{connection.name}<small>{connection.type}</small></button>)}
    <button className="add-connection" onClick={onAddConnection}>+ Yeni bağlantı</button>
    <div className="sidebar-footer">v0.1.0 · React + Electron</div>
  </aside>
}
