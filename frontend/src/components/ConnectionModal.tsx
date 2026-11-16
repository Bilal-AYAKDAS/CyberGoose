import { useState, type ReactNode } from 'react'
import { ApiError, api } from '../services/apiClient'
import type { ConnectionFormValues, ConnectionProfile, ConnectionType } from '../types'
import { defaultPort, isCloud, protocolLabel } from '../utils/formatters'
import { Modal } from './Modal'
import { Notice } from './Notice'

/** FTPS tasarımda var ama Flask backend'inde henüz yok; seçenek görünür ve devre dışıdır. */
const protocols: { type: ConnectionType; disabled?: boolean }[] = [
  { type: 'FTP' },
  { type: 'FTPS', disabled: true },
  { type: 'SFTP' },
  { type: 'Dropbox' },
  { type: 'GoogleDrive' },
]

type FieldErrors = Partial<Record<keyof ConnectionFormValues, string>>

type ConnectionModalProps = {
  initial?: ConnectionProfile
  onClose: () => void
  onSaved: (profile: ConnectionProfile) => void
}

/**
 * Yeni bağlantı / bağlantı düzenleme diyaloğu (tasarımdaki ConnectionDialog).
 * Footer: Vazgeç (ghost) · Kaydet (secondary) · Bağlan (primary). Enter = Bağlan, Esc = Vazgeç.
 * Parola yalnızca bağlantı isteğinde gönderilir; profilde ve kenar çubuğunda saklanmaz.
 */
