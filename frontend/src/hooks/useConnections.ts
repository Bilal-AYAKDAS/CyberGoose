import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api, hostKeyOf, type ConnectResponse, type HostKeyInfo, type ProviderStatus } from '../services/apiClient'
import type { ConnectionFormValues, ConnectionProfile, ConnectionStatus, ConnectionType, SavedConnection } from '../types'
import { isCloud } from '../utils/formatters'
import type { ConnectOutcome } from '../components/ConnectionModal'

/** Bulut hesapları kayıtlı bağlantı değildir; kenar çubuğunda her zaman görünür. */
export const CLOUD_ACCOUNTS: ConnectionProfile[] = [
  { id: 'dropbox', name: 'Dropbox', type: 'Dropbox', host: '', port: '', username: '', hasPassword: false, saved: false },
  { id: 'drive', name: 'Google Drive', type: 'GoogleDrive', host: '', port: '', username: '', hasPassword: false, saved: false },
  { id: 'onedrive', name: 'OneDrive', type: 'OneDrive', host: '', port: '', username: '', hasPassword: false, saved: false },
]

const PROVIDER_KEY: Record<string, keyof ProviderStatus> = { Dropbox: 'dropbox', GoogleDrive: 'googledrive', OneDrive: 'onedrive' }

/** Bulut hesabını ayarlamak için kullanıcıya gösterilen kısa yönerge. */
export const CLOUD_SETUP_HINT: Record<string, string> = {
  Dropbox: 'Dropbox henüz ayarlanmadı. Uygulama anahtarı gerekiyor: veri klasöründeki .env dosyasına DROPBOX_APP_KEY ve DROPBOX_APP_SECRET ekleyip CyberGoose\'u yeniden başlatın (adımlar README\'de).',
  GoogleDrive: 'Google Drive henüz ayarlanmadı. Google\'dan indirdiğiniz OAuth istemci dosyasını veri klasörüne credentials.json adıyla koyup CyberGoose\'u yeniden başlatın (adımlar README\'de).',
  OneDrive: 'OneDrive henüz ayarlanmadı. Veri klasöründeki .env dosyasına ONEDRIVE_CLIENT_ID ekleyip CyberGoose\'u yeniden başlatın (adımlar README\'de).',
}

export const QUICK_ID = 'quick'

export const toProfile = (saved: SavedConnection): ConnectionProfile => ({
  id: String(saved.id),
  name: saved.name,
  type: saved.type,
  host: saved.host,
  port: saved.port,
  username: saved.username,
  hasPassword: saved.hasPassword,
  keyPath: saved.keyPath || undefined,
  group: saved.group || undefined,
  useAgent: saved.useAgent || undefined,
  hasPassphrase: saved.hasPassphrase || undefined,
  saved: true,
})

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

export type QuickConnectValues = { type: ConnectionType; host: string; port: string; username: string; password: string; keyPath?: string }

type Notice = { tone: 'warn' | 'error'; title: string } | null

type UseConnectionsOptions = {
  onConnected: (startPath: string) => void
  onDisconnected: () => void
  onNeedPassword: (connection: ConnectionProfile) => void
  onNotice: (notice: Notice) => void
  /** SFTP sunucusu ilk kez görülüyor: kullanıcı parmak izini onaylarsa `trust` ile yeniden bağlanılır. */
  onHostKey: (info: HostKeyInfo, trust: () => Promise<void>) => void
}

type ConnectOptions = { password?: string; startPath?: string; keyPath?: string; trustHostKey?: string; keyPassphrase?: string; useAgent?: boolean }

