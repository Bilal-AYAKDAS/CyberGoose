import { useState } from 'react'
import { api } from '../services/apiClient'
import type { ConnectionFormValues, ConnectionProfile, ConnectionType } from '../types'
import { Modal } from './Modal'

const connectionTypes: ConnectionType[] = ['FTP', 'SFTP', 'S3', 'Dropbox', 'GoogleDrive']

type ConnectionModalProps = {
  initial?: ConnectionProfile
  onClose: () => void
  onSaved: (profile: ConnectionProfile) => void
}

export function ConnectionModal({ initial, onClose, onSaved }: ConnectionModalProps) {
  const [values, setValues] = useState<ConnectionFormValues>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'SFTP',
    host: initial?.host ?? '',
    port: initial?.port ?? '22',
    username: initial?.username ?? '',
    path: initial?.path ?? '/',
  })
  const [error, setError] = useState('')
  const [isTesting, setIsTesting] = useState(false)

  const update = (key: keyof ConnectionFormValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const validate = () => {
    if (!values.name.trim() || !values.host.trim() || !values.port.trim()) {
      setError('Bağlantı adı, host ve port zorunludur.')
      return false
    }
    if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) {
      setError('Port 1 ile 65535 arasında bir sayı olmalıdır.')
      return false
    }
    return true
  }

  const save = async () => {
    if (!validate()) return
    setIsTesting(true)
    try {
      await api.connect({
        conn_type: values.type,
        server: values.host,
        port: values.port,
        username: values.username,
      })
      onSaved({ ...values, id: initial?.id ?? crypto.randomUUID(), status: 'connected' })
      onClose()
    } catch {
      setError('Bağlantı kurulamadı. Bilgileri ve Flask API durumunu kontrol edin.')
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal title={initial ? 'Bağlantıyı düzenle' : 'Yeni bağlantı'} description="Uzak depolama profilini güvenli şekilde tanımlayın." onClose={onClose}>
      <div className="form-grid">
        <label>Bağlantı adı<input value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="Üretim sunucusu" /></label>
        <label>Sağlayıcı<select value={values.type} onChange={(event) => update('type', event.target.value)}>{connectionTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>Host / endpoint<input value={values.host} onChange={(event) => update('host', event.target.value)} placeholder="server.example.com" /></label>
        <label>Port<input inputMode="numeric" value={values.port} onChange={(event) => update('port', event.target.value)} /></label>
        <label>Kullanıcı adı<input value={values.username} onChange={(event) => update('username', event.target.value)} /></label>
        <label>Başlangıç yolu<input className="mono-input" value={values.path} onChange={(event) => update('path', event.target.value)} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>İptal</button><button className="primary-button" disabled={isTesting} onClick={save}>{isTesting ? 'Test ediliyor...' : 'Bağlan ve kaydet'}</button></footer>
    </Modal>
  )
}
