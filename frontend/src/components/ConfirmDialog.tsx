import { useState } from 'react'
import { Modal } from './Modal'
import { Notice } from './Notice'

type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  onClose: () => void
}

/**
 * Silme gibi geri alınamayan eylemler için onay. Tasarım kuralı: onay butonu turuncu
 * primary değil, danger secondary'dir (yalnızca metin rengi status-error).
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
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
        <button className="cg-btn cg-btn-ghost" onClick={onClose}>Vazgeç</button>
        <button className="cg-btn cg-btn-danger" disabled={busy} onClick={confirm}>{busy ? 'Siliniyor' : confirmLabel}</button>
      </>}
    >
      <div className="body body-single">
        <p className="cg-dialog-text">{message}</p>
        {error && <Notice tone="error" title={error} />}
      </div>
    </Modal>
  )
}
