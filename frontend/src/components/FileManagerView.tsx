import { useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { DirectoryState } from '../hooks/useDirectory'
import type { ConnectionProfile, ConnectionStatus, FileEntry, PaneId } from '../types'
import { connectionLabel } from '../utils/formatters'
import { FileTable } from './FileTable'
import { Notice } from './Notice'
import { PathBar } from './PathBar'
import { ProtocolTag } from './ProtocolTag'

export type PaneData = DirectoryState & {
  reload: () => void
  /** Kullanıcının süzdüğü (arama) liste. */
  visibleEntries: FileEntry[]
  editSignal: number
}

type FileManagerViewProps = {
  local: PaneData
  remote: PaneData
  connection: ConnectionProfile | null
  connectionStatus: ConnectionStatus
  focusedPane: PaneId
  selection: Record<PaneId, string | null>
  onFocusPane: (pane: PaneId) => void
  onSelect: (pane: PaneId, entry: FileEntry) => void
  onOpen: (pane: PaneId, entry: FileEntry) => void
  onNavigate: (pane: PaneId, path: string) => void
  onConnect: (connection: ConnectionProfile) => void
  onNewConnection: () => void
  onContextMenu: (pane: PaneId, entry: FileEntry, event: MouseEvent) => void
}

const MIN_FRACTION = 0.25
const MAX_FRACTION = 0.75

/**
 * İki panelli düzen: yerel | 1px ayırıcı | uzak. Paneller eşit başlar, ayırıcı sürüklenebilir.
 * Kullanıcının hangi panelde olduğunu yalnızca yol çubuğunun 2px turuncu üst çizgisi
 * ve seçim tonu (bg-selected / bg-selected-inactive) söyler.
 */
export function FileManagerView(props: FileManagerViewProps) {
  const { local, remote, connection, connectionStatus, focusedPane, selection, onFocusPane, onSelect, onOpen, onNavigate, onConnect, onNewConnection, onContextMenu } = props
  const [fraction, setFraction] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    event.preventDefault()
    const rect = container.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) => {
      const next = (moveEvent.clientX - rect.left) / rect.width
      setFraction(Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, next)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const renderBody = (pane: PaneId, data: PaneData, label: string) => {
    if (data.error && !data.entries.length) {
      return (
        <div className="cg-pane-message">
          <Notice tone="error" title={data.error.message} action={<button className="cg-btn" onClick={data.reload}>Yeniden dene</button>} />
        </div>
      )
    }
    if (data.loading && data.path === null) {
      return <div className="cg-empty"><span className="cg-caption">Yükleniyor</span></div>
    }
    return (
      <>
        {data.error && (
          <div className="cg-pane-message">
            <Notice tone="error" title={data.error.message} />
          </div>
        )}
        <FileTable
          label={label}
          entries={data.visibleEntries}
          selected={selection[pane]}
          onSelect={(entry) => onSelect(pane, entry)}
          onOpen={(entry) => onOpen(pane, entry)}
          onOpenParent={data.parent ? () => onNavigate(pane, data.parent as string) : undefined}
          onContextMenu={(entry, event) => onContextMenu(pane, entry, event)}
          emptyText={data.entries.length ? 'Aramayla eşleşen öğe yok' : 'Bu klasör boş'}
        />
      </>
    )
  }

  const renderRemote = () => {
    if (!connection) {
      return (
        <div className="cg-empty">
          <span className="cg-display">Henüz bağlantı yok</span>
          <span className="cg-help">Kenar çubuğundan bir bağlantı seçin ya da yeni bir tane ekleyin.</span>
          <button className="cg-btn cg-btn-primary" onClick={onNewConnection}>Yeni bağlantı</button>
        </div>
      )
    }
    if (connectionStatus !== 'connected') {
      return (
        <div className="cg-empty">
          <span className="cg-caption">{connectionStatus === 'connecting' ? `${connection.name} bağlanıyor` : `${connection.name} bağlı değil`}</span>
          {connectionStatus !== 'connecting' && <button className="cg-btn" onClick={() => onConnect(connection)}>Bağlan</button>}
        </div>
      )
    }
    return renderBody('remote', remote, `${connection.name} dosyaları`)
  }

  return (
    <div
      ref={containerRef}
      className="cg-panes"
      style={{ gridTemplateColumns: `minmax(0, ${fraction}fr) 1px minmax(0, ${1 - fraction}fr)` }}
    >
      <section
        className={`cg-pane ${focusedPane === 'local' ? 'is-focused' : ''}`}
        aria-label="Yerel panel"
        aria-busy={local.loading}
        onFocusCapture={() => onFocusPane('local')}
        onMouseDown={() => onFocusPane('local')}
      >
        <PathBar
          tag={<ProtocolTag local />}
          crumbs={local.crumbs}
          path={local.path}
          editSignal={local.editSignal}
          onNavigate={(path) => onNavigate('local', path)}
          onRefresh={local.reload}
        />
        {renderBody('local', local, 'Yerel dosyalar')}
      </section>

      <div
        className="cg-split"
        role="separator"
        aria-orientation="vertical"
        aria-label="Panelleri yeniden boyutlandır"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={MIN_FRACTION * 100}
        aria-valuemax={MAX_FRACTION * 100}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => setFraction(0.5)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setFraction((value) => Math.max(MIN_FRACTION, value - 0.05))
          if (event.key === 'ArrowRight') setFraction((value) => Math.min(MAX_FRACTION, value + 0.05))
        }}
      />

      <section
        className={`cg-pane ${focusedPane === 'remote' ? 'is-focused' : ''}`}
        aria-label={connection ? `${connection.name} paneli` : 'Uzak panel'}
        aria-busy={remote.loading}
        onFocusCapture={() => onFocusPane('remote')}
        onMouseDown={() => onFocusPane('remote')}
      >
        <PathBar
          tag={<ProtocolTag connection={connection} status={connectionStatus} />}
          crumbs={connectionStatus === 'connected' ? remote.crumbs : []}
          rootLabel={connection ? connectionLabel(connection) : undefined}
          path={connectionStatus === 'connected' ? remote.path : null}
          editSignal={remote.editSignal}
          onNavigate={connectionStatus === 'connected' ? (path) => onNavigate('remote', path) : undefined}
          onRefresh={connectionStatus === 'connected' ? remote.reload : undefined}
        />
        {renderRemote()}
      </section>
    </div>
  )
}
