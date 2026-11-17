import { useEffect, useMemo, useState } from 'react'
import { api, type SheetData, type SheetTab } from '../services/apiClient'
import { Modal } from './Modal'
import { Notice } from './Notice'

type SheetEditorModalProps = {
  side: 'local' | 'remote'
  path: string
  name: string
  onSaved: () => void
  onClose: () => void
}

function columnLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

/**
 * Yerel ve uzak Excel (.xlsx) / CSV (.csv) dosyaları için tablo düzenleyici (5 MB'a kadar).
 */
export function SheetEditorModal({ side, path, name, onSaved, onClose }: SheetEditorModalProps) {
  const [data, setData] = useState<SheetData | null>(null)
  const [sheets, setSheets] = useState<SheetTab[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    let active = true
    api.readSheet(side, path)
      .then((res) => {
        if (!active) return
        setData(res)
        setSheets(res.sheets)
        setActiveSheet(0)
        setDirty(false)
        setLoading(false)
      })
      .catch((caught) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'Tablo okunamadı')
        setLoading(false)
      })
    return () => { active = false }
  }, [path, side])

  const currentSheet = sheets[activeSheet]
  const colCount = useMemo(() => {
    if (!currentSheet) return 1
    return Math.max(1, ...currentSheet.rows.map((r) => r.length))
  }, [currentSheet])

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    setSheets((prev) => prev.map((sheet, idx) => {
      if (idx !== activeSheet) return sheet
      const rows = sheet.rows.map((row, rIdx) => {
        if (rIdx !== rowIndex) return row
        const nextRow = [...row]
        while (nextRow.length <= colIndex) nextRow.push('')
        nextRow[colIndex] = value
        return nextRow
      })
      return { ...sheet, rows }
    }))
    setDirty(true)
    setConfirmClose(false)
  }

  const addRow = () => {
    setSheets((prev) => prev.map((sheet, idx) => (
      idx === activeSheet
        ? { ...sheet, rows: [...sheet.rows, Array.from({ length: colCount }, () => '')] }
        : sheet
    )))
    setDirty(true)
    setConfirmClose(false)
  }

  const addColumn = () => {
    setSheets((prev) => prev.map((sheet, idx) => (
      idx === activeSheet
        ? { ...sheet, rows: sheet.rows.map((row) => [...row, '']) }
        : sheet
    )))
    setDirty(true)
    setConfirmClose(false)
  }

  const save = async () => {
    if (!data) return
    setSaving(true)
    setError(null)
    try {
      await api.writeSheet(side, path, sheets, {
        delimiter: data.delimiter,
        encoding: data.encoding,
        newline: data.newline,
      })
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tablo kaydedilemedi')
      setSaving(false)
    }
  }

  const close = () => {
    if (dirty && !confirmClose) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  return (
    <Modal
      title={`Tablo Düzenle: ${name}`}
      wide
      onClose={close}
      footer={<>
        {data && (
          <span className="cg-caption cg-editor-meta">
            {data.format.toUpperCase()}
            {data.delimiter ? ` · Ayraç: "${data.delimiter === '\t' ? 'TAB' : data.delimiter}"` : ''}
            {currentSheet ? ` · ${currentSheet.rows.length} satır × ${colCount} sütun` : ''}
          </span>
        )}
        <button className="cg-btn cg-btn-ghost" onClick={close}>Vazgeç</button>
        <button className="cg-btn cg-btn-primary" disabled={loading || saving || !data} onClick={save}>
          {saving ? 'Kaydediliyor' : side === 'local' ? 'Kaydet' : 'Uzak sunucuya kaydet'}
        </button>
      </>}
    >
      <div
        className="body body-single"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            if (!saving && data) void save()
          }
        }}
      >
        {loading ? (
          <span className="cg-caption">Tablo yükleniyor...</span>
        ) : data && currentSheet && (
          <>
            <div className="cg-sheet-toolbar">
              {sheets.length > 1 && (
                <div className="cg-sheet-tabs" role="tablist">
                  {sheets.map((sheet, idx) => (
                    <button
                      key={`${sheet.name}-${idx}`}
                      type="button"
                      role="tab"
                      aria-selected={idx === activeSheet}
                      className={`cg-btn cg-btn-sm ${idx === activeSheet ? 'cg-btn-primary' : 'cg-btn-ghost'}`}
                      onClick={() => setActiveSheet(idx)}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="cg-sheet-actions">
                <button type="button" className="cg-btn cg-btn-sm cg-btn-ghost" onClick={addRow}>+ Satır ekle</button>
                <button type="button" className="cg-btn cg-btn-sm cg-btn-ghost" onClick={addColumn}>+ Sütun ekle</button>
              </div>
            </div>
            <div className="cg-sheet-wrap">
              <table className="cg-sheet-table">
                <thead>
                  <tr>
                    <th className="cg-sheet-corner">#</th>
                    {Array.from({ length: colCount }, (_, cIdx) => (
                      <th key={cIdx}>{columnLabel(cIdx)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentSheet.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      <th className="cg-sheet-rownum">{rIdx + 1}</th>
                      {Array.from({ length: colCount }, (_, cIdx) => (
                        <td key={cIdx}>
                          <input
                            aria-label={`Hücre ${columnLabel(cIdx)}${rIdx + 1}`}
                            className="cg-sheet-cell"
                            value={row[cIdx] ?? ''}
                            onChange={(event) => updateCell(rIdx, cIdx, event.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && <Notice tone="error" title={error} />}
        {confirmClose && (
          <Notice
            tone="warn"
            title="Kaydedilmemiş değişiklikler var."
            action={<button className="cg-btn cg-btn-sm" onClick={onClose}>Kaydetmeden kapat</button>}
          />
        )}
      </div>
    </Modal>
  )
}
