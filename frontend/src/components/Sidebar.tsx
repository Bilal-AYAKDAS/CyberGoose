import type { ConnectionProfile } from '../types'
import { connectionAddress, isCloud } from '../utils/formatters'
import { Icon } from './Icon'
import { connectionTone } from '../utils/status'
import { StatusDot } from './ProtocolTag'

type SidebarProps = {
  localRoot: string
  connections: ConnectionProfile[]
  activeConnectionId: string
  onLocalSelect: () => void
  onConnectionSelect: (id: string) => void
}

/**
 * Bağlantılar kenar çubuğu (ConnectionList): Yerel, Yer imleri, Bulut.
 * Grup başlıkları label stili, büyük harf yok. Etkin bağlantı: bg-raised + 2px brand-beak.
 * Parola ve anahtarlar hiçbir biçimde gösterilmez.
 */
export function Sidebar({ localRoot, connections, activeConnectionId, onLocalSelect, onConnectionSelect }: SidebarProps) {
  const servers = connections.filter((connection) => !isCloud(connection.type))
  const clouds = connections.filter((connection) => isCloud(connection.type))

  const renderConnection = (connection: ConnectionProfile) => {
    const active = connection.id === activeConnectionId
    return (
      <li key={connection.id}>
        <button
          className={`cg-conn ${active ? 'is-active' : ''}`}
          aria-current={active ? 'true' : undefined}
          onClick={() => onConnectionSelect(connection.id)}
        >
          <Icon name={isCloud(connection.type) ? 'cloud' : 'server'} />
          <span className="cg-conn-text">
            <span className="n">{connection.name}</span>
            <span className="h">{connectionAddress(connection)}</span>
          </span>
          <StatusDot tone={connectionTone(connection)} />
        </button>
      </li>
    )
  }

  return (
    <nav className="cg-side" aria-label="Bağlantılar">
      <h6>Yerel</h6>
      <ul>
        <li>
          <button className="cg-conn" onClick={onLocalSelect}>
            <Icon name="home" />
            <span className="cg-conn-text">
              <span className="n">Ev klasörü</span>
              <span className="h">{localRoot}</span>
            </span>
            <span />
          </button>
        </li>
      </ul>
      <h6>Yer imleri</h6>
      <ul>{servers.map(renderConnection)}</ul>
      {!servers.length && <p className="cg-help cg-side-empty">Kayıtlı sunucu yok.</p>}
      <h6>Bulut</h6>
      <ul>{clouds.map(renderConnection)}</ul>
    </nav>
  )
}
