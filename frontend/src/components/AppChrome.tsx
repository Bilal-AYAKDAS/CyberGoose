import type { Theme } from '../hooks/useTheme'
import type { ConnectionProfile, PaneId } from '../types'
import { formatFileSize, protocolLabel } from '../utils/formatters'
import { GooseMark } from './GooseMark'
import { Icon } from './Icon'

type TitleBarProps = {
  connection: ConnectionProfile | null
  theme: Theme
  onToggleTheme: () => void
}

/**
 * Başlık çubuğu (36px, bg-app). Electron'da sürüklenebilir alan; butonlar `no-drag`.
 * macOS trafik ışıkları ve Windows `titleBarOverlay` için yer CSS'te ayrılır.
 */
export function TitleBar({ connection, theme, onToggleTheme }: TitleBarProps) {
  const subtitle = connection
    ? `${connection.username ? `${connection.username}@` : ''}${connection.host}`
    : null
  return (
    <header className="cg-titlebar">
      <span className="brand"><GooseMark height={16} />CyberGoose</span>
      {subtitle && <span className="cg-titlebar-sub">— {subtitle}</span>}
      <span className="grow" />
      <button
        className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm cg-no-drag"
        aria-label="Tema değiştir"
        title={theme === 'dark' ? 'Paper temasına geç' : 'Graphite temasına geç'}
        onClick={onToggleTheme}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
    </header>
  )
}

type ToolbarProps = {
  focusedPane: PaneId
  canUpload: boolean
  canDownload: boolean
  canCreateFolder: boolean
  canInspect: boolean
  canDelete: boolean
  terminalOpen?: boolean
  query: string
  bookmarksOpen: boolean
  onNewConnection: () => void
  onUpload: () => void
  onDownload: () => void
  onCreateFolder: () => void
  onRefresh: () => void
  onInspect: () => void
  onDelete: () => void
  onOpenTerminal: () => void
  onOpenRdp: () => void
  onToggleBookmarks: () => void
  onQueryChange: (value: string) => void
}

/**
 * Ana araç çubuğu (40px, bg-raised). Görünümde tek primary buton vardır ve yönü odaktaki
 * panele göre değişir: yerel panel odaktaysa "Yükle", uzak panel odaktaysa "İndir".
 */
export function Toolbar(props: ToolbarProps) {
  const { focusedPane, canUpload, canDownload, canInspect, canDelete, query, bookmarksOpen } = props
  const uploadPrimary = focusedPane === 'local'
  return (
    <div className="cg-toolbar" role="toolbar" aria-label="Dosya işlemleri">
      <button className="cg-btn cg-btn-ghost" onClick={props.onNewConnection}><Icon name="server" />Yeni bağlantı</button>
      <span className="sep" />
      <button className={`cg-btn ${uploadPrimary ? 'cg-btn-primary' : ''}`} disabled={!canUpload} onClick={props.onUpload}><Icon name="upload" />Yükle</button>
      <button className={`cg-btn ${uploadPrimary ? '' : 'cg-btn-primary'}`} disabled={!canDownload} onClick={props.onDownload}><Icon name="download" />İndir</button>
      <span className="sep" />
      <button className="cg-btn cg-btn-icon cg-btn-ghost" aria-label="Yenile" title="Yenile" onClick={props.onRefresh}><Icon name="refresh" /></button>
      <button className="cg-btn cg-btn-icon cg-btn-ghost" aria-label="Yeni klasör" title="Yeni klasör (Ctrl+Shift+N)" disabled={!props.canCreateFolder} onClick={props.onCreateFolder}><Icon name="plus" /></button>
      <button className="cg-btn cg-btn-icon cg-btn-ghost" aria-label="Sil" title="Sil (Delete)" disabled={!canDelete} onClick={props.onDelete}><Icon name="trash" /></button>
      <button className="cg-btn cg-btn-icon cg-btn-ghost" aria-label="Detaylar" title="Detaylar (Enter)" disabled={!canInspect} onClick={props.onInspect}><Icon name="info" /></button>
      <span className="sep" />
      <button className="cg-btn cg-btn-ghost" aria-label="SSH Terminali" aria-pressed={props.terminalOpen} title="SSH Terminali (PuTTY)" onClick={props.onOpenTerminal}><Icon name="terminal" />Terminal</button>
      <button className="cg-btn cg-btn-ghost" aria-label="Uzak Masaüstü" title="Uzak Masaüstü (RDP)" onClick={props.onOpenRdp}><Icon name="monitor" />Uzak Masaüstü</button>
      <button className="cg-btn cg-btn-icon cg-btn-ghost" aria-label="Yer imleri" aria-pressed={bookmarksOpen} title="Yer imleri" onClick={props.onToggleBookmarks}><Icon name="bookmark" /></button>
      <span className="grow" />
      <label className="cg-search">
        <Icon name="search" />
        <input id="cg-search-input" aria-label="Bu klasörde ara" placeholder="Bu klasörde ara" value={query} onChange={(event) => props.onQueryChange(event.target.value)} />
      </label>
    </div>
  )
}

type StatusBarProps = {
  itemCount: number
  selectedCount: number
  selectedSize: number | null
  activeTransfer: string | null
  connection: ConnectionProfile | null
}

/** Durum çubuğu (24px, bg-app, caption). Sayılar mono. */
export function StatusBar({ itemCount, selectedCount, selectedSize, activeTransfer, connection }: StatusBarProps) {
  const security = connection?.type === 'FTP' ? 'bağlı · şifresiz' : 'bağlı'
  return (
    <footer className="cg-statusbar">
      <span>
        {itemCount} öğe · {selectedCount} seçili
        {selectedSize !== null && <> · <span className="cg-mono-xs">{formatFileSize(selectedSize)}</span></>}
      </span>
      <span className="grow" />
      {activeTransfer && <span className="cg-statusbar-transfer">Aktarılıyor: {activeTransfer}</span>}
      <span>{connection ? `${protocolLabel(connection.type)} · ${security}` : 'Bağlı değil'}</span>
    </footer>
  )
}
