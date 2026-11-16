import type { ConnectionProfile } from '../types'
import { protocolLabel } from '../utils/formatters'
import { connectionTone, type DotTone } from '../utils/status'

export function StatusDot({ tone }: { tone: DotTone }) {
  return <i className={tone === 'muted' ? 'cg-dot' : `cg-dot cg-dot-${tone}`} aria-hidden="true" />
}

type ProtocolTagProps = { connection?: ConnectionProfile; local?: boolean }

/** Nötr mono etiket; Dropbox/Drive marka renkleri kullanılmaz, ayrım metinle yapılır. */
export function ProtocolTag({ connection, local }: ProtocolTagProps) {
  if (local || !connection) return <span className="cg-tag">YEREL</span>
  return (
    <span className="cg-tag">
      <StatusDot tone={connectionTone(connection)} />
      {protocolLabel(connection.type)}
    </span>
  )
}
