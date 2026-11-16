import type { TransferItem, TransferStatus } from '../types'

const labels: Record<TransferStatus, string> = {
  queued: 'Bekliyor',
  transferring: 'Aktarılıyor',
  completed: 'Tamamlandı',
  error: 'Hata',
  cancelled: 'İptal edildi',
}

type TransferQueueProps = {
  items: TransferItem[]
  onUpdate: (id: string, status: TransferStatus) => void
  onClose: () => void
}

export function TransferQueue({ items, onUpdate, onClose }: TransferQueueProps) {
  return (
    <section className="drawer queue-drawer" aria-label="Transfer kuyruğu">
      <header className="drawer-header"><div><div className="eyebrow">İŞLEM GEÇMİŞİ</div><h2>Transfer kuyruğu</h2></div><button className="close-button" onClick={onClose} aria-label="Kuyruğu kapat">×</button></header>
      <div className="queue-list">
        {items.map((item) => <article className="queue-item" key={item.id}><div className="queue-row"><span className="file-icon">▱</span><div><strong>{item.name}</strong><small>{item.direction === 'upload' ? 'Yükleme' : 'İndirme'} · {item.size}</small></div><span className={`queue-status ${item.status}`}>{labels[item.status]}</span></div><div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div><div className="queue-actions"><span>{item.progress}%</span>{item.status === 'transferring' && <button onClick={() => onUpdate(item.id, 'cancelled')}>İptal</button>}{item.status === 'error' && <button onClick={() => onUpdate(item.id, 'queued')}>Yeniden dene</button>}</div></article>)}
      </div>
    </section>
  )
}
