import { useEffect, useState } from 'react'
import { api } from '../services/apiClient'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { Notice } from './Notice'

type Tunnel = { id: string; localPort: number; remoteHost: string; remotePort: number }

export function TunnelModal({ onClose }: { onClose: () => void }) {
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [localPort, setLocalPort] = useState('5432')
  const [remoteHost, setRemoteHost] = useState('127.0.0.1')
  const [remotePort, setRemotePort] = useState('5432')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.listTunnels().then((items) => { if (active) setTunnels(items) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await api.createTunnel({
        localPort: Number(localPort),
        remoteHost: remoteHost.trim(),
        remotePort: Number(remotePort),
      })
      setTunnels((items) => [...items, created])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tünel açılamadı')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    await api.deleteTunnel(id).catch(() => undefined)
    setTunnels((items) => items.filter((item) => item.id !== id))
  }

  return (
    <Modal
      title="SSH Port Yönlendirme (Tünel)"
      onClose={onClose}
      footer={<button className="cg-btn cg-btn-primary" onClick={onClose}>Kapat</button>}
    >
      <div className="body">
        <div className="cg-field">
          <label htmlFor="tun-host">Hedef sunucu</label>
          <input id="tun-host" className="cg-input mono" value={remoteHost} onChange={(e) => setRemoteHost(e.target.value)} />
        </div>
        <div className="cg-field">
          <label htmlFor="tun-rport">Hedef port</label>
          <input id="tun-rport" className="cg-input mono" inputMode="numeric" value={remotePort} onChange={(e) => setRemotePort(e.target.value)} />
        </div>
        <div className="cg-field">
          <label htmlFor="tun-lport">Yerel port</label>
          <input id="tun-lport" className="cg-input mono" inputMode="numeric" value={localPort} onChange={(e) => setLocalPort(e.target.value)} />
        </div>
        <div className="cg-field cg-field-end">
          <button className="cg-btn" disabled={busy} onClick={add}>Tünel aç</button>
        </div>

        {error && <div className="wide"><Notice tone="error" title={error} /></div>}

        <div className="cg-field wide">
          <span className="cg-field-label">Etkin tüneller</span>
          {!tunnels.length ? (
            <span className="cg-help">Açık tünel yok.</span>
          ) : (
            <ul className="cg-bookmark-list">
              {tunnels.map((t) => (
                <li key={t.id} className="cg-bookmark-row">
                  <span className="mono">127.0.0.1:{t.localPort} → {t.remoteHost}:{t.remotePort}</span>
                  <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Tüneli kapat" onClick={() => remove(t.id)}>
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
