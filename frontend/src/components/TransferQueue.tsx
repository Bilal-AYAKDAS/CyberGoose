import type { TransferItem } from '../types'
import { durationText, formatFileSize, formatRate } from '../utils/formatters'
import { queueSummary } from '../utils/status'
import { Icon } from './Icon'

type TransferQueueProps = {
  items: TransferItem[]
  open: boolean
  onToggle: () => void
  onRetry: (id: string, overwrite?: boolean) => void
  onCancel?: (id: string) => void
  onRemove: (id: string) => void
  onClearFinished: () => void
}

const barTone: Partial<Record<TransferItem['status'], string>> = {
  completed: 'is-ok',
  error: 'is-error',
  cancelled: 'is-paused',
}

function progressOf(item: TransferItem): number {
  if (item.status === 'completed') return 100
  if (item.status === 'transferring' && item.size && item.size > 0 && item.transferred !== undefined) {
    return Math.min(100, Math.round((item.transferred / item.size) * 100))
  }
  return 0
}

function statusText(item: TransferItem): { text: string; tone: '' | 'ok' | 'error' | 'warn' } {
  switch (item.status) {
    case 'transferring': {
      const pct = progressOf(item)
      return { text: item.size && item.transferred !== undefined ? `Aktarılıyor · %${pct}` : 'Aktarılıyor', tone: '' }
    }
    case 'queued': return { text: 'Sırada', tone: '' }
    case 'cancelled': return { text: 'İptal edildi', tone: 'warn' }
    case 'completed': {
      const elapsed = item.startedAt && item.finishedAt ? item.finishedAt - item.startedAt : null
      return { text: elapsed ? `Tamamlandı · ${durationText(elapsed)}` : 'Tamamlandı', tone: 'ok' }
    }
    case 'error': return { text: item.error ?? 'Aktarım başarısız', tone: item.errorCode === 'exists' ? 'warn' : 'error' }
  }
}

function rateText(item: TransferItem): string {
  if (item.status === 'completed' && item.size && item.startedAt && item.finishedAt && item.finishedAt > item.startedAt) {
    return formatRate((item.size * 1000) / (item.finishedAt - item.startedAt))
  }
  if (item.status === 'transferring' && item.transferred && item.startedAt) {
    const elapsed = Date.now() - item.startedAt
    if (elapsed > 250) return formatRate((item.transferred * 1000) / elapsed)
  }
  return formatFileSize(item.size)
}

export function TransferQueue({ items, open, onToggle, onRetry, onCancel, onRemove, onClearFinished }: TransferQueueProps) {
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
        {expanded && hasFinished && <button className="cg-btn cg-btn-ghost" onClick={onClearFinished}>Tamamlananları temizle</button>}
      </div>
      {expanded && (
        <div className="cg-queue-list">
          {!items.length && <p className="cg-help cg-queue-empty">Kuyrukta aktarım yok. Bir dosya seçip Yükle veya İndir'e basın.</p>}
          {items.map((item) => {
            const status = statusText(item)
            return (
              <article className="cg-job" key={item.id} aria-label={item.name}>
                <Icon name={item.direction === 'upload' ? 'upload' : 'download'} />
                <div className="what">
                  <div className="file">{item.name}</div>
                  <div className="route" title={`${item.from} → ${item.to}`}>{item.from} → {item.to}</div>
                </div>
                <div>
                  <div
                    className={`cg-bar ${barTone[item.status] ?? ''}`}
                    role="progressbar"
                    aria-label={`${item.name} ilerlemesi`}
                    aria-valuenow={item.status === 'transferring' ? undefined : progressOf(item)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: `${progressOf(item)}%` }} />
                  </div>
                  <div className={`st ${status.tone}`} title={item.errorCode && item.errorCode !== 'exists' ? item.errorCode : undefined}>{status.text}</div>
                </div>
                <div className="rate">{rateText(item)}</div>
                <div className="actions">
                  {item.status === 'error' && item.errorCode === 'exists' && (
                    <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={() => onRetry(item.id, true)}>Üzerine yaz</button>
                  )}
                  {item.status === 'error' && item.errorCode !== 'exists' && (
                    <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={() => onRetry(item.id)}>Yeniden dene</button>
                  )}
                  {(item.status === 'transferring' || item.status === 'queued') && onCancel && (
                    <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label={`${item.name} aktarımını iptal et`} title="İptal et" onClick={() => onCancel(item.id)}>
                      <Icon name="close" />
                    </button>
                  )}
                  {item.status !== 'transferring' && item.status !== 'queued' && (
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
