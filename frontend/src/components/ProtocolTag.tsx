import type { ConnectionProfile, ConnectionStatus } from '../types'
import { protocolLabel } from '../utils/formatters'
import { connectionTone, type DotTone } from '../utils/status'

export function StatusDot({ tone }: { tone: DotTone }) {
  return <i className={tone === 'muted' ? 'cg-dot' : `cg-dot cg-dot-${tone}`} aria-hidden="true" />
}

type ProtocolTagProps = { connection?: ConnectionProfile | null; status?: ConnectionStatus; local?: boolean }

/** Nötr mono etiket; Dropbox/Drive marka renkleri kullanılmaz, ayrım metinle yapılır. */
export function ProtocolTag({ connection, status = 'offline', local }: ProtocolTagProps) {
  if (local) return <span className="cg-tag">YEREL</span>
  if (!connection) return <span className="cg-tag"><StatusDot tone="muted" />UZAK</span>
  return (
    <span className="cg-tag">
      <StatusDot tone={connectionTone(connection.type, status)} />
      {protocolLabel(connection.type)}
    </span>
  )
}
