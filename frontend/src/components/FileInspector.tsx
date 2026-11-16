import { useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import type { FileEntry, FileInspection, RemoteDetails } from '../types'
import { formatDate, formatFileSize } from '../utils/formatters'
import { Icon } from './Icon'
import { Notice } from './Notice'

type FileInspectorProps = { entry: FileEntry | null; onClose: () => void }

type InspectionState = {
  path: string
  local?: FileInspection
  remote?: RemoteDetails
  error?: string
}

/**
 * Dosya detayları (yüzen katman). Yerel dosyalarda SHA-256 ve önizleme `/api/local/info`'dan,
 * uzak dosyalarda izinler `/api/remote/info`'dan gelir; FTP/SFTP'de izin değiştirilebilir.
 */
export function FileInspector({ entry, onClose }: FileInspectorProps) {
  const [inspection, setInspection] = useState<InspectionState | null>(null)
  const [mode, setMode] = useState('')
  const [chmodState, setChmodState] = useState<{ path: string; busy: boolean; error?: string; done?: boolean }>({ path: '', busy: false })

  useEffect(() => {
    if (!entry || entry.kind === 'folder') return
    const path = entry.path
    let active = true
    const request: Promise<InspectionState> = entry.source === 'local'
      ? api.getLocalFileInfo(path).then((local) => ({ path, local }))
      : api.getRemoteDetails(path).then((remote) => ({ path, remote }))
    request
      .then((result) => {
        if (!active) return
        setInspection(result)
        setMode(result.remote?.permissions ?? '')
      })
      .catch((error: unknown) => {
        if (active) setInspection({ path, error: error instanceof Error ? error.message : 'Dosya bilgisi alınamadı.' })
      })
    return () => { active = false }
  }, [entry])

  if (!entry) return null
  const activeChmod = chmodState.path === entry.path ? chmodState : { path: entry.path, busy: false }
  const current = inspection?.path === entry.path ? inspection : null
  const local = current?.local
  const remote = current?.remote
  const fileSize = local ? formatFileSize(local.Size) : (entry.kind === 'folder' ? '—' : formatFileSize(entry.size))
  const modified = local ? formatDate(local.Change.replace(' ', 'T')) : formatDate(entry.modified)
  const permissions = local?.filemod ?? remote?.permissions ?? '—'
  const hash = local?.sha256 ?? (entry.source === 'remote' ? 'Uzak dosyalarda hesaplanmıyor' : entry.kind === 'folder' ? '—' : 'Hesaplanıyor')
  const preview = local?.preview

  const applyMode = async () => {
    setChmodState({ path: entry.path, busy: true })
    try {
      const updated = await api.chmodRemote(entry.path, mode)
      setInspection({ path: entry.path, remote: updated })
      setChmodState({ path: entry.path, busy: false, done: true })
    } catch (error) {
      setChmodState({ path: entry.path, busy: false, error: error instanceof Error ? error.message : 'İzinler değiştirilemedi' })
    }
  }

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
        <div><dt>Yol</dt><dd className="mono">{local?.FilePath ?? entry.path}</dd></div>
        <div><dt>Boyut</dt><dd className="mono">{fileSize}</dd></div>
        <div><dt>Değiştirilme</dt><dd className="mono">{modified}</dd></div>
        <div><dt>İzinler</dt><dd className="mono">{permissions}</dd></div>
        <div><dt>SHA-256</dt><dd className="mono">{hash}</dd></div>
      </dl>
      {remote?.canChmod && (
        <div className="cg-popover-section">
          <label className="cg-label" htmlFor="chmod-input">İzinleri değiştir</label>
          <div className="cg-inline">
            <input id="chmod-input" className="cg-input mono" value={mode} maxLength={3} inputMode="numeric" onChange={(event) => { setMode(event.target.value); setChmodState({ path: entry.path, busy: false }) }} />
            <button className="cg-btn" disabled={activeChmod.busy || !/^[0-7]{3}$/.test(mode) || mode === remote.permissions} onClick={applyMode}>Uygula</button>
          </div>
          {activeChmod.error && <span className="cg-help error">{activeChmod.error}</span>}
          {activeChmod.done && <span className="cg-help">İzinler güncellendi.</span>}
        </div>
      )}
      {current?.error && (
        <div className="cg-popover-section">
          <Notice tone="error" title={current.error} />
        </div>
      )}
      {preview && (
        <div className="cg-popover-section">
          <div className="cg-label">Önizleme</div>
          <pre className="cg-preview">{preview}</pre>
          {local?.previewTruncated && <span className="cg-help">Önizleme 64 KB ile sınırlandırıldı.</span>}
        </div>
      )}
    </aside>
  )
}
