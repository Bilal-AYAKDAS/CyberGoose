import { useEffect, useMemo, useState } from 'react'
import { api, type CompareResult, type CompareRow, type CompareStatus } from '../services/apiClient'
import { describeOffset, extrasFor, rowKey, rowsFor } from '../utils/compare'
import { formatDate, formatFileSize } from '../utils/formatters'
import { Modal } from './Modal'
import { Notice } from './Notice'

type CompareModalProps = {
  localPath: string
  remotePath: string
  sessionId: number | null
  /** Sol panel uzak bağlantıdaysa onun oturumu: karşılaştırma iki sunucu arasında yapılır. */
  leftSessionId?: number
  /** Sol tarafın adı (sütun başlığı); verilmezse "Yerel". */
  leftLabel?: string
  /** Bu sunucu için kayıtlı saat farkı (dakika); null/yok: otomatik. */
  savedOffset?: number | null
  /** Verilirse seçilen saat farkı bağlantıya kaydedilir ve sonraki karşılaştırmalarda hazır gelir. */
  onSaveOffset?: (minutes: number | null) => Promise<void> | void
  /**
   * Verilirse "hedefte fazla olanları sil" seçeneği görünür. `side`: silinecek taraf (upload → sağ/sunucu,
   * download → sol/yerel). Silinen dosya sayısını döndürür.
   */
  onDeleteExtras?: (rows: CompareRow[], side: 'left' | 'right') => Promise<number>
  /** Seçilen satırları kuyruğa ekler; eklenen dosya sayısını döndürür. */
  onSync: (rows: CompareRow[], direction: 'upload' | 'download') => Promise<number>
  onClose: () => void
}

/** Saat farkı seçenekleri (dakika): sunucunun bilgisayara göre ne kadar ileride olduğu. */
const OFFSET_HOURS = Array.from({ length: 27 }, (_, index) => index - 12)


/**
 * Klasör karşılaştırma: yerel ve uzak klasörü alt klasörleriyle eşler, farkları listeler ve
 * seçilen dosyaları tek yönde eşitlemek için kuyruğa ekler. Hedefteki fazla dosyalar yalnızca
 * kullanıcı "fazla olanları sil" seçeneğini açıp onaylarsa silinir.
 */
