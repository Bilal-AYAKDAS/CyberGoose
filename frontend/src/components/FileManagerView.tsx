import { useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
  drives?: string[]
  connection: ConnectionProfile | null
  connectionStatus: ConnectionStatus
  focusedPane: PaneId
  selection: Record<PaneId, string[]>
  onFocusPane: (pane: PaneId) => void
  onSelect: (pane: PaneId, names: string[], primary?: FileEntry) => void
  onOpen: (pane: PaneId, entry: FileEntry) => void
  onNavigate: (pane: PaneId, path: string) => void
  onConnect: (connection: ConnectionProfile) => void
  onNewConnection: () => void
  onContextMenu: (pane: PaneId, entry: FileEntry, event: MouseEvent) => void
  /** Boş alana sağ tık (Yeni klasör, Yenile). */
  onBackgroundMenu?: (pane: PaneId, event: MouseEvent) => void
  /** Bir panelden ötekine sürüklenen öğeler. */
  onDropTransfer?: (targetPane: PaneId, names: string[]) => void
  /** Windows Gezgini'nden uzak panele bırakılan dosya ve klasörlerin yerel yolları. */
  onDropExternal?: (paths: string[]) => void
  onQuickConnect?: () => void
  /** Sol panel uzak bağlantıdaysa: etiket yerine kaynak seçici, kök adı ve tablo etiketi. */
  leftTag?: ReactNode
  leftRemoteLabel?: string
  leftRootLabel?: string
}

const DRAG_TYPE = 'application/x-cybergoose-transfer'

function readPaneDrop(event: DragEvent): { source: PaneId; names: string[] } | null {
  const raw = event.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as { source: PaneId; names: string[] }
    return Array.isArray(payload.names) && payload.names.length ? payload : null
  } catch {
    return null // Geçersiz sürükleme verisi yoksayılır.
  }
}

/** Electron'da bırakılan dosyaların gerçek yolu preload üzerinden alınır (tarayıcıda yoktur). */
function externalPaths(event: DragEvent): string[] {
  const resolve = window.cyberGoose?.pathForFile
  if (!resolve) return []
  return Array.from(event.dataTransfer.files).map((file) => resolve(file)).filter((path): path is string => Boolean(path))
}

const MIN_FRACTION = 0.25
const MAX_FRACTION = 0.75

/**
 * İki panelli düzen: yerel | 1px ayırıcı | uzak. Paneller eşit başlar, ayırıcı sürüklenebilir.
 * Kullanıcının hangi panelde olduğunu yalnızca yol çubuğunun 2px turuncu üst çizgisi
 * ve seçim tonu (bg-selected / bg-selected-inactive) söyler.
 */
export function FileManagerView(props: FileManagerViewProps) {
  const { local, remote, drives, connection, connectionStatus, focusedPane, selection, onFocusPane, onSelect, onOpen, onNavigate, onConnect, onNewConnection, onContextMenu, onBackgroundMenu, onDropTransfer, onDropExternal, onQuickConnect, leftTag, leftRemoteLabel, leftRootLabel } = props
  const [fraction, setFraction] = useState(0.5)
  const [dropTarget, setDropTarget] = useState<PaneId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRefs = useRef<Record<PaneId, HTMLElement | null>>({ local: null, remote: null })

  /** Tab: odağı diğer panelin seçili (ya da ilk) satırına taşır. Satır yoksa Tab normal çalışır. */
  const switchPane = (from: PaneId): boolean => {
    const target = from === 'local' ? 'remote' : 'local'
    const section = paneRefs.current[target]
    const row = section?.querySelector<HTMLElement>('tr[data-entry][tabindex="0"]') ?? section?.querySelector<HTMLElement>('tr[data-entry]')
    if (!row) return false
    onFocusPane(target)
    row.focus()
    return true
  }

  const paneEvents = (pane: PaneId) => ({
    onFocusCapture: () => onFocusPane(pane),
    onMouseDown: () => onFocusPane(pane),
    onContextMenu: (event: MouseEvent) => {
      // Satırın kendi menüsü varsayılanı zaten engeller; burada yalnızca boş alan kalır.
      if (event.defaultPrevented || !onBackgroundMenu) return
      event.preventDefault()
      onBackgroundMenu(pane, event)
    },
    onDragOver: (event: DragEvent) => {
      const fromPane = event.dataTransfer.types.includes(DRAG_TYPE)
      const fromExplorer = pane === 'remote' && event.dataTransfer.types.includes('Files') && Boolean(window.cyberGoose?.pathForFile)
      if (pane === 'remote' && connectionStatus !== 'connected') return
      if (!fromPane && !fromExplorer) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      if (dropTarget !== pane) setDropTarget(pane)
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
    },
    onDrop: (event: DragEvent) => {
      setDropTarget(null)
      if (pane === 'remote' && connectionStatus !== 'connected') return
      const payload = readPaneDrop(event)
      if (payload) {
        event.preventDefault()
        if (payload.source !== pane) onDropTransfer?.(pane, payload.names)
        return
      }
      if (pane === 'remote') {
        const paths = externalPaths(event)
        if (paths.length) {
          event.preventDefault()
          onDropExternal?.(paths)
        }
      }
    },
  })

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
          pane={pane}
          label={label}
          entries={data.visibleEntries}
          selected={selection[pane]}
          onSelect={(names, primary) => onSelect(pane, names, primary)}
          onOpen={(entry) => onOpen(pane, entry)}
          onOpenParent={data.parent ? () => onNavigate(pane, data.parent as string) : undefined}
          onContextMenu={(entry, event) => onContextMenu(pane, entry, event)}
          onTabOut={() => switchPane(pane)}
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
          <span className="cg-help">Kenar çubuğundan bir bağlantı seçin, yeni bir tane ekleyin ya da kaydetmeden hızlı bağlanın.</span>
          <span className="cg-empty-actions">
            {/* Hızlı bağlan çubuğu açıkken turuncu buton oradadır; burada ikinci bir primary olmaz. */}
            <button className={`cg-btn ${onQuickConnect ? 'cg-btn-primary' : ''}`} onClick={onNewConnection}>Yeni bağlantı</button>
            {onQuickConnect && <button className="cg-btn" onClick={onQuickConnect}>Hızlı bağlan</button>}
          </span>
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
        ref={(node) => { paneRefs.current.local = node }}
        className={`cg-pane ${focusedPane === 'local' ? 'is-focused' : ''} ${dropTarget === 'local' ? 'is-drop-target' : ''}`}
        aria-label={leftRemoteLabel ? `${leftRemoteLabel} paneli (sol)` : 'Yerel panel'}
        aria-busy={local.loading}
        {...paneEvents('local')}
      >
        <PathBar
          tag={leftTag ?? <ProtocolTag local />}
          crumbs={local.crumbs}
          rootLabel={leftRootLabel}
          path={local.path}
          drives={leftRemoteLabel ? undefined : drives}
          editSignal={local.editSignal}
          onNavigate={(path) => onNavigate('local', path)}
          onRefresh={local.reload}
        />
        {renderBody('local', local, leftRemoteLabel ? `${leftRemoteLabel} dosyaları` : 'Yerel dosyalar')}
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
        ref={(node) => { paneRefs.current.remote = node }}
        className={`cg-pane ${focusedPane === 'remote' ? 'is-focused' : ''} ${dropTarget === 'remote' ? 'is-drop-target' : ''}`}
        aria-label={connection ? `${connection.name} paneli` : 'Uzak panel'}
        aria-busy={remote.loading}
        {...paneEvents('remote')}
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
