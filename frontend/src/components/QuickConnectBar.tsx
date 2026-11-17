import { useEffect, useRef, useState } from 'react'
import { hostKeyOf, type HostKeyInfo } from '../services/apiClient'
import type { QuickConnectValues } from '../hooks/useConnections'
import type { ConnectionType } from '../types'
import { defaultPort } from '../utils/formatters'
import { HostKeyNotice } from './HostKeyNotice'
import { Icon } from './Icon'

type QuickConnectBarProps = {
  onConnect: (values: QuickConnectValues, trustHostKey?: string) => Promise<void>
  onClose: () => void
}

const TYPES: ConnectionType[] = ['SFTP', 'FTPS', 'FTP']

/**
 * Hızlı bağlan çubuğu (Ctrl+K): kaydetmeden tek seferlik bağlantı. Parola yalnızca bağlantı
 * isteğinde gider; hiçbir yerde saklanmaz. "user@host:port" yapıştırılırsa alanlar doldurulur.
 */
export function QuickConnectBar({ onConnect, onClose }: QuickConnectBarProps) {
  const [values, setValues] = useState<QuickConnectValues>({ type: 'SFTP', host: '', port: '22', username: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hostKey, setHostKey] = useState<HostKeyInfo | null>(null)
  const hostRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    hostRef.current?.focus()
    return () => { if (opener?.isConnected && opener !== document.body) opener.focus() }
  }, [])

  const update = (patch: Partial<QuickConnectValues>) => {
    setValues((current) => ({ ...current, ...patch }))
    setError(null)
    setHostKey(null)
  }

  /** "sftp://user@host:port" biçimini alanlara böler; yazarken değil, yapıştırınca ve alandan çıkınca. */
  const parseTarget = (current: QuickConnectValues): QuickConnectValues => {
    const match = /^(?:(sftp|ftps|ftp):\/\/)?(?:([^@\s]+)@)?([^:\s/]+)(?::(\d+))?\/?$/i.exec(current.host.trim())
    if (!match || !(match[1] || match[2] || match[4])) return current
    const type = (match[1]?.toUpperCase() as ConnectionType | undefined) ?? current.type
    return { ...current, type, username: match[2] ?? current.username, host: match[3], port: match[4] ?? (match[1] ? defaultPort(type) : current.port) }
  }

  const applyTarget = () => setValues((current) => parseTarget(current))

  const submit = async (trustHostKey?: string) => {
    if (busy) return
    const target = parseTarget(values)
    if (target !== values) setValues(target)
    if (!target.host.trim() || !target.username.trim()) {
      setError('Sunucu ve kullanıcı adı gerekli.')
      return
    }
    if (!/^\d+$/.test(target.port) || Number(target.port) < 1 || Number(target.port) > 65535) {
      setError('Port 1–65535 arasında olmalı.')
      return
    }
    setBusy(true)
    setError(null)
    setHostKey(null)
    try {
      await onConnect(target, trustHostKey)
      onClose()
    } catch (caught) {
      const key = hostKeyOf(caught)
      if (key && !trustHostKey) setHostKey(key)
      else setError(caught instanceof Error ? caught.message : 'Bağlantı kurulamadı')
      setBusy(false)
    }
  }

  return (
    <div className="cg-quick" role="search" aria-label="Hızlı bağlan">
      <form
        className="cg-quick-row"
        onSubmit={(event) => { event.preventDefault(); void submit() }}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
      >
        <div className="cg-seg cg-seg-sm" role="radiogroup" aria-label="Protokol">
          {TYPES.map((type) => (
            <button
              type="button"
              key={type}
              role="radio"
              aria-checked={values.type === type}
              className={values.type === type ? 'is-on' : undefined}
              onClick={() => update({ type, port: values.port === defaultPort(values.type) ? defaultPort(type) : values.port })}
            >
              {type}
            </button>
          ))}
        </div>
        <input ref={hostRef} className="cg-input mono" aria-label="Sunucu" placeholder="sunucu veya user@sunucu:port" value={values.host} onChange={(event) => update({ host: event.target.value })} onBlur={applyTarget} onPaste={(event) => {
          const text = event.clipboardData.getData('text')
          if (!text) return
          event.preventDefault()
          setValues((current) => parseTarget({ ...current, host: text }))
          setError(null)
        }} spellCheck={false} autoComplete="off" />
        <input className="cg-input mono cg-quick-port" aria-label="Port" inputMode="numeric" value={values.port} onChange={(event) => update({ port: event.target.value })} />
        <input className="cg-input" aria-label="Kullanıcı adı" placeholder="Kullanıcı" value={values.username} onChange={(event) => update({ username: event.target.value })} spellCheck={false} autoComplete="off" />
        <input className="cg-input" aria-label="Parola" placeholder="Parola" type="password" value={values.password} onChange={(event) => update({ password: event.target.value })} autoComplete="off" />
        <button type="submit" className="cg-btn cg-btn-primary" disabled={busy}>{busy ? 'Bağlanıyor' : 'Bağlan'}</button>
        <button type="button" className="cg-btn cg-btn-icon cg-btn-ghost" aria-label="Hızlı bağlanı kapat" onClick={onClose}><Icon name="close" /></button>
      </form>
      {hostKey && <HostKeyNotice info={hostKey} onTrust={() => { void submit(hostKey.fingerprint) }} onCancel={() => setHostKey(null)} />}
      {error && <p className="cg-help error" role="alert">{error}</p>}
    </div>
  )
}
