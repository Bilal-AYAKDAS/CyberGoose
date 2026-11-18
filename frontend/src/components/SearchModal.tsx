import { useEffect, useState } from 'react'
import { api, type SearchHit, type SearchResult } from '../services/apiClient'
import type { PaneId } from '../types'
import { formatDate, formatFileSize } from '../utils/formatters'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { Notice } from './Notice'

type SearchModalProps = {
  side: PaneId
  path: string
  query: string
  sessionId: number | null
  /** Panelin gerçek kaynağı: sol panel uzak bağlantıdaysa 'remote' (varsayılan: `side`). */
  source?: 'local' | 'remote'
  /** Sonuca gider: klasörse içine, dosyaysa bulunduğu klasöre (dosya seçili). */
  onOpen: (hit: SearchHit) => void
  onClose: () => void
}

/** Odaktaki klasörde alt klasörlerle birlikte ada göre arama. Uzak tarafta aktarım bağlantısı kullanılır. */
export function SearchModal({ side, path, query, sessionId, source = side, onOpen, onClose }: SearchModalProps) {
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.search(source, path, query, source === 'remote' ? sessionId ?? undefined : undefined)
      .then((found) => { if (active) setResult(found) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Arama yapılamadı') })
    return () => { active = false }
  }, [source, path, query, sessionId])

  return (
    <Modal title={`"${query}" araması`} wide onClose={onClose} footer={<button className="cg-btn" onClick={onClose}>Kapat</button>}>
      <div className="body">
        <p className="cg-help mono">{source === 'local' ? 'Yerel' : 'Sunucu'} · {path} ve alt klasörleri</p>
        {!result && !error && <p className="cg-help" role="status">Aranıyor…</p>}
        {error && <Notice tone="error" title={error} />}
        {result && (
          <p className="cg-help" aria-label="Arama özeti">
            {result.results.length} sonuç · {result.scanned} öğe tarandı
            {result.truncated ? ' · sınıra ulaşıldı, aramayı daraltın' : ''}
          </p>
        )}
        {result && result.results.length > 0 && (
          <div className="cg-compare-list">
            <table className="cg-compare" aria-label="Arama sonuçları">
              <thead><tr><th>Ad</th><th>Klasör</th><th>Boyut</th><th>Değiştirilme</th></tr></thead>
              <tbody>
                {result.results.map((hit) => (
                  <tr key={hit.path} className="is-clickable" tabIndex={0} onClick={() => onOpen(hit)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(hit) }}>
                    <td><Icon name={hit.kind === 'folder' ? 'folder' : 'file'} className={hit.kind === 'folder' ? 'is-dir' : undefined} /> {hit.name}</td>
                    <td className="mono" title={hit.parent}>{hit.parent}</td>
                    <td className="mono">{hit.kind === 'folder' ? '—' : formatFileSize(hit.size)}</td>
                    <td className="mono">{formatDate(hit.modified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}
