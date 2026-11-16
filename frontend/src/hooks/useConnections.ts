import { useCallback, useMemo, useState } from 'react'
import { ApiError, api } from '../services/apiClient'
import type { ConnectionFormValues, ConnectionProfile, ConnectionStatus, SavedConnection } from '../types'
import { isCloud } from '../utils/formatters'
import type { ConnectOutcome } from '../components/ConnectionModal'

/** Bulut hesapları kayıtlı bağlantı değildir; kenar çubuğunda her zaman görünür. */
export const CLOUD_ACCOUNTS: ConnectionProfile[] = [
  { id: 'dropbox', name: 'Dropbox', type: 'Dropbox', host: '', port: '', username: '', hasPassword: false, saved: false },
  { id: 'drive', name: 'Google Drive', type: 'GoogleDrive', host: '', port: '', username: '', hasPassword: false, saved: false },
  { id: 'onedrive', name: 'OneDrive', type: 'OneDrive', host: '', port: '', username: '', hasPassword: false, saved: false },
]

export const toProfile = (saved: SavedConnection): ConnectionProfile => ({
  id: String(saved.id),
  name: saved.name,
  type: saved.type,
  host: saved.host,
  port: saved.port,
  username: saved.username,
  hasPassword: saved.hasPassword,
  saved: true,
})

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

type UseConnectionsOptions = {
  onConnected: (startPath: string) => void
  onDisconnected: () => void
  onNeedPassword: (connection: ConnectionProfile) => void
  onNotice: (notice: { tone: 'warn' | 'error'; title: string } | null) => void
}

export function useConnections({ onConnected, onDisconnected, onNeedPassword, onNotice }: UseConnectionsOptions) {
  const [savedConnections, setSavedConnections] = useState<ConnectionProfile[]>([])
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [connectedId, setConnectedId] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const connections = useMemo(() => [...savedConnections, ...CLOUD_ACCOUNTS], [savedConnections])
  const activeConnection = connections.find((connection) => connection.id === activeId) ?? null

  const statusOf = useCallback((id: string): ConnectionStatus => {
    if (id === connectingId) return 'connecting'
    if (id === connectedId) return 'connected'
    if (id === failedId) return 'error'
    return 'offline'
  }, [connectedId, connectingId, failedId])

  const activeStatus: ConnectionStatus = activeConnection ? statusOf(activeConnection.id) : 'offline'
  const isConnected = activeStatus === 'connected'

  const loadConnections = useCallback(async () => {
    try {
      setSavedConnections((await api.listConnections()).map(toProfile))
      setConnectionsError(null)
    } catch (error) {
      setConnectionsError(messageOf(error, 'Kayıtlı bağlantılar yüklenemedi'))
    }
  }, [])

  const connectTo = useCallback(async (connection: ConnectionProfile, password?: string, startPath = '/', keyPath?: string): Promise<ConnectOutcome> => {
    setConnectingId(connection.id)
    setFailedId(null)
    setActiveId(connection.id)
    onNotice(null)
    try {
      const result = await api.connect({
        type: connection.type,
        connectionId: connection.saved ? connection.id : undefined,
        clientId: connection.id,
        password,
        keyPath,
      })
      if ('pending' in result) return { pending: result.message }
      setConnectedId(connection.id)
      onConnected(startPath)
    } catch (error) {
      setFailedId(connection.id)
      throw error
    } finally {
      setConnectingId((current) => (current === connection.id ? null : current))
    }
  }, [onConnected, onNotice])

  const openConnection = useCallback(async (connection: ConnectionProfile, startPath = '/') => {
    if (statusOf(connection.id) === 'connected') {
      setActiveId(connection.id)
      onConnected(startPath)
      return
    }
    if (connection.saved && !connection.hasPassword) {
      onNeedPassword(connection)
      return
    }
    try {
      const outcome = await connectTo(connection, undefined, startPath)
      if (outcome && 'pending' in outcome) onNotice({ tone: 'warn', title: outcome.pending })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'password_required') {
        onNeedPassword(connection)
        return
      }
      onNotice({ tone: 'error', title: messageOf(error, 'Bağlantı kurulamadı') })
    }
  }, [connectTo, onConnected, onNeedPassword, onNotice, statusOf])

  const disconnect = useCallback(async () => {
    await api.disconnect().catch(() => undefined)
    setConnectedId(null)
    onDisconnected()
  }, [onDisconnected])

  const saveFromDialog = useCallback(async (values: ConnectionFormValues, initial?: ConnectionProfile) => {
    const input = {
      name: values.name.trim(),
      type: values.type,
      host: values.host.trim(),
      port: values.port,
      username: values.username.trim(),
      ...(values.password ? { password: values.password } : {}),
    }
    const saved = initial?.saved ? await api.updateConnection(initial.id, input) : await api.createConnection(input)
    await loadConnections()
    return toProfile(saved)
  }, [loadConnections])

  const connectFromDialog = useCallback(async (values: ConnectionFormValues, initial?: ConnectionProfile): Promise<ConnectOutcome> => {
    if (isCloud(values.type)) {
      const account = CLOUD_ACCOUNTS.find((item) => item.type === values.type) as ConnectionProfile
      return connectTo(account)
    }
    if (initial?.saved) {
      const profile = await saveFromDialog(values, initial)
      return connectTo(profile, values.password || undefined, '/', values.keyPath?.trim() || undefined)
    }
    const draftId = `new-${Date.now()}`
    setConnectingId(draftId)
    try {
      await api.connect({
        type: values.type,
        host: values.host.trim(),
        port: values.port,
        username: values.username.trim(),
        password: values.password,
        keyPath: values.keyPath?.trim() || undefined,
        clientId: draftId,
      })
    } finally {
      setConnectingId(null)
    }
    const profile = await saveFromDialog(values)
    void api.updateSession?.(profile.id)?.catch(() => undefined)
    setConnectedId(profile.id)
    setActiveId(profile.id)
    onConnected('/')
  }, [connectTo, onConnected, saveFromDialog])

  return {
    connections,
    connectionsError,
    activeId,
    activeConnection,
    activeStatus,
    isConnected,
    statusOf,
    setSavedConnections,
    setConnectionsError,
    setActiveId,
    setConnectedId,
    loadConnections,
    openConnection,
    disconnect,
    saveFromDialog,
    connectFromDialog,
  }
}
