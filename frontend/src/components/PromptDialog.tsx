import { useState } from 'react'
import { Modal } from './Modal'
import { Notice } from './Notice'

type PromptDialogProps = {
  title: string
  label: string
  initialValue?: string
  confirmLabel: string
  placeholder?: string
  onConfirm: (value: string) => Promise<void>
  onClose: () => void
}

export function PromptDialog({
  title,
  label,
  initialValue = '',
  confirmLabel,
  placeholder,
  onConfirm,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Ad boş olamaz.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(trimmed)
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
      onSubmit={submit}
      footer={<>
        <button className="cg-btn cg-btn-ghost" onClick={onClose}>Vazgeç</button>
        <button className="cg-btn cg-btn-primary" disabled={busy || !value.trim()} onClick={submit}>
          {busy ? 'Kaydediliyor' : confirmLabel}
        </button>
      </>}
    >
      <div className="body body-single">
        <div className="cg-field wide">
          <label htmlFor="cg-prompt-input">{label}</label>
          <input
            id="cg-prompt-input"
            className={`cg-input ${error ? 'is-error' : ''}`}
            value={value}
            placeholder={placeholder}
            autoFocus
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
          />
        </div>
        {error && <Notice tone="error" title={error} />}
      </div>
    </Modal>
  )
}
