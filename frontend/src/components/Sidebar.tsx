import type { MouseEvent } from 'react'
import type { ConnectionProfile, ConnectionStatus } from '../types'
import { connectionAddress, isCloud } from '../utils/formatters'
import { connectionTone } from '../utils/status'
import { Icon } from './Icon'
import { StatusDot } from './ProtocolTag'

type SidebarProps = {
  homePath: string | null
  connections: ConnectionProfile[]
  activeConnectionId: string | null
  statusOf: (id: string) => ConnectionStatus
  loadError?: string | null
  onLocalSelect: () => void
  onConnectionSelect: (connection: ConnectionProfile) => void
  onConnectionMenu: (connection: ConnectionProfile, event: MouseEvent) => void
}

/**
 * Bağlantılar kenar çubuğu (ConnectionList): Yerel, Yer imleri, Bulut.
 * Grup başlıkları label stili, büyük harf yok. Etkin bağlantı: bg-raised + 2px brand-beak.
 * Parola ve anahtarlar hiçbir biçimde gösterilmez. Sağ tık: Bağlan, Düzenle, Sil.
 */
export function Sidebar({ homePath, connections, activeConnectionId, statusOf, loadError, onLocalSelect, onConnectionSelect, onConnectionMenu }: SidebarProps) {
  const servers = connections.filter((connection) => !isCloud(connection.type))
  const clouds = connections.filter((connection) => isCloud(connection.type))

  const renderConnection = (connection: ConnectionProfile) => {
    const active = connection.id === activeConnectionId
    const status = statusOf(connection.id)
    return (
      <li key={connection.id}>
        <button
          className={`cg-conn ${active ? 'is-active' : ''}`}
          aria-current={active ? 'true' : undefined}
          onClick={() => onConnectionSelect(connection)}
          onContextMenu={(event) => { event.preventDefault(); onConnectionMenu(connection, event) }}
        >
          <Icon name={isCloud(connection.type) ? 'cloud' : 'server'} />
          <span className="cg-conn-text">
            <span className="n">{connection.name}</span>
            <span className="h">{connectionAddress(connection, status)}</span>
          </span>
          <StatusDot tone={connectionTone(connection.type, status)} />
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
              <span className="h">{homePath ?? '—'}</span>
            </span>
            <span />
          </button>
        </li>
      </ul>
      <h6>Yer imleri</h6>
      <ul>{servers.map(renderConnection)}</ul>
      {!servers.length && <p className="cg-help cg-side-empty">{loadError ?? 'Kayıtlı sunucu yok. "Yeni bağlantı" ile ekleyin.'}</p>}
      <h6>Bulut</h6>
      <ul>{clouds.map(renderConnection)}</ul>
    </nav>
  )
}