export function ConnectionModal({ initial, onClose, onSaved }: ConnectionModalProps) {
  const [values, setValues] = useState<ConnectionFormValues>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'SFTP',
    host: initial?.host ?? '',
    port: initial?.port ?? defaultPort(initial?.type ?? 'SFTP'),
    username: initial?.username ?? '',
    path: initial?.path ?? '/',
    password: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [connectError, setConnectError] = useState<{ message: string; code?: string } | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const cloud = isCloud(values.type)

  const update = (key: keyof ConnectionFormValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setConnectError(null)
  }

  const selectType = (type: ConnectionType) => {
    setValues((current) => ({
      ...current,
      type,
      port: current.port === defaultPort(current.type) || !current.port ? defaultPort(type) : current.port,
      name: current.name || (isCloud(type) ? protocolLabelName(type) : current.name),
    }))
    setErrors({})
    setConnectError(null)
  }

  const validate = (forConnect: boolean): boolean => {
    const next: FieldErrors = {}
    if (!values.name.trim()) next.name = 'Bağlantı adı gerekli.'
    if (!cloud) {
      if (!values.host.trim()) next.host = 'Sunucu gerekli.'
      if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) next.port = '1–65535'
      if (!values.username.trim()) next.username = 'Kullanıcı adı gerekli.'
      if (forConnect && !values.password) next.password = 'Bağlanmak için parolayı girin.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const toProfile = (status: ConnectionProfile['status']): ConnectionProfile => ({
    id: initial?.id ?? crypto.randomUUID(),
    name: values.name.trim(),
    type: values.type,
    host: cloud ? (values.type === 'Dropbox' ? 'dropbox.com' : 'drive.google.com') : values.host.trim(),
    port: cloud ? '' : values.port,
    username: values.username.trim(),
    path: values.path.trim() || '/',
    status,
  })

  const save = () => {
    if (!validate(false)) return
    onSaved(toProfile(initial?.status ?? 'offline'))
    onClose()
  }

  const connect = async () => {
    if (isConnecting || !validate(true)) return
    setIsConnecting(true)
    try {
      await api.connect({ type: values.type, host: values.host.trim(), port: values.port, username: values.username.trim(), password: values.password })
      onSaved(toProfile('connected'))
      onClose()
    } catch (error) {
      const target = cloud ? protocolLabelName(values.type) : values.host.trim()
      setConnectError({
        message: `${target} bağlantısı kurulamadı.`,
        code: error instanceof ApiError ? `${error.status} · ${error.message}` : undefined,
      })
    } finally {
      setIsConnecting(false)
    }
  }

  const footer = <>
    <button className="cg-btn cg-btn-ghost" onClick={onClose}>Vazgeç</button>
    <button className="cg-btn" onClick={save}>Kaydet</button>
    <button className="cg-btn cg-btn-primary" disabled={isConnecting} onClick={connect}>{isConnecting ? 'Bağlanıyor' : 'Bağlan'}</button>
  </>

  return (
    <Modal title={initial ? 'Bağlantıyı düzenle' : 'Yeni bağlantı'} footer={footer} onClose={onClose} onSubmit={connect}>
      <div className="body">
        <div className="cg-field wide">
          <span className="cg-field-label" id="protocol-label">Protokol</span>
          <div className="cg-seg" role="radiogroup" aria-labelledby="protocol-label">
            {protocols.map(({ type, disabled }) => (
              <button
                key={type}
                role="radio"
                aria-checked={values.type === type}
                className={values.type === type ? 'is-on' : undefined}
                disabled={disabled}
                title={disabled ? 'FTPS desteği backend tarafında henüz yok' : undefined}
                onClick={() => selectType(type)}
              >
                {protocolLabel(type)}
              </button>
            ))}
          </div>
        </div>

        <Field label="Bağlantı adı" error={errors.name} wide>
          {(id, describedBy) => <input id={id} aria-describedby={describedBy} className={`cg-input ${errors.name ? 'is-error' : ''}`} value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="Üretim sunucusu" />}
        </Field>

        {cloud ? (
          <div className="cg-field wide">
            <span className="cg-help">Hesap izni varsayılan tarayıcınızda açılır. İzin verdikten sonra bu pencereye dönün.</span>
            <div><button className="cg-btn" disabled={isConnecting} onClick={connect}>Hesabı bağla</button></div>
          </div>
        ) : (
          <>
            <Field label="Sunucu" error={errors.host}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} className={`cg-input mono ${errors.host ? 'is-error' : ''}`} value={values.host} onChange={(event) => update('host', event.target.value)} placeholder="10.0.4.21" autoComplete="off" spellCheck={false} />}
            </Field>
            <Field label="Port" error={errors.port}>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} className={`cg-input mono ${errors.port ? 'is-error' : ''}`} inputMode="numeric" value={values.port} onChange={(event) => update('port', event.target.value)} />}
            </Field>
            <Field label="Kullanıcı adı" error={errors.username} wide>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} className={`cg-input ${errors.username ? 'is-error' : ''}`} value={values.username} onChange={(event) => update('username', event.target.value)} autoComplete="username" spellCheck={false} />}
            </Field>
            <Field label="Parola" error={errors.password} wide>
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="password" className={`cg-input ${errors.password ? 'is-error' : ''}`} value={values.password} onChange={(event) => update('password', event.target.value)} autoComplete="current-password" />}
            </Field>
            <Field label="Başlangıç yolu" wide>
              {(id) => <input id={id} className="cg-input mono" value={values.path} onChange={(event) => update('path', event.target.value)} spellCheck={false} />}
            </Field>
            {values.type === 'FTP' && (
              <div className="wide">
                <Notice title="Düz FTP şifrelenmez.">Parola ve dosyalar ağda açık metin olarak gider. Mümkünse SFTP kullanın.</Notice>
              </div>
            )}
          </>
        )}

        {connectError && (
          <div className="wide" title={connectError.code}>
            <Notice tone="error" title={connectError.message}>
              {cloud ? 'Hesap iznini ve internet bağlantınızı kontrol edin.' : 'Sunucu, port ve parolayı kontrol edin; Flask API çalışıyor olmalı.'}
            </Notice>
          </div>
        )}
      </div>
    </Modal>
  )
}

function protocolLabelName(type: ConnectionType): string {
  if (type === 'Dropbox') return 'Dropbox'
  if (type === 'GoogleDrive') return 'Google Drive'
  return type
}

type FieldProps = {
  label: string
  error?: string
  wide?: boolean
  children: (id: string, describedBy?: string) => ReactNode
}

function Field({ label, error, wide, children }: FieldProps) {
  const id = `field-${label.toLocaleLowerCase('tr').replace(/\s+/g, '-')}`
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className={`cg-field ${wide ? 'wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, errorId)}
      {error && <span className="cg-help error" id={errorId}>{error}</span>}
    </div>
  )
}
