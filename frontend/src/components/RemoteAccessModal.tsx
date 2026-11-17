import { useState } from 'react'
import type { ConnectionProfile } from '../types'
import { Modal } from './Modal'
import { Notice } from './Notice'

export type RemoteAccessMode = 'ssh' | 'rdp'

export type DirectTerminalTarget = {
  label: string
  connectionId?: string
  host?: string
  port?: string
  username?: string
  password?: string
  keyPath?: string
}

type RemoteAccessModalProps = {
  initialMode: RemoteAccessMode
  savedConnections: ConnectionProfile[]
  onOpenSsh: (target: DirectTerminalTarget) => void
  onClose: () => void
}

function downloadRdpFile(host: string, port: string, username: string) {
  const address = port && port !== '3389' ? `${host}:${port}` : host
  const lines = [
    `full address:s:${address}`,
    ...(username ? [`username:s:${username}`] : []),
    'prompt for credentials:i:1',
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'application/x-rdp' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${host}.rdp`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * SSH terminali ve Windows Uzak Masaüstü (RDP) bağlantı penceresi.
 * Tasarım sistemindeki Modal + segmented kontrol + Graphite/Paper token'larını kullanır.
 */
export function RemoteAccessModal({ initialMode, savedConnections, onOpenSsh, onClose }: RemoteAccessModalProps) {
  const [mode, setMode] = useState<RemoteAccessMode>(initialMode)
  const [selectedId, setSelectedId] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(initialMode === 'ssh' ? '22' : '3389')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const serverProfiles = savedConnections.filter((item) => item.saved)

  const switchMode = (next: RemoteAccessMode) => {
    setMode(next)
    setError(null)
    if (next === 'ssh' && (port === '3389' || !port)) setPort('22')
    if (next === 'rdp' && (port === '22' || !port)) setPort('3389')
  }

  const pickSaved = (id: string) => {
    setSelectedId(id)
    setError(null)
    const found = serverProfiles.find((item) => item.id === id)
    if (!found) return
    setHost(found.host)
    setPort(mode === 'ssh' ? (found.type === 'SFTP' ? found.port : '22') : '3389')
    setUsername(found.username)
    setPassword('')
  }

  const selectedProfile = serverProfiles.find((item) => item.id === selectedId)
  const hasStoredPassword = Boolean(selectedProfile?.hasPassword)

  const submit = async () => {
    const cleanHost = host.trim()
    const cleanUser = username.trim()
    if (!cleanHost) {
      setError('Sunucu adresi gerekli.')
      return
    }
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      setError('Port 1–65535 arasında olmalı.')
      return
    }

    if (mode === 'ssh') {
      if (!cleanUser) {
        setError('SSH için kullanıcı adı gerekli.')
        return
      }
      if (!password && !keyPath.trim() && !hasStoredPassword) {
        setError('Parola veya özel anahtar yolu girin.')
        return
      }
      onOpenSsh({
        label: `${cleanUser}@${cleanHost}`,
        connectionId: selectedProfile && !password && !keyPath.trim() ? selectedProfile.id : undefined,
        host: cleanHost,
        port,
        username: cleanUser,
        password: password || undefined,
        keyPath: keyPath.trim() || undefined,
      })
      onClose()
      return
    }

    setBusy(true)
    setError(null)
    try {
      if (window.cyberGoose?.launchRdp) {
        await window.cyberGoose.launchRdp(cleanHost, Number(port))
      } else {
        downloadRdpFile(cleanHost, port, cleanUser)
      }
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Uzak Masaüstü başlatılamadı.')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'ssh' ? 'SSH terminali' : 'Uzak Masaüstü (RDP)'}
      onClose={onClose}
      onSubmit={submit}
      footer={<>
        <button className="cg-btn cg-btn-ghost" onClick={onClose}>Vazgeç</button>
        <button className="cg-btn cg-btn-primary" disabled={busy} onClick={submit}>
          {mode === 'ssh' ? 'Terminali aç' : (window.cyberGoose?.launchRdp ? 'Uzak Masaüstünü başlat' : '.rdp dosyası indir')}
        </button>
      </>}
    >
      <div className="body">
        <div className="cg-field wide">
          <span className="cg-field-label" id="remote-mode-label">Erişim türü</span>
          <div className="cg-seg" role="radiogroup" aria-labelledby="remote-mode-label">
            <button role="radio" aria-checked={mode === 'ssh'} className={mode === 'ssh' ? 'is-on' : undefined} onClick={() => switchMode('ssh')}>
              SSH Terminal
            </button>
            <button role="radio" aria-checked={mode === 'rdp'} className={mode === 'rdp' ? 'is-on' : undefined} onClick={() => switchMode('rdp')}>
              Uzak Masaüstü (RDP)
            </button>
          </div>
        </div>

        {serverProfiles.length > 0 && (
          <div className="cg-field wide">
            <span className="cg-field-label" id="ra-saved-label">Kayıtlı sunucudan doldur</span>
            <div className="cg-chips" role="radiogroup" aria-labelledby="ra-saved-label">
              {serverProfiles.map((item) => (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={selectedId === item.id}
                  className={`cg-chip ${selectedId === item.id ? 'is-on' : ''}`}
                  title={`${item.username ? `${item.username}@` : ''}${item.host}`}
                  onClick={() => (selectedId === item.id ? setSelectedId('') : pickSaved(item.id))}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="cg-field">
          <label htmlFor="ra-host">Sunucu / IP</label>
          <input id="ra-host" className="cg-input mono" value={host} onChange={(event) => { setHost(event.target.value); setError(null) }} placeholder="10.0.4.21" autoFocus spellCheck={false} />
        </div>
        <div className="cg-field">
          <label htmlFor="ra-port">Port</label>
          <input id="ra-port" className="cg-input mono" inputMode="numeric" value={port} onChange={(event) => { setPort(event.target.value); setError(null) }} />
        </div>

        <div className="cg-field wide">
          <label htmlFor="ra-user">{mode === 'ssh' ? 'Kullanıcı adı' : 'Kullanıcı adı (isteğe bağlı)'}</label>
          <input id="ra-user" className="cg-input" value={username} onChange={(event) => { setUsername(event.target.value); setError(null) }} placeholder={mode === 'ssh' ? 'root' : 'Administrator'} spellCheck={false} />
        </div>

        {mode === 'ssh' ? (
          <>
            <div className="cg-field wide">
              <label htmlFor="ra-pass">Parola</label>
              <input id="ra-pass" type="password" className="cg-input" value={password} onChange={(event) => { setPassword(event.target.value); setError(null) }} placeholder={hasStoredPassword ? 'Kayıtlı parola kullanılacak' : undefined} />
            </div>
            <div className="cg-field wide">
              <label htmlFor="ra-key">Özel anahtar yolu (isteğe bağlı)</label>
              <input id="ra-key" className="cg-input mono" value={keyPath} onChange={(event) => { setKeyPath(event.target.value); setError(null) }} placeholder="C:\Users\...\id_ed25519" spellCheck={false} />
            </div>
          </>
        ) : (
          <div className="wide">
            <Notice title="Windows Uzak Masaüstü (RDP · Port 3389)">
              {window.cyberGoose?.launchRdp
                ? 'Bağlantı Windows Uzak Masaüstü (mstsc.exe) istemcisiyle açılır.'
                : 'Tarayıcı kipinde .rdp bağlantı dosyası indirilir; çift tıklayarak açabilirsiniz.'}
            </Notice>
          </div>
        )}

        {error && (
          <div className="wide">
            <Notice tone="error" title={error} />
          </div>
        )}
      </div>
    </Modal>
  )
}
