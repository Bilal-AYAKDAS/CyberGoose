import type { TransferItem, TransferStatus } from '../types'
import { formatFileSize, formatRate } from '../utils/formatters'
import { queueSummary } from '../utils/status'
import { Icon } from './Icon'

type TransferQueueProps = {
  items: TransferItem[]
  open: boolean
  onToggle: () => void
  onUpdate: (id: string, status: TransferStatus) => void
  onRemove: (id: string) => void
  onClearCompleted: () => void
}

const barTone: Partial<Record<TransferStatus, string>> = {
  completed: 'is-ok',
  error: 'is-error',
  paused: 'is-paused',
  cancelled: 'is-paused',
}

function statusText(item: TransferItem): { text: string; tone: '' | 'ok' | 'error' | 'warn' } {
  switch (item.status) {
    case 'transferring': {
      const done = Math.round((item.size * item.progress) / 100)
      const remaining = item.rate ? Math.ceil((item.size - done) / item.rate) : null
      return { text: `${formatFileSize(done)} / ${formatFileSize(item.size)}${remaining !== null ? ` · ${remaining} sn kaldı` : ''}`, tone: '' }
    }
    case 'queued': return { text: 'Sırada', tone: '' }
    case 'paused': return { text: 'Duraklatıldı', tone: 'warn' }
    case 'completed': return { text: 'Tamamlandı', tone: 'ok' }
    case 'cancelled': return { text: 'İptal edildi', tone: 'warn' }
    case 'error': return { text: item.error ?? 'Aktarım başarısız', tone: 'error' }
  }
}

/**
 * Pencerenin altındaki aktarım çekmecesi. İlerleme çubuğu 4px; etkin = brand-beak,
 * tamamlanan = status-ok, duraklatılan = status-warn, hata = status-error. Hata varken kapanmaz.
 */
export function TransferQueue({ items, open, onToggle, onUpdate, onRemove, onClearCompleted }: TransferQueueProps) {
  const { active, queued, errors } = queueSummary(items)
  const lockedOpen = errors > 0
  const expanded = open || lockedOpen
  const hasFinished = items.some((item) => item.status === 'completed' || item.status === 'cancelled')

  return (
    <section className="cg-queue" aria-label="Transfer kuyruğu">
      <div className="cg-queue-head">
        <button
          className="cg-queue-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
          disabled={lockedOpen}
          title={lockedOpen ? 'Hata varken kuyruk açık kalır' : undefined}
        >
          <Icon name="transfer" />
          Aktarımlar <span className="count">{active} etkin</span> · {queued} sırada · {errors} hata
        </button>
        <span className="grow" />
        {expanded && hasFinished && <button className="cg-btn cg-btn-ghost" onClick={onClearCompleted}>Tamamlananları temizle</button>}
      </div>
      {expanded && (
        <div className="cg-queue-list">
          {!items.length && <p className="cg-help cg-queue-empty">Kuyrukta aktarım yok.</p>}
          {items.map((item) => {
            const status = statusText(item)
            return (
              <article className="cg-job" key={item.id} aria-label={item.name}>
                <Icon name={item.direction === 'upload' ? 'upload' : 'download'} />
                <div className="what">
                  <div className="file">{item.name}</div>
                  <div className="route">{item.from} → {item.to}</div>
                </div>
                <div>
                  <div
                    className={`cg-bar ${barTone[item.status] ?? ''}`}
                    role="progressbar"
                    aria-label={`${item.name} ilerlemesi`}
                    aria-valuenow={item.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: `${item.progress}%` }} />
                  </div>
                  <div className={`st ${status.tone}`} title={item.errorCode}>{status.text}</div>
                </div>
                <div className="rate">{item.status === 'transferring' ? formatRate(item.rate) : formatFileSize(item.size)}</div>
                <div className="actions">
                  {item.status === 'transferring' && <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={() => onUpdate(item.id, 'cancelled')}>İptal</button>}
                  {item.status === 'error' && <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={() => onUpdate(item.id, 'queued')}>Yeniden dene</button>}
                  {item.status !== 'transferring' && item.status !== 'error' && (
                    <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label={`${item.name} aktarımını kaldır`} title="Kaldır" onClick={() => onRemove(item.id)}>
                      <Icon name="close" />
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
