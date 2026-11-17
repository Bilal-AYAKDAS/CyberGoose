import { useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import { Modal } from './Modal'
import { Notice } from './Notice'

type RemoteEditorModalProps = {
  path: string
  name: string
  onSaved: () => void
  onClose: () => void
}

export function RemoteEditorModal({ path, name, onSaved, onClose }: RemoteEditorModalProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.readRemoteText(path)
      .then((res) => {
        if (!active) return
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
      await api.writeRemoteText(path, content)
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dosya kaydedilemedi')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Düzenle: ${name}`}
      onClose={onClose}
      footer={<>
        <button className="cg-btn cg-btn-ghost" onClick={onClose}>Vazgeç</button>
        <button className="cg-btn cg-btn-primary" disabled={loading || saving} onClick={save}>
          {saving ? 'Kaydediliyor' : 'Uzak sunucuya kaydet'}
        </button>
      </>}
    >
      <div className="body body-single">
        {loading ? (
          <span className="cg-caption">Dosya yükleniyor...</span>
        ) : (
          <textarea
            aria-label="Dosya içeriği"
            className="cg-input mono cg-editor-textarea"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
          />
        )}
        {error && <Notice tone="error" title={error} />}
      </div>
    </Modal>
  )
}
