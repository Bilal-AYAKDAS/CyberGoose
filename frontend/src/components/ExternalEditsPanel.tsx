import type { ExternalEdit } from '../services/apiClient'
import { Icon } from './Icon'

type ExternalEditsPanelProps = {
  edits: ExternalEdit[]
  onSync: (id: string) => void
  onStop: (id: string) => void
  onClose: () => void
}

function stateText(edit: ExternalEdit) {
  if (edit.uploading) return 'Yükleniyor…'
  if (edit.error) return edit.error
  if (edit.lastUpload) {
    const time = new Date(edit.lastUpload * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return `${edit.uploads} kez yüklendi · son ${time}`
  }
  return 'Kaydettiğinizde sunucuya yüklenir'
}

/** Harici düzenleyicide açık uzak dosyalar: durum, "Şimdi yükle" ve "Bitir". */
export function ExternalEditsPanel({ edits, onSync, onStop, onClose }: ExternalEditsPanelProps) {
  return (
    <aside className="cg-popover cg-edits" aria-label="Düzenlenen dosyalar">
      <header className="cg-popover-head">
        <span className="cg-name"><Icon name="file" /><span className="cg-name-text">Düzenlenen dosyalar</span></span>
        <button className="cg-btn cg-btn-icon cg-btn-ghost" onClick={onClose} aria-label="Listeyi kapat"><Icon name="close" /></button>
      </header>
      {!edits.length && <p className="cg-help cg-popover-section">Açık düzenleme yok.</p>}
      <ul className="cg-edits-list">
        {edits.map((edit) => (
          <li key={edit.id}>
            <div className="what">
              <div className="file mono" title={edit.remotePath}>{edit.name}</div>
              <div className={`cg-help${edit.error ? ' error' : ''}`}>{stateText(edit)}</div>
            </div>
            <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={() => onSync(edit.id)} disabled={edit.uploading}>Şimdi yükle</button>
            <button className="cg-btn cg-btn-ghost cg-btn-sm" aria-label={`${edit.name} düzenlemesini bitir`} onClick={() => onStop(edit.id)}>Bitir</button>
          </li>
        ))}
      </ul>
      <p className="cg-help cg-popover-section">Bitir, bilgisayardaki geçici kopyayı siler. Kaydedilmemiş değişiklik yüklenmez.</p>
    </aside>
  )
}
