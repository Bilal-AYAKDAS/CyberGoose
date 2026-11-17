import { useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import type { ConnectionProfile, ConnectionStatus, FolderBookmark } from '../types'
import { connectionAddress, isCloud } from '../utils/formatters'
import { connectionTone } from '../utils/status'
import { groupServers } from '../utils/groups'
import { Icon } from './Icon'
import { StatusDot } from './ProtocolTag'

type SidebarProps = {
  homePath: string | null
  connections: ConnectionProfile[]
  bookmarks: FolderBookmark[]
  activeConnectionId: string | null
  statusOf: (id: string) => ConnectionStatus
  loadError?: string | null
  onLocalSelect: () => void
  onConnectionSelect: (connection: ConnectionProfile) => void
  onConnectionMenu: (connection: ConnectionProfile, event: MouseEvent) => void
  onBookmarkSelect: (bookmark: FolderBookmark) => void
  onManageBookmarks: () => void
  /** FileZilla sitemanager.xml içeriğini içe aktarır. */
  onImportFileZilla?: (xml: string) => void
}


const MAX_SIDEBAR_BOOKMARKS = 8

/** File.text() her ortamda yok (ör. jsdom); FileReader her yerde çalışır. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Dosya okunamadı'))
    reader.readAsText(file)
  })
}

/**
 * Kenar çubuğu: Yerel · Sunucular · Klasör yer imleri · Bulut.
 * Grup başlıkları label stili, büyük harf yok. Etkin bağlantı: bg-raised + 2px brand-beak.
 * Ayarlanmamış bulut hesabı soluk görünür ve tıklanınca nasıl ayarlanacağını söyler.
 * Parola ve anahtarlar hiçbir biçimde gösterilmez.
 */
export function Sidebar(props: SidebarProps) {
  const { homePath, connections, bookmarks, activeConnectionId, statusOf, loadError, onLocalSelect, onConnectionSelect, onConnectionMenu, onBookmarkSelect, onManageBookmarks, onImportFileZilla } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)

  const toggleGroup = (group: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    return next
  })

  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file && onImportFileZilla) onImportFileZilla(await readFileText(file))
  }
  const servers = connections.filter((connection) => !isCloud(connection.type))
  const clouds = connections.filter((connection) => isCloud(connection.type))
  const visibleBookmarks = bookmarks.slice(0, MAX_SIDEBAR_BOOKMARKS)

  const renderConnection = (connection: ConnectionProfile) => {
    const active = connection.id === activeConnectionId
    const status = statusOf(connection.id)
    const unconfigured = connection.configured === false
    const address = unconfigured ? 'Ayarlanmadı' : connection.quick ? `${connectionAddress(connection, status)} · kaydedilmedi` : connectionAddress(connection, status)
    return (
      <li key={connection.id}>
        <button
          className={`cg-conn ${active ? 'is-active' : ''} ${unconfigured ? 'is-unconfigured' : ''}`}
          aria-current={active ? 'true' : undefined}
          title={unconfigured ? `${connection.name} ayarlanmadı. Tıklayınca nasıl ayarlanacağı gösterilir.` : undefined}
          onClick={() => onConnectionSelect(connection)}
          onContextMenu={(event) => { event.preventDefault(); onConnectionMenu(connection, event) }}
        >
          <Icon name={isCloud(connection.type) ? 'cloud' : connection.quick ? 'bolt' : 'server'} />
          <span className="cg-conn-text">
            <span className="n">{connection.name}</span>
            <span className="h">{address}</span>
          </span>
          {unconfigured ? <span className="cg-conn-action">Ayarla</span> : <StatusDot tone={connectionTone(connection.type, status)} />}
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
      <div className="cg-side-head">
        <h6>Sunucular</h6>
        {onImportFileZilla && (
          <>
            <button className="cg-btn cg-btn-ghost cg-btn-sm" title="FileZilla Site Yöneticisi dosyasını (sitemanager.xml) içe aktar" onClick={() => fileInput.current?.click()}>İçe aktar</button>
            <input ref={fileInput} type="file" accept=".xml,text/xml" hidden aria-label="FileZilla dosyası seç" onChange={(event) => { void readImport(event) }} />
          </>
        )}
      </div>
      {groupServers(servers).map(([group, members]) => (
        group === ''
          ? <ul key="__ungrouped">{members.map(renderConnection)}</ul>
          : (
            <div key={group} className="cg-side-group">
              <button className="cg-side-group-head" aria-expanded={!collapsed.has(group)} onClick={() => toggleGroup(group)}>
                <Icon name="chevron-right" size={12} className={collapsed.has(group) ? undefined : 'is-open'} />
                <span>{group}</span>
                <span className="cg-side-count">{members.length}</span>
              </button>
              {!collapsed.has(group) && <ul>{members.map(renderConnection)}</ul>}
            </div>
          )
      ))}
      {!servers.length && <p className="cg-help cg-side-empty">{loadError ?? 'Kayıtlı sunucu yok. "Yeni bağlantı" ile ekleyin.'}</p>}
      <div className="cg-side-head">
        <h6>Klasör yer imleri</h6>
        <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Yer imlerini yönet" title="Yer imlerini yönet" onClick={onManageBookmarks}>
          <Icon name="bookmark" size={14} />
        </button>
      </div>
      <ul>
        {visibleBookmarks.map((bookmark) => {
          const owner = bookmark.connectionId === null ? null : connections.find((item) => item.id === String(bookmark.connectionId))
          return (
            <li key={bookmark.id}>
              <button className="cg-conn" title={bookmark.path} onClick={() => onBookmarkSelect(bookmark)}>
                <Icon name="folder" className="is-dir" />
                <span className="cg-conn-text">
                  <span className="n">{bookmark.name}</span>
                  <span className="h">{owner ? owner.name : 'Yerel'} · {bookmark.path}</span>
                </span>
                <span />
              </button>
            </li>
          )
        })}
      </ul>
      {!bookmarks.length && <p className="cg-help cg-side-empty">Sık kullandığınız klasörü yer imi çubuğundan ekleyin.</p>}
      {bookmarks.length > MAX_SIDEBAR_BOOKMARKS && (
        <button className="cg-btn cg-btn-ghost cg-btn-sm cg-side-more" onClick={onManageBookmarks}>Tümünü göster ({bookmarks.length})</button>
      )}
      <h6>Bulut</h6>
      <ul>{clouds.map(renderConnection)}</ul>
    </nav>
  )
}