export function CompareModal({ localPath, remotePath, sessionId, leftSessionId, leftLabel, savedOffset, onSaveOffset, onDeleteExtras, onSync, onClose }: CompareModalProps) {
  const [result, setResult] = useState<CompareResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSame, setShowSame] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  /** 'auto': backend aynı boyuttaki dosyalardan saat farkını tahmin eder. */
  const [offset, setOffset] = useState<'auto' | number>(typeof savedOffset === 'number' ? savedOffset : 'auto')
  const [offsetNote, setOffsetNote] = useState<string | null>(null)
  /** Ayna eşitleme: hedefte fazla olan (seçili) dosyalar da silinir. */
  const [mirror, setMirror] = useState(false)
  /** Silme içeren eşitleme önce onay ister. */
  const [confirming, setConfirming] = useState<'upload' | 'download' | null>(null)
  const leftName = leftLabel ?? 'Yerel'
  const statusLabel: Record<CompareStatus, string> = {
    onlyLocal: leftLabel ? 'Yalnız solda' : 'Yalnız yerelde',
    onlyRemote: leftLabel ? 'Yalnız sağda' : 'Yalnız sunucuda',
    different: 'Farklı',
    same: 'Aynı',
  }

  useEffect(() => {
    let active = true
    const options = {
      ...(leftSessionId !== undefined ? { leftSessionId } : {}),
      ...(offset !== 'auto' ? { timeOffsetMinutes: offset } : {}),
    }
    const request = Object.keys(options).length
      ? api.compareFolders(localPath, remotePath, sessionId ?? undefined, options)
      : api.compareFolders(localPath, remotePath, sessionId ?? undefined)
    request
      .then((compared) => {
        if (!active) return
        setResult(compared)
        setSelected(new Set(compared.items.filter((row) => row.status !== 'same').map(rowKey)))
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Klasörler karşılaştırılamadı') })
    return () => { active = false }
  }, [localPath, remotePath, sessionId, leftSessionId, offset])

  const visible = useMemo(() => (result?.items ?? []).filter((row) => showSame || row.status !== 'same'), [result, showSame])
  const chosen = useMemo(() => (result?.items ?? []).filter((row) => selected.has(rowKey(row))), [result, selected])
  const uploadRows = rowsFor(chosen, 'upload')
  const downloadRows = rowsFor(chosen, 'download')
  const uploadExtras = mirror && onDeleteExtras ? extrasFor(chosen, 'upload') : []
  const downloadExtras = mirror && onDeleteExtras ? extrasFor(chosen, 'download') : []
  const rightName = leftLabel ? 'sağ tarafta' : 'sunucuda'
  const leftWhere = leftLabel ? 'sol tarafta' : 'yerelde'

  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const sync = async (direction: 'upload' | 'download', confirmed = false) => {
    const rows = direction === 'upload' ? uploadRows : downloadRows
    const extras = direction === 'upload' ? uploadExtras : downloadExtras
    if (extras.length && !confirmed) {
      setConfirming(direction)
      return
    }
    setConfirming(null)
    setBusy(true)
    setError(null)
    try {
      const count = rows.length ? await onSync(rows, direction) : 0
      let message = `${count} dosya kuyruğa eklendi.`
      if (extras.length && onDeleteExtras) {
        const deleted = await onDeleteExtras(extras, direction === 'upload' ? 'right' : 'left')
        message += ` ${deleted} fazla dosya silindi.`
        const gone = new Set(extras.map(rowKey))
        setResult((current) => current && { ...current, items: current.items.filter((row) => !gone.has(rowKey(row))) })
        setSelected((current) => new Set([...current].filter((key) => !gone.has(key))))
      }
      setDone(message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Eşitleme başlatılamadı')
    } finally {
      setBusy(false)
    }
  }

  const confirmExtras = confirming === 'upload' ? uploadExtras : downloadExtras
  // Sunucudaki silme kalıcıdır; yerel dosyalar Geri Dönüşüm Kutusu'na gider.
  const confirmText = confirming === 'download' && !leftLabel
    ? `${confirmExtras.length} dosya ${leftWhere} Geri Dönüşüm Kutusu'na taşınacak.`
    : `${confirmExtras.length} dosya ${confirming === 'upload' ? rightName : leftWhere} kalıcı olarak silinecek.`

  const summary = result?.summary
  return (
    <Modal
      title="Klasörleri karşılaştır"
      wide
      onClose={onClose}
      footer={(
        <>
          <button className="cg-btn cg-btn-ghost cg-push-left" onClick={onClose}>Kapat</button>
          <button className="cg-btn" disabled={busy || !(downloadRows.length + downloadExtras.length)} onClick={() => { void sync('download') }}>
            {leftLabel ? 'Sağdan sola eşitle' : 'Sunucudan yerele eşitle'} ({downloadRows.length}{downloadExtras.length ? `, ${downloadExtras.length} silme` : ''})
          </button>
          <button className="cg-btn cg-btn-primary" disabled={busy || !(uploadRows.length + uploadExtras.length)} onClick={() => { void sync('upload') }}>
            {leftLabel ? 'Soldan sağa eşitle' : 'Yerelden sunucuya eşitle'} ({uploadRows.length}{uploadExtras.length ? `, ${uploadExtras.length} silme` : ''})
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
            {summary.different} farklı · {summary.onlyLocal} {statusLabel.onlyLocal.toLocaleLowerCase('tr')} · {summary.onlyRemote} {statusLabel.onlyRemote.toLocaleLowerCase('tr')} · {summary.same} aynı
          </p>
        )}
        <div className="cg-inline cg-compare-offset">
          <label className="cg-label" htmlFor="compare-offset">Sunucu saat farkı</label>
          <select
            id="compare-offset"
            className="cg-input"
            value={offset === 'auto' ? 'auto' : String(offset)}
            onChange={(event) => {
              const next = event.target.value === 'auto' ? 'auto' : Number(event.target.value)
              setResult(null)
              setError(null)
              setOffset(next)
              if (onSaveOffset) {
                Promise.resolve(onSaveOffset(next === 'auto' ? null : next))
                  .then(() => setOffsetNote(next === 'auto' ? null : 'Bu sunucu için hatırlanacak.'))
                  .catch(() => setOffsetNote('Saat farkı kaydedilemedi; yalnızca bu karşılaştırmada kullanılacak.'))
              }
            }}
          >
            <option value="auto">Otomatik</option>
            {OFFSET_HOURS.map((hours) => (
              <option key={hours} value={hours * 60}>{hours === 0 ? 'Fark yok' : `${hours > 0 ? '+' : '−'}${Math.abs(hours)} saat`}</option>
            ))}
          </select>
          {result && offset === 'auto' && result.timeOffsetDetected && (
            <span className="cg-help" role="status">Otomatik bulundu: {describeOffset(result.timeOffsetMinutes ?? 0)}.</span>
          )}
          {offsetNote && <span className="cg-help" role="status">{offsetNote}</span>}
        </div>
        {result && (
          <label className="cg-check-row">
            <input type="checkbox" className="cg-check" checked={showSame} onChange={(event) => setShowSame(event.target.checked)} />
            <span>Aynı dosyaları da göster</span>
          </label>
        )}
        {result && onDeleteExtras && (
          <label className="cg-check-row">
            <input type="checkbox" className="cg-check" checked={mirror} onChange={(event) => { setMirror(event.target.checked); setConfirming(null) }} />
            <span>Eşitlerken hedefte fazla olan seçili dosyaları sil</span>
          </label>
        )}
        {confirming && (
          <Notice
            tone="error"
            title={confirmText}
            action={(
              <span className="cg-inline">
                <button className="cg-btn" onClick={() => setConfirming(null)}>Vazgeç</button>
                <button className="cg-btn cg-btn-danger" disabled={busy} onClick={() => { void sync(confirming, true) }}>Sil ve eşitle</button>
              </span>
            )}
          >
            {confirmExtras.slice(0, 5).map(rowKey).join(', ')}{confirmExtras.length > 5 ? ` ve ${confirmExtras.length - 5} dosya daha` : ''}
          </Notice>
        )}
        {result && !visible.length && <p className="cg-help">Klasörler aynı. Eşitlenecek dosya yok.</p>}
        {visible.length > 0 && (
          <div className="cg-compare-list">
            <table className="cg-compare" aria-label="Karşılaştırma sonucu">
              <thead>
                <tr><th /><th>Dosya</th><th>Durum</th><th>{leftName}</th><th>{leftLabel ? 'Sağ' : 'Sunucu'}</th></tr>
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
                      <td>{statusLabel[row.status]}{row.newer ? ` · ${row.newer === 'local' ? (leftLabel ? 'sol daha yeni' : 'yerel daha yeni') : (leftLabel ? 'sağ daha yeni' : 'sunucu daha yeni')}` : ''}</td>
                      <td className="mono">{row.localSize === null ? '—' : `${formatFileSize(row.localSize)} · ${formatDate(row.localModified)}`}</td>
                      <td className="mono">{row.remoteSize === null && row.status === 'onlyLocal' ? '—' : `${formatFileSize(row.remoteSize)} · ${formatDate(row.remoteModified)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="cg-help">
          {mirror
            ? 'Eşitleme kopyalar ve hedefte fazla olan seçili dosyaları siler (önce onay istenir). Boş kalan klasörler silinmez.'
            : 'Eşitleme yalnızca kopyalar; hedefteki fazla dosyalar silinmez. Farklı dosyaların üzerine yazılır.'}
        </p>
      </div>
    </Modal>
  )
}
