import { useState, type ReactNode } from 'react'
import { ApiError } from '../services/apiClient'
import type { ConnectionFormValues, ConnectionProfile, ConnectionType } from '../types'
import { defaultPort, isCloud, protocolLabel } from '../utils/formatters'
import { Modal } from './Modal'
import { Notice } from './Notice'

/** FTPS: açık TLS (AUTH TLS, varsayılan port 21), veri kanalı da şifrelenir. */
const protocols: { type: ConnectionType; disabled?: boolean }[] = [
  { type: 'FTP' },
  { type: 'FTPS' },
  { type: 'SFTP' },
  { type: 'Dropbox' },
  { type: 'GoogleDrive' },
]

type FieldErrors = Partial<Record<keyof ConnectionFormValues, string>>

export type ConnectOutcome = { pending: string } | void

type ConnectionModalProps = {
  initial?: ConnectionProfile
  /** Profili parolasız kaydeder (yeni veya düzenleme). */
  onSave: (values: ConnectionFormValues) => Promise<void>
  /** Bağlanır; yeni sunucu bağlantısını parolasız kaydeder. Dropbox izni bekliyorsa `pending` döner. */
  onConnect: (values: ConnectionFormValues) => Promise<ConnectOutcome>
  onClose: () => void
}

/**
 * Yeni bağlantı / bağlantı düzenleme diyaloğu (tasarımdaki ConnectionDialog).
 * Footer: Vazgeç (ghost) · Kaydet (secondary) · Bağlan (primary). Enter = Bağlan, Esc = Vazgeç.
 * Parola yalnızca bağlantı isteğinde gönderilir; profilde ve kenar çubuğunda saklanmaz.
 */
export function ConnectionModal({ initial, onSave, onConnect, onClose }: ConnectionModalProps) {
  const [values, setValues] = useState<ConnectionFormValues>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'SFTP',
    host: initial?.host ?? '',
    port: initial?.port ?? defaultPort(initial?.type ?? 'SFTP'),
    username: initial?.username ?? '',
    password: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [connectError, setConnectError] = useState<{ message: string; code?: string } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const storedPassword = Boolean(initial?.hasPassword)
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
      if (forConnect && !values.password && !storedPassword) next.password = 'Bağlanmak için parolayı girin.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const describe = (error: unknown) => ({
    message: error instanceof Error ? error.message : 'Bağlantı kurulamadı.',
    code: error instanceof ApiError && error.code ? error.code : undefined,
  })

  const save = async () => {
    if (isConnecting || !validate(false)) return
    setIsConnecting(true)
    try {
      await onSave(values)
      onClose()
    } catch (error) {
      setConnectError(describe(error))
      setIsConnecting(false)
    }
  }

  const connect = async () => {
    if (isConnecting || !validate(true)) return
    setIsConnecting(true)
    setPending(null)
    try {
      const outcome = await onConnect(values)
      if (outcome && 'pending' in outcome) {
        setPending(outcome.pending)
        setIsConnecting(false)
        return
      }
      onClose()
    } catch (error) {
      setConnectError(describe(error))
      setIsConnecting(false)
    }
  }

  const footer = <>
    <button className="cg-btn cg-btn-ghost" onClick={onClose}>Vazgeç</button>
    {!cloud && <button className="cg-btn" disabled={isConnecting} onClick={save}>Kaydet</button>}
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
                title={disabled ? 'Bu protokol henüz desteklenmiyor' : undefined}
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
              {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="password" className={`cg-input ${errors.password ? 'is-error' : ''}`} value={values.password} onChange={(event) => update('password', event.target.value)} autoComplete="current-password" placeholder={storedPassword ? 'Kayıtlı parola kullanılacak' : undefined} />}
            </Field>
            {values.type === 'FTP' && (
              <div className="wide">
                <Notice title="Düz FTP şifrelenmez.">Parola ve dosyalar ağda açık metin olarak gider. Mümkünse SFTP kullanın.</Notice>
              </div>
            )}
          </>
        )}

        {pending && (
          <div className="wide">
            <Notice title="İzin bekleniyor">{pending}</Notice>
          </div>
        )}
        {connectError && (
          <div className="wide" title={connectError.code}>
            <Notice tone="error" title={connectError.message} />
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
