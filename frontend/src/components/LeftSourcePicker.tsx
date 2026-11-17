import type { ConnectionProfile } from '../types'
import { isCloud, protocolLabel } from '../utils/formatters'
import { StatusDot } from './ProtocolTag'

type LeftSourcePickerProps = {
  connections: ConnectionProfile[]
  /** 'local' ya da sol panelde açık bağlantının kimliği. */
  value: string
  busy?: boolean
  onChange: (value: string) => void
}

/** Sol panelin ne gösterdiğini seçer: bu bilgisayar ya da ikinci bir uzak bağlantı (uzaktan uzağa aktarım). */
export function LeftSourcePicker({ connections, value, busy, onChange }: LeftSourcePickerProps) {
  // Hızlı bağlantının parolası saklanmaz; ayarsız bulut hesapları bağlanamaz.
  const usable = connections.filter((item) => !item.quick && !(isCloud(item.type) && item.configured === false))
  const remote = value !== 'local'
  return (
    <span className="cg-tag cg-source">
      {remote && <StatusDot tone={busy ? 'warn' : 'ok'} />}
      <select
        className="cg-source-select"
        aria-label="Sol panel kaynağı"
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="local">YEREL</option>
        {usable.map((item) => (
          <option key={item.id} value={item.id}>{`${protocolLabel(item.type)} · ${item.name}`}</option>
        ))}
      </select>
    </span>
  )
}
