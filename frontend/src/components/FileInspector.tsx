import { useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import type { FileEntry, FileInspection } from '../types'
import { formatDate, formatFileSize } from '../utils/formatters'
import { Icon } from './Icon'
import { Notice } from './Notice'

type FileInspectorProps = { entry: FileEntry | null; onClose: () => void }

type InspectionState = { path: string; data?: FileInspection; error?: string }

/**
 * Dosya detayları (yüzen katman). Yerel dosyalar için `/api/localfileinfo` çağrılır;
 * uzak dosyaların metadata endpoint'i henüz yok, listede gelen bilgiler gösterilir.
 */
export function FileInspector({ entry, onClose }: FileInspectorProps) {
  const [inspectionState, setInspectionState] = useState<InspectionState | null>(null)

  useEffect(() => {
    if (!entry?.path || entry.kind === 'folder' || entry.source !== 'local') return
    const path = entry.path
    let active = true
    api.getLocalFileInfo(path)
      .then((result) => {
        if (active) setInspectionState({ path, data: result })
      })
      .catch(() => {
        if (active) setInspectionState({ path, error: 'Dosya bilgisi alınamadı.' })
      })
    return () => { active = false }
  }, [entry])

  if (!entry) return null
  const current = inspectionState?.path === entry.path ? inspectionState : null
  const inspection = current?.data
  const filePath = inspection?.FilePath ?? entry.path ?? entry.name
  const fileSize = inspection ? formatFileSize(inspection.Size) : (entry.kind === 'folder' ? '—' : formatFileSize(entry.size))
  const modified = inspection?.Change ?? formatDate(entry.modified)
  const permissions = inspection?.filemod ?? entry.permissions ?? '—'
  const hash = inspection?.sha256 ?? entry.hash ?? (entry.source === 'remote' ? 'Uzak dosyalarda hesaplanmıyor' : 'Hesaplanmadı')
  const preview = inspection?.preview ?? entry.preview

  return (
    <aside className="cg-popover cg-inspector" aria-label="Dosya detayları" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <header className="cg-popover-head">
        <span className="cg-name">
          <Icon name={entry.kind === 'folder' ? 'folder' : 'file'} className={entry.kind === 'folder' ? 'is-dir' : undefined} />
          <span className="cg-name-text">{entry.name}</span>
        </span>
        <button className="cg-btn cg-btn-icon cg-btn-ghost" onClick={onClose} aria-label="Detayları kapat"><Icon name="close" /></button>
      </header>
      <dl className="cg-details">
        <div><dt>Tür</dt><dd>{entry.kind === 'folder' ? 'Klasör' : 'Dosya'}</dd></div>
        <div><dt>Yol</dt><dd className="mono">{filePath}</dd></div>
        <div><dt>Boyut</dt><dd className="mono">{fileSize}</dd></div>
        <div><dt>Değiştirilme</dt><dd className="mono">{modified}</dd></div>
        <div><dt>İzinler</dt><dd className="mono">{permissions}</dd></div>
        <div><dt>SHA-256</dt><dd className="mono">{hash}</dd></div>
      </dl>
      {current?.error && (
        <div className="cg-popover-section">
          <Notice tone="error" title={current.error}>Flask API'nin çalıştığını ve dosyanın okunabilir olduğunu kontrol edin.</Notice>
        </div>
      )}
      {preview && (
        <div className="cg-popover-section">
          <div className="cg-label">Önizleme</div>
          <pre className="cg-preview">{preview}</pre>
          {inspection?.previewTruncated && <span className="cg-help">Önizleme 64 KB ile sınırlandırıldı.</span>}
        </div>
      )}
    </aside>
  )
}
