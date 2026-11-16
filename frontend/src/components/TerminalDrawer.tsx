import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { api, apiToken, wsBase } from '../services/apiClient'
import type { ConnectionProfile } from '../types'
import { Icon } from './Icon'

type TerminalDrawerProps = {
  connection: ConnectionProfile
  theme: 'dark' | 'light'
  onClose: () => void
}

/**
 * PuTTY benzeri dahili SSH terminali: aktif SFTP bağlantısı üzerinden WebSocket + PTY kabuğu açar.
 */
export function TerminalDrawer({ connection, theme, onClose }: TerminalDrawerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    const container = hostRef.current
    if (!container) return

    let disposed = false
    let termId: string | null = null
    let socket: WebSocket | null = null

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: theme === 'dark'
        ? { background: '#121518', foreground: '#E6E8EB', cursor: '#F97316' }
        : { background: '#FAF8F5', foreground: '#1D2024', cursor: '#EA580C' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    const sendResize = () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }

    const observer = new ResizeObserver(() => {
      fit.fit()
      sendResize()
    })
    observer.observe(container)

    const inputDispose = term.onData((data) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    api.openTerminal(term.cols, term.rows)
      .then(({ id }) => {
        if (disposed) {
          void api.closeTerminal(id).catch(() => undefined)
          return
        }
        termId = id
        const token = apiToken()
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        socket = new WebSocket(`${wsBase()}/ws/terminal/${encodeURIComponent(id)}${query}`)
        socket.onopen = () => {
          if (disposed) return
          setStatus('connected')
          sendResize()
          term.focus()
        }
        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data)) as { type: string; data?: string }
            if (msg.type === 'output' && msg.data) term.write(msg.data)
            else if (msg.type === 'exit') setStatus('closed')
            else if (msg.type === 'error') {
              setStatus('error')
              setErrorText(msg.data ?? 'Terminal hatası')
            }
          } catch {
            // Geçersiz mesaj yoksayılır.
          }
        }
        socket.onerror = () => {
          if (!disposed) {
            setStatus('error')
            setErrorText('Terminal bağlantısı kesildi')
          }
        }
        socket.onclose = () => {
          if (!disposed) setStatus((current) => (current === 'error' ? current : 'closed'))
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setStatus('error')
          setErrorText(error instanceof Error ? error.message : 'Terminal açılamadı')
        }
      })

    return () => {
      disposed = true
      observer.disconnect()
      inputDispose.dispose()
      socket?.close()
      if (termId) void api.closeTerminal(termId).catch(() => undefined)
      term.dispose()
    }
  }, [connection.id, theme])

  const label = connection.username ? `${connection.username}@${connection.host}` : connection.host
  const statusLabel = status === 'connected' ? 'bağlı' : status === 'connecting' ? 'bağlanıyor' : status === 'closed' ? 'kapandı' : (errorText ?? 'hata')

  return (
    <section className="cg-terminal" aria-label="SSH Terminali">
      <div className="cg-terminal-head">
        <Icon name="terminal" />
        <span className="mono">{label}</span>
        <span className="cg-caption">· {statusLabel}</span>
        <span className="grow" />
        <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Terminali kapat" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div ref={hostRef} className="cg-terminal-body" />
    </section>
  )
}
