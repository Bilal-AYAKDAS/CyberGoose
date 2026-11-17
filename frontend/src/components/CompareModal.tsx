import { useEffect, useMemo, useState } from 'react'
import { api, type CompareResult, type CompareRow, type CompareStatus } from '../services/apiClient'
import { rowKey, rowsFor } from '../utils/compare'
import { formatDate, formatFileSize } from '../utils/formatters'
import { Modal } from './Modal'
import { Notice } from './Notice'

type CompareModalProps = {
  localPath: string
  remotePath: string
  sessionId: number | null
  /** Seçilen satırları kuyruğa ekler; eklenen dosya sayısını döndürür. */
  onSync: (rows: CompareRow[], direction: 'upload' | 'download') => Promise<number>
  onClose: () => void
}

const STATUS_LABEL: Record<CompareStatus, string> = {
  onlyLocal: 'Yalnız yerelde',
  onlyRemote: 'Yalnız sunucuda',
  different: 'Farklı',
  same: 'Aynı',
}

/**
 * Klasör karşılaştırma: yerel ve uzak klasörü alt klasörleriyle eşler, farkları listeler ve
 * seçilen dosyaları tek yönde eşitlemek için kuyruğa ekler. Hiçbir şey otomatik silinmez.
 */
export function CompareModal({ localPath, remotePath, sessionId, onSync, onClose }: CompareModalProps) {
  const [result, setResult] = useState<CompareResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSame, setShowSame] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.compareFolders(localPath, remotePath, sessionId ?? undefined)
      .then((compared) => {
        if (!active) return
        setResult(compared)
        setSelected(new Set(compared.items.filter((row) => row.status !== 'same').map(rowKey)))
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Klasörler karşılaştırılamadı') })
    return () => { active = false }
  }, [localPath, remotePath, sessionId])

  const visible = useMemo(() => (result?.items ?? []).filter((row) => showSame || row.status !== 'same'), [result, showSame])
  const chosen = useMemo(() => (result?.items ?? []).filter((row) => selected.has(rowKey(row))), [result, selected])
  const uploadRows = rowsFor(chosen, 'upload')
  const downloadRows = rowsFor(chosen, 'download')

  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const sync = async (direction: 'upload' | 'download') => {
    const rows = direction === 'upload' ? uploadRows : downloadRows
    setBusy(true)
    setError(null)
    try {
      const count = await onSync(rows, direction)
      setDone(`${count} dosya kuyruğa eklendi.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Eşitleme başlatılamadı')
    } finally {
      setBusy(false)
    }
  }

  const summary = result?.summary
  return (
    <Modal
      title="Klasörleri karşılaştır"
      wide
      onClose={onClose}
      footer={(
        <>
          <button className="cg-btn cg-btn-ghost cg-push-left" onClick={onClose}>Kapat</button>
          <button className="cg-btn" disabled={busy || !downloadRows.length} onClick={() => { void sync('download') }}>
            Sunucudan yerele eşitle ({downloadRows.length})
          </button>
          <button className="cg-btn cg-btn-primary" disabled={busy || !uploadRows.length} onClick={() => { void sync('upload') }}>
            Yerelden sunucuya eşitle ({uploadRows.length})
          </button>
        </>
      )}
    >
      <div className="body">
        <p className="cg-help mono" title={`${localPath} ↔ ${remotePath}`}>{localPath} ↔ {remotePath}</p>
        {!result && !error && <p className="cg-help" role="status">Klasörler taranıyor…</p>}
        {error && <Notice tone="error" title={error} />}
        {done && <Notice tone="warn" title={done} />}
        {summary && (
          <p className="cg-help" aria-label="Karşılaştırma özeti">
            {summary.different} farklı · {summary.onlyLocal} yalnız yerelde · {summary.onlyRemote} yalnız sunucuda · {summary.same} aynı
          </p>
        )}
        {result && (
          <label className="cg-check-row">
            <input type="checkbox" className="cg-check" checked={showSame} onChange={(event) => setShowSame(event.target.checked)} />
            <span>Aynı dosyaları da göster</span>
          </label>
        )}
        {result && !visible.length && <p className="cg-help">Klasörler aynı. Eşitlenecek dosya yok.</p>}
        {visible.length > 0 && (
          <div className="cg-compare-list">
            <table className="cg-compare" aria-label="Karşılaştırma sonucu">
              <thead>
                <tr><th /><th>Dosya</th><th>Durum</th><th>Yerel</th><th>Sunucu</th></tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const key = rowKey(row)
                  return (
                    <tr key={key} className={`is-${row.status}`}>
                      <td>
                        {row.status !== 'same' && (
                          <input type="checkbox" className="cg-check" aria-label={`${key} seç`} checked={selected.has(key)} onChange={() => toggle(key)} />
                        )}
                      </td>
                      <td className="mono" title={key}>{key}</td>
                      <td>{STATUS_LABEL[row.status]}{row.newer ? ` · ${row.newer === 'local' ? 'yerel daha yeni' : 'sunucu daha yeni'}` : ''}</td>
                      <td className="mono">{row.localSize === null ? '—' : `${formatFileSize(row.localSize)} · ${formatDate(row.localModified)}`}</td>
                      <td className="mono">{row.remoteSize === null && row.status === 'onlyLocal' ? '—' : `${formatFileSize(row.remoteSize)} · ${formatDate(row.remoteModified)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="cg-help">Eşitleme yalnızca kopyalar; hedefteki fazla dosyalar silinmez. Farklı dosyaların üzerine yazılır.</p>
      </div>
    </Modal>
  )
}
