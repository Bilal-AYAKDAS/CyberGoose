import { useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import type { FileEntry, FileInspection } from '../types'

type FileInspectorProps = { entry: FileEntry | null; onClose: () => void }

export function FileInspector({ entry, onClose }: FileInspectorProps) {
  const [inspectionState, setInspectionState] = useState<{ path: string; data?: FileInspection; error?: string } | null>(null)

  useEffect(() => {
    if (!entry?.path || entry.kind === 'folder') return
    let active = true
    api.getLocalFileInfo(entry.path)
      .then((result) => {
        if (active) setInspectionState({ path: entry.path as string, data: result as FileInspection })
      })
      .catch(() => {
        if (active) setInspectionState({ path: entry.path as string, error: 'Gerçek dosya bilgisi alınamadı.' })
      })
    return () => { active = false }
  }, [entry])

  if (!entry) return null
  const currentInspectionState = inspectionState?.path === entry.path ? inspectionState : null
  const inspection = currentInspectionState?.data
  const error = currentInspectionState?.error
  const filePath = inspection?.FilePath ?? entry.path ?? `/home/${entry.name}`
  const fileSize = inspection?.Size !== undefined ? `${inspection.Size} B` : entry.size
  const modified = inspection?.Change ?? entry.modified
  const permissions = inspection?.filemod ?? entry.permissions ?? '0644'
  const hash = inspection?.sha256 ?? entry.hash ?? 'Hesaplanmadı'
  const preview = inspection?.preview ?? entry.preview

  return (
    <aside className="inspector" aria-label="Dosya detayları">
      <header className="drawer-header"><div><div className="eyebrow">DOSYA DENETİMİ</div><h2>Detaylar</h2></div><button className="close-button" onClick={onClose} aria-label="Detayları kapat">×</button></header>
      <div className="inspector-name"><span className="large-file-icon">{entry.kind === 'folder' ? '▰' : '▱'}</span><div><strong>{entry.name}</strong><span>{entry.kind === 'folder' ? 'Klasör' : 'Dosya'}</span></div></div>
      <dl className="details-list"><div><dt>Yol</dt><dd className="mono-text">{filePath}</dd></div><div><dt>Boyut</dt><dd className="mono-text">{fileSize}</dd></div><div><dt>Değiştirilme</dt><dd className="mono-text">{modified}</dd></div><div><dt>İzinler</dt><dd className="mono-text">{permissions}</dd></div><div><dt>SHA-256</dt><dd className="mono-text">{hash}</dd></div></dl>
      {error && <p className="form-error" role="alert">{error}</p>}
      {preview && <div className="preview"><div className="eyebrow">ÖNİZLEME</div><pre>{preview}</pre>{inspection?.previewTruncated && <small className="preview-note">Önizleme 64 KB ile sınırlandırıldı.</small>}</div>}
    </aside>
  )
}
