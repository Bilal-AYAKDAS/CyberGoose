import { useCallback, useReducer, type ReactNode } from 'react'
import type { MenuItem } from '../components/ContextMenu'
import type { DirectTerminalTarget, RemoteAccessMode } from '../components/RemoteAccessModal'
import type { ConnectionProfile, FileEntry } from '../types'

export type ConfirmState = {
  title: string
  message: ReactNode
  confirmLabel: string
  /** danger: silme gibi geri alınamaz eylem; default: güven onayı gibi nötr karar. */
  tone?: 'danger' | 'default'
  busyLabel?: string
  /** İkincil eylem (ör. "Kalıcı olarak sil"). */
  secondary?: { label: string; action: () => Promise<void> }
  action: () => Promise<void>
}

export type PromptState = {
  title: string
  label: string
  initialValue?: string
  confirmLabel: string
  placeholder?: string
  action: (value: string) => Promise<void>
}

export type OverlayState = {
  connectionDialog: { initial?: ConnectionProfile } | null
  confirm: ConfirmState | null
  prompt: PromptState | null
  menu: { x: number; y: number; items: MenuItem[] } | null
  inspected: FileEntry | null
  editing: FileEntry | null
  remoteAccess: RemoteAccessMode | null
  settings: boolean
  tunnels: boolean
  quickConnect: boolean
  terminal: { open: boolean; direct: DirectTerminalTarget | null }
}

const initialState: OverlayState = {
  connectionDialog: null,
  confirm: null,
  prompt: null,
  menu: null,
  inspected: null,
  editing: null,
  remoteAccess: null,
  settings: false,
  tunnels: false,
  quickConnect: false,
  terminal: { open: false, direct: null },
}

type Action =
  | { type: 'set'; changes: Partial<OverlayState> }
  | { type: 'toggle'; key: 'settings' | 'tunnels' | 'quickConnect' }

function reducer(state: OverlayState, action: Action): OverlayState {
  switch (action.type) {
    case 'set':
      return { ...state, ...action.changes }
    case 'toggle':
      return { ...state, [action.key]: !state[action.key] }
  }
}

/**
 * Pencerenin üstündeki tüm katmanların (diyaloglar, menü, detay, terminal) tek durumu.
 * App.tsx'teki çok sayıda bağımsız useState yerine tek reducer: hangi katmanın açık olduğu
 * tek yerden okunur ve klavye kısayolları buna göre kapatılır.
 */
export function useOverlays() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const set = useCallback((changes: Partial<OverlayState>) => dispatch({ type: 'set', changes }), [])
  const toggle = useCallback((key: 'settings' | 'tunnels' | 'quickConnect') => dispatch({ type: 'toggle', key }), [])
  /** Bir modal ya da menü açıkken genel kısayollar devre dışıdır. */
  const blocking = Boolean(
    state.connectionDialog || state.confirm || state.prompt || state.menu || state.remoteAccess
    || state.settings || state.tunnels || state.editing,
  )
  return { overlays: state, set, toggle, blocking }
}
