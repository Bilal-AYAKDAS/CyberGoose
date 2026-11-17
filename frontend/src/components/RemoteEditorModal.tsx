import { useEffect, useState } from 'react'
import { api, type RemoteText } from '../services/apiClient'
import { Modal } from './Modal'
import { Notice } from './Notice'

type RemoteEditorModalProps = {
  path: string
  name: string
  onSaved: () => void
  onClose: () => void
}

const ENCODING_LABEL: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-8-sig': 'UTF-8 (BOM)',
  cp1254: 'Windows-1254',
}

/**
 * Uzak metin dosyası düzenleyici (256 KB'a kadar). Dosyanın karakter kodlaması ve satır sonu
 * (CRLF/LF) korunur: textarea her şeyi LF'ye çevirir, kaydederken backend özgün biçime döner.
 */
export function RemoteEditorModal({ path, name, onSaved, onClose }: RemoteEditorModalProps) {
  const [file, setFile] = useState<RemoteText | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const dirty = Boolean(file && content !== file.content)

  useEffect(() => {
    let active = true
    api.readRemoteText(path)
      .then((res) => {
        if (!active) return
        setFile(res)
        setContent(res.content)
        setLoading(false)
      })
      .catch((caught) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'Dosya okunamadı')
        setLoading(false)
      })
    return () => { active = false }
  }, [path])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.writeRemoteText(path, content, { encoding: file?.encoding, newline: file?.newline })
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dosya kaydedilemedi')
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
      title={`Düzenle: ${name}`}
      onClose={close}
      footer={<>
        {file && (
          <span className="cg-caption cg-editor-meta">
            {ENCODING_LABEL[file.encoding ?? 'utf-8'] ?? file.encoding} · {file.newline === '\r\n' ? 'CRLF' : 'LF'}
          </span>
        )}
        <button className="cg-btn cg-btn-ghost" onClick={close}>Vazgeç</button>
        <button className="cg-btn cg-btn-primary" disabled={loading || saving || !file} onClick={save}>
          {saving ? 'Kaydediliyor' : 'Uzak sunucuya kaydet'}
        </button>
      </>}
    >
      <div className="body body-single">
        {loading ? (
          <span className="cg-caption">Dosya yükleniyor...</span>
        ) : file && (
          <textarea
            aria-label="Dosya içeriği"
            className="cg-input mono cg-editor-textarea"
            value={content}
            onChange={(event) => { setContent(event.target.value); setConfirmClose(false) }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                if (!saving) void save()
              }
            }}
            spellCheck={false}
          />
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