export function useConnections({ onConnected, onDisconnected, onNeedPassword, onNotice, onHostKey }: UseConnectionsOptions) {
  const [savedConnections, setSavedConnections] = useState<ConnectionProfile[]>([])
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [providers, setProviders] = useState<ProviderStatus | null>(null)
  const [quickProfile, setQuickProfile] = useState<ConnectionProfile | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [connectedId, setConnectedId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.providers?.()
      .then((status) => { if (active) setProviders(status) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const connections = useMemo(() => {
    const clouds = CLOUD_ACCOUNTS.map((account) => ({
      ...account,
      configured: providers ? providers[PROVIDER_KEY[account.type]] : true,
    }))
    return [...(quickProfile ? [quickProfile] : []), ...savedConnections, ...clouds]
  }, [providers, quickProfile, savedConnections])
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

  const markConnected = useCallback((id: string, result: ConnectResponse, startPath: string) => {
    if ('pending' in result) return
    // Backend tek etkin oturum tutar: başka bağlantı açılınca hızlı bağlantı girdisi geçersizdir.
    if (id !== QUICK_ID) setQuickProfile(null)
    setConnectedId(id)
    setActiveId(id)
    setSessionId(result.sessionId ?? null)
    onConnected(startPath)
  }, [onConnected])

  const connectTo = useCallback(async (connection: ConnectionProfile, options: ConnectOptions = {}): Promise<ConnectOutcome> => {
    const { password, startPath = '/', keyPath, trustHostKey, keyPassphrase, useAgent } = options
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
        trustHostKey,
        keyPassphrase,
        useAgent,
      })
      if ('pending' in result) return { pending: result.message }
      markConnected(connection.id, result, startPath)
    } catch (error) {
      setFailedId(connection.id)
      throw error
    } finally {
      setConnectingId((current) => (current === connection.id ? null : current))
    }
  }, [markConnected, onNotice])

  const openConnection = useCallback(async (connection: ConnectionProfile, startPath = '/') => {
    if (statusOf(connection.id) === 'connected') {
      setActiveId(connection.id)
      onConnected(startPath)
      return
    }
    if (connection.quick) {
      // Kaydedilmemiş hızlı bağlantının parolası tutulmaz; yeniden bağlanmak için çubuk açılmalı.
      onNotice({ tone: 'warn', title: 'Hızlı bağlantı kapandı. Yeniden bağlanmak için Ctrl+K ile hızlı bağlanı açın.' })
      return
    }
    if (isCloud(connection.type) && connection.configured === false) {
      onNotice({ tone: 'warn', title: CLOUD_SETUP_HINT[connection.type] })
      return
    }
    if (connection.saved && !connection.hasPassword && !(connection.type === 'SFTP' && (connection.keyPath || connection.useAgent))) {
      onNeedPassword(connection)
      return
    }
    const attempt = async (trustHostKey?: string) => {
      try {
        const outcome = await connectTo(connection, { startPath, trustHostKey })
        if (outcome && 'pending' in outcome) onNotice({ tone: 'warn', title: outcome.pending })
      } catch (error) {
        const hostKey = hostKeyOf(error)
        if (hostKey && !trustHostKey) {
          // Onay beklemek bir hata değil: kullanıcı vazgeçerse sunucu kırmızı görünmesin.
          setFailedId((current) => (current === connection.id ? null : current))
          onHostKey(hostKey, () => attempt(hostKey.fingerprint))
          return
        }
        if (error instanceof ApiError && (error.code === 'password_required' || error.code === 'key_passphrase_required')) {
          if (error.code === 'key_passphrase_required') onNotice({ tone: 'warn', title: error.message })
          onNeedPassword(connection)
          return
        }
        onNotice({ tone: 'error', title: messageOf(error, 'Bağlantı kurulamadı') })
      }
    }
    await attempt()
  }, [connectTo, onConnected, onHostKey, onNeedPassword, onNotice, statusOf])

  /** Uygulama yeniden yüklendiğinde backend hâlâ bir hızlı bağlantıdaysa: adresi bilinmediği için kapat. */
  const dropOrphanQuickSession = useCallback(() => {
    void api.disconnect().catch(() => undefined)
  }, [])

  const disconnect = useCallback(async () => {
    await api.disconnect().catch(() => undefined)
    setConnectedId(null)
    setSessionId(null)
    setQuickProfile(null)
    setActiveId((current) => (current === QUICK_ID ? null : current))
    onDisconnected()
  }, [onDisconnected])

  const saveFromDialog = useCallback(async (values: ConnectionFormValues, initial?: ConnectionProfile) => {
    const input = {
      name: values.name.trim(),
      type: values.type,
      host: values.host.trim(),
      port: values.port,
      username: values.username.trim(),
      keyPath: values.type === 'SFTP' ? values.keyPath?.trim() ?? '' : '',
      group: values.group?.trim() ?? '',
      useAgent: values.type === 'SFTP' && Boolean(values.useAgent),
      ...(values.type === 'SFTP' && values.keyPassphrase ? { keyPassphrase: values.keyPassphrase } : {}),
      ...(values.password ? { password: values.password } : {}),
    }
    const saved = initial?.saved ? await api.updateConnection(initial.id, input) : await api.createConnection(input)
    if (saved.warning) onNotice({ tone: 'warn', title: saved.warning })
    await loadConnections()
    return toProfile(saved)
  }, [loadConnections, onNotice])

  const connectFromDialog = useCallback(async (values: ConnectionFormValues, initial?: ConnectionProfile, trustHostKey?: string): Promise<ConnectOutcome> => {
    if (isCloud(values.type)) {
      const account = connections.find((item) => item.type === values.type && !item.saved) as ConnectionProfile
      if (account.configured === false) throw new ApiError(CLOUD_SETUP_HINT[account.type], 400, 'missing_credentials')
      return connectTo(account)
    }
    const keyPath = values.keyPath?.trim() || undefined
    if (initial?.saved) {
      const profile = await saveFromDialog(values, initial)
      return connectTo(profile, { password: values.password || undefined, keyPath, trustHostKey, keyPassphrase: values.keyPassphrase || undefined, useAgent: values.useAgent || undefined })
    }
    const draftId = `new-${Date.now()}`
    setConnectingId(draftId)
    setFailedId(null)
    onNotice(null)
    let result: ConnectResponse
    try {
      result = await api.connect({
        type: values.type,
        host: values.host.trim(),
        port: values.port,
        username: values.username.trim(),
        password: values.password,
        keyPath,
        clientId: draftId,
        trustHostKey,
        keyPassphrase: values.keyPassphrase || undefined,
        useAgent: values.type === 'SFTP' && values.useAgent ? true : undefined,
      })
    } finally {
      setConnectingId((current) => (current === draftId ? null : current))
    }
    if ('pending' in result) return { pending: result.message }
    // Bağlantı kuruldu; kayıt başarısız olsa bile arayüz backend'deki oturumla aynı kalmalı.
    try {
      const profile = await saveFromDialog(values)
      void api.updateSession?.(profile.id)?.catch(() => undefined)
      markConnected(profile.id, result, '/')
    } catch (error) {
      const fallback: ConnectionProfile = {
        id: QUICK_ID,
        name: values.name.trim() || `${values.username.trim()}@${values.host.trim()}`,
        type: values.type,
        host: values.host.trim(),
        port: values.port,
        username: values.username.trim(),
        hasPassword: false,
        saved: false,
        quick: true,
      }
      setQuickProfile(fallback)
      markConnected(QUICK_ID, result, '/')
      onNotice({ tone: 'warn', title: `Bağlandı ama bağlantı kaydedilemedi: ${messageOf(error, 'bilinmeyen hata')}` })
    }
  }, [connections, connectTo, markConnected, onNotice, saveFromDialog])

  /** Kaydetmeden bağlanır (araç çubuğundaki hızlı bağlan). Parola hiçbir yerde saklanmaz. */
  const quickConnect = useCallback(async (values: QuickConnectValues, trustHostKey?: string) => {
    const profile: ConnectionProfile = {
      id: QUICK_ID,
      name: `${values.username}@${values.host}`,
      type: values.type,
      host: values.host.trim(),
      port: values.port,
      username: values.username.trim(),
      hasPassword: false,
      saved: false,
      quick: true,
    }
    setConnectingId(QUICK_ID)
    setFailedId(null)
    onNotice(null)
    try {
      const result = await api.connect({
        type: values.type,
        host: profile.host,
        port: values.port,
        username: profile.username,
        password: values.password,
        keyPath: values.keyPath?.trim() || undefined,
        clientId: QUICK_ID,
        trustHostKey,
      })
      setQuickProfile(profile)
      markConnected(QUICK_ID, result, '/')
    } finally {
      setConnectingId((current) => (current === QUICK_ID ? null : current))
    }
  }, [markConnected, onNotice])

  return {
    connections,
    connectionsError,
    activeId,
    activeConnection,
    activeStatus,
    isConnected,
    sessionId,
    statusOf,
    setSavedConnections,
    setConnectionsError,
    setActiveId,
    setConnectedId,
    setSessionId,
    loadConnections,
    openConnection,
    disconnect,
    saveFromDialog,
    connectFromDialog,
    quickConnect,
    dropOrphanQuickSession,
  }
}
