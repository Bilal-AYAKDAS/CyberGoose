import { useMemo, useState } from 'react'
import type { ConnectionProfile, FileEntry } from '../types'
import { FileTable } from './FileTable'

const localEntries: FileEntry[] = [
  { name: 'Belgeler', kind: 'folder', size: '--', modified: 'Bugün, 14:32', path: 'C:/Users/Bilal/Belgeler' },
  { name: 'Projeler', kind: 'folder', size: '--', modified: 'Dün, 09:18', path: 'C:/Users/Bilal/Projeler' },
  { name: 'README.md', kind: 'file', size: '3 KB', modified: '16 Kas 2026', path: 'C:/Users/Bilal/README.md', permissions: '0644', hash: '8b1a9953c4611296' , preview: '# CyberGoose\n\nSecure file operations.' },
  { name: 'rapor.pdf', kind: 'file', size: '1.2 MB', modified: '15 Kas 2026', path: 'C:/Users/Bilal/rapor.pdf', permissions: '0644' },
]

const remoteEntries: FileEntry[] = [
  { name: 'backups', kind: 'folder', size: '--', modified: 'Bugün, 10:11', path: '/var/www/backups' },
  { name: 'public', kind: 'folder', size: '--', modified: '12 Kas 2026', path: '/var/www/public' },
  { name: 'deploy.zip', kind: 'file', size: '28 MB', modified: '11 Kas 2026', path: '/var/www/deploy.zip', permissions: '0644', hash: 'f4c3b00f8b5a' },
]

type FileManagerViewProps = {
  activeConnection: ConnectionProfile
  onOpenInspector: (entry: FileEntry) => void
  onAddConnection: () => void
}

export function FileManagerView({ activeConnection, onOpenInspector, onAddConnection }: FileManagerViewProps) {
  const [selectedLocal, setSelectedLocal] = useState<FileEntry | null>(null)
  const [selectedRemote, setSelectedRemote] = useState<FileEntry | null>(null)
  const [query, setQuery] = useState('')
  const localFiltered = useMemo(() => localEntries.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())), [query])
  const remoteFiltered = useMemo(() => remoteEntries.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())), [query])

  const selectLocal = (entry: FileEntry) => {
    setSelectedLocal(entry)
    onOpenInspector(entry)
  }
  const selectRemote = (entry: FileEntry) => {
    setSelectedRemote(entry)
    onOpenInspector(entry)
  }

  return <section className="content">
    <div className="content-heading"><div><div className="eyebrow">DOSYA YÖNETİCİSİ</div><h1>Dosyalar</h1><p>Bağlantılarınızdaki dosyaları güvenle yönetin.</p></div><button className="primary-button" onClick={onAddConnection}>+ Bağlantı ekle</button></div>
    <div className="toolbar"><button>↑ Yükle</button><button>↓ İndir</button><button>↻ Yenile</button><span className="toolbar-spacer" /><label className="search"><span>⌕</span><input aria-label="Dosyalarda ara" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dosyalarda ara..." /></label></div>
    <div className="breadcrumbs"><span>⌂</span><b> / </b><span>CyberGoose</span><b> / </b><strong>{activeConnection.name}</strong></div>
    <div className="panels">
      <section className="file-panel"><div className="panel-heading"><div><span className="panel-icon local">▣</span><div><h2>Yerel bilgisayar</h2><span className="mono-text">C:\Users\Bilal</span></div></div><button aria-label="Yerel panel menüsü">•••</button></div><FileTable entries={localFiltered} selected={selectedLocal?.name ?? null} onSelect={selectLocal} /><div className="panel-footer">{localFiltered.length} öğe <span>Boş alan: 124 GB</span></div></section>
      <div className="transfer-divider"><button title="Seçili dosyayı sağa aktar">→</button><button title="Seçili dosyayı sola aktar">←</button></div>
      <section className="file-panel"><div className="panel-heading"><div><span className="panel-icon remote">⌁</span><div><h2>{activeConnection.name}</h2><span className="mono-text">{activeConnection.type.toLowerCase()}://{activeConnection.host}</span></div></div><button aria-label="Uzak panel menüsü">•••</button></div><FileTable entries={remoteFiltered} selected={selectedRemote?.name ?? null} onSelect={selectRemote} /><div className="panel-footer">{remoteFiltered.length} öğe <span className="connected"><i className="status-dot online" /> Bağlı</span></div></section>
    </div>
    <div className="activity"><div><span className="activity-icon">✓</span><div><strong>Aktarım kuyruğu hazır</strong><span>Dosyaları paneller arasında seçip aktarın.</span></div></div><span className="mono-text">2 panel açık</span></div>
  </section>
}
