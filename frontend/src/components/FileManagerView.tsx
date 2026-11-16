import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ConnectionProfile, FileEntry, PaneId } from '../types'
import { splitPath } from '../utils/formatters'
import { FileTable } from './FileTable'
import { PathBar } from './PathBar'
import { ProtocolTag } from './ProtocolTag'

type FileManagerViewProps = {
  localRoot: string
  localEntries: FileEntry[]
  remoteEntries: FileEntry[]
  activeConnection: ConnectionProfile
  focusedPane: PaneId
  selection: Record<PaneId, string | null>
  onFocusPane: (pane: PaneId) => void
  onSelect: (pane: PaneId, entry: FileEntry) => void
  onOpen: (entry: FileEntry) => void
  onRefresh: (pane: PaneId) => void
  onConnect: (connection: ConnectionProfile) => void
}

const MIN_FRACTION = 0.25
const MAX_FRACTION = 0.75

/**
 * İki panelli düzen: yerel | 1px ayırıcı | uzak. Paneller eşit başlar, ayırıcı sürüklenebilir.
 * Kullanıcının hangi panelde olduğunu yalnızca yol çubuğunun 2px turuncu üst çizgisi
 * ve seçim tonu (bg-selected / bg-selected-inactive) söyler.
 */
export function FileManagerView(props: FileManagerViewProps) {
  const { localRoot, localEntries, remoteEntries, activeConnection, focusedPane, selection, onFocusPane, onSelect, onOpen, onRefresh, onConnect } = props
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

  const localSegments = splitPath(localRoot)
  const remoteSegments = splitPath(activeConnection.path)
  const remoteRoot = activeConnection.username ? `${activeConnection.username}@${activeConnection.host}` : activeConnection.host
  const isConnected = activeConnection.status === 'connected'

  return (
    <div
      ref={containerRef}
      className="cg-panes"
      style={{ gridTemplateColumns: `minmax(0, ${fraction}fr) 1px minmax(0, ${1 - fraction}fr)` }}
    >
      <section
        className={`cg-pane ${focusedPane === 'local' ? 'is-focused' : ''}`}
        aria-label="Yerel panel"
        onFocusCapture={() => onFocusPane('local')}
        onMouseDown={() => onFocusPane('local')}
      >
        <PathBar tag={<ProtocolTag local />} root={localSegments[0] ?? '~'} segments={localSegments.slice(1)} onRefresh={() => onRefresh('local')} />
        <FileTable label="Yerel dosyalar" entries={localEntries} selected={selection.local} onSelect={(entry) => onSelect('local', entry)} onOpen={onOpen} />
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
        aria-label={`${activeConnection.name} paneli`}
        onFocusCapture={() => onFocusPane('remote')}
        onMouseDown={() => onFocusPane('remote')}
      >
        <PathBar tag={<ProtocolTag connection={activeConnection} />} root={remoteRoot} segments={remoteSegments} onRefresh={isConnected ? () => onRefresh('remote') : undefined} />
        {isConnected
          ? <FileTable label={`${activeConnection.name} dosyaları`} entries={remoteEntries} selected={selection.remote} onSelect={(entry) => onSelect('remote', entry)} onOpen={onOpen} />
          : (
            <div className="cg-empty">
              <span className="cg-caption">{activeConnection.name} bağlı değil</span>
              <span className="cg-help">Dosyaları görmek için bağlanın.</span>
              <button className="cg-btn" onClick={() => onConnect(activeConnection)}>Bağlan</button>
            </div>
          )}
      </section>
    </div>
  )
}
