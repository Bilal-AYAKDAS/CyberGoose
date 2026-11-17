import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { api, apiToken, wsBase } from '../services/apiClient'
import type { ConnectionProfile } from '../types'
import { Icon } from './Icon'
import type { DirectTerminalTarget } from './RemoteAccessModal'

type TerminalDrawerProps = {
  connection?: ConnectionProfile | null
  directTarget?: DirectTerminalTarget | null
  theme: 'dark' | 'light'
  onOpenTunnels?: () => void
  onClose: () => void
}

type TabItem = { id: number; label: string }

const SNIPPETS = [
  { label: 'ls -la', cmd: 'ls -la\n' },
  { label: 'df -h', cmd: 'df -h\n' },
  { label: 'free -m', cmd: 'free -m\n' },
  { label: 'docker ps', cmd: 'docker ps\n' },
  { label: 'uname -a', cmd: 'uname -a\n' },
]

function TerminalPane({
  active,
  connection,
  directTarget,
  theme,
  onRegisterSender,
}: {
  active: boolean
  connection?: ConnectionProfile | null
  directTarget?: DirectTerminalTarget | null
  theme: 'dark' | 'light'
  onRegisterSender: (send: (text: string) => void) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
  const [errorText, setErrorText] = useState<string | null>(null)

  const targetKey = directTarget
    ? `direct:${directTarget.host}:${directTarget.port}:${directTarget.username}:${directTarget.connectionId ?? ''}`
    : `session:${connection?.id ?? ''}`

  useEffect(() => {
    onRegisterSender((text: string) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'input', data: text }))
      }
    })
  }, [onRegisterSender])

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

    const openRequest = directTarget
      ? api.connectTerminal({
        cols: term.cols,
        rows: term.rows,
        connectionId: directTarget.connectionId,
        host: directTarget.host,
        port: directTarget.port,
        username: directTarget.username,
        password: directTarget.password,
        keyPath: directTarget.keyPath,
      })
      : api.openTerminal(term.cols, term.rows)

    openRequest
      .then(({ id }) => {
        if (disposed) {
          void api.closeTerminal(id).catch(() => undefined)
          return
        }
        termId = id
        const token = apiToken()
        const query = token ? `?token=${encodeURIComponent(token)}` : ''
        socket = new WebSocket(`${wsBase()}/ws/terminal/${encodeURIComponent(id)}${query}`)
        socketRef.current = socket
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
      socketRef.current = null
      if (termId) void api.closeTerminal(termId).catch(() => undefined)
      term.dispose()
    }
  }, [targetKey, directTarget, theme])

  return (
    <div style={{ display: active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {status !== 'connected' && (
        <div className="cg-caption" style={{ padding: '2px 10px' }}>
          {status === 'connecting' ? 'Bağlanıyor...' : status === 'closed' ? 'Oturum kapandı' : (errorText ?? 'Hata')}
        </div>
      )}
      <div ref={hostRef} className="cg-terminal-body" />
    </div>
  )
}

/**
 * PuTTY benzeri çok sekmeli SSH terminali: snippet çubuğu ve tünel kısayolu içerir.
 */
export function TerminalDrawer({ connection, directTarget, theme, onOpenTunnels, onClose }: TerminalDrawerProps) {
  const baseLabel = directTarget
    ? directTarget.label
    : (connection?.username ? `${connection.username}@${connection.host}` : (connection?.host ?? 'SSH'))

  const [tabs, setTabs] = useState<TabItem[]>([{ id: 1, label: `${baseLabel} #1` }])
  const [activeTab, setActiveTab] = useState(1)
  const [expanded, setExpanded] = useState(false)
  const nextIdRef = useRef(2)
  const sendersRef = useRef<Record<number, (text: string) => void>>({})

  const addTab = () => {
    const id = nextIdRef.current++
    setTabs((items) => [...items, { id, label: `${baseLabel} #${id}` }])
    setActiveTab(id)
  }

  const closeTab = (id: number) => {
    setTabs((items) => {
      const remaining = items.filter((t) => t.id !== id)
      if (!remaining.length) {
        onClose()
        return items
      }
      if (activeTab === id) setActiveTab(remaining[remaining.length - 1].id)
      return remaining
    })
  }

  return (
    <section className={`cg-terminal ${expanded ? 'is-expanded' : ''}`} aria-label="SSH Terminali">
      <div className="cg-terminal-head">
        <Icon name="terminal" />
        <div className="cg-terminal-tabs" role="tablist" aria-label="Terminal sekmeleri">
          {tabs.map((tab) => (
            <div key={tab.id} className={`cg-terminal-tab ${tab.id === activeTab ? 'is-active' : ''}`}>
              <button role="tab" aria-selected={tab.id === activeTab} className="cg-btn cg-btn-ghost cg-btn-sm mono" onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
              <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label={`${tab.label} sekmesini kapat`} onClick={() => closeTab(tab.id)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Yeni terminal sekmesi" title="Yeni sekme" onClick={addTab}>
            <Icon name="plus" />
          </button>
        </div>
        <span className="grow" />
        <div className="cg-terminal-snippets">
          {SNIPPETS.map((s) => (
            <button key={s.label} className="cg-btn cg-btn-ghost cg-btn-sm mono" title={`Komutu gönder: ${s.label}`} onClick={() => sendersRef.current[activeTab]?.(s.cmd)}>
              {s.label}
            </button>
          ))}
        </div>
        {onOpenTunnels && !directTarget && (
          <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={onOpenTunnels}>Tüneller</button>
        )}
        <button className="cg-btn cg-btn-ghost cg-btn-sm" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Küçült' : 'Büyüt'}
        </button>
        <button className="cg-btn cg-btn-icon cg-btn-ghost cg-btn-sm" aria-label="Terminali kapat" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {tabs.map((tab) => (
        <TerminalPane
          key={tab.id}
          active={tab.id === activeTab}
          connection={connection}
          directTarget={directTarget}
          theme={theme}
          onRegisterSender={(fn) => { sendersRef.current[tab.id] = fn }}
        />
      ))}
    </section>
  )
}
