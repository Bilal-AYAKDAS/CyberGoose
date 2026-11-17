import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Notice } from './Notice'

type ConfirmDialogProps = {
  title: string
  message: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'default'
  busyLabel?: string
  secondary?: { label: string; action: () => Promise<void> }
  onConfirm: () => Promise<void>
  onClose: () => void
}

/**
 * Onay diyaloğu. Tasarım kuralı: silme onayı turuncu primary değil, danger secondary'dir
 * (yalnızca metin rengi status-error). Nötr kararlar (sunucu anahtarına güven) secondary buton.
 */
export function ConfirmDialog({ title, message, confirmLabel, tone = 'danger', busyLabel, secondary, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'İşlem başarısız oldu')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={<>
        {secondary && (
          // Geri alınamaz ikincil eylem ayrı durur (solda), varsayılan eylemin yanında değil.
          <button className="cg-btn cg-btn-ghost cg-btn-danger cg-push-left" disabled={busy} onClick={() => { void run(secondary.action) }}>{secondary.label}</button>
        )}
        <button className="cg-btn cg-btn-ghost" onClick={onClose}>Vazgeç</button>
        <button data-autofocus className={`cg-btn ${tone === 'danger' ? 'cg-btn-danger' : ''}`} disabled={busy} onClick={() => { void run(onConfirm) }}>
          {busy ? (busyLabel ?? 'İşleniyor') : confirmLabel}
        </button>
      </>}
    >
      <div className="body body-single">
        <div className="cg-dialog-text">{message}</div>
        {error && <Notice tone="error" title={error} />}
      </div>
    </Modal>
  )
}
