import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type TransferJobStatus } from '../services/apiClient'
import type { ConnectionProfile, FileEntry, TransferItem } from '../types'
import { connectionLabel } from '../utils/formatters'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Durum sorgusu geçici ağ hatasında bu kadar kez geri çekilerek yeniden denenir. */
export const MAX_POLL_FAILURES = 8
export const POLL_INTERVAL_MS = 300

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

type UseTransferQueueOptions = {
  localPath: string | null
  remotePath: string
  activeConnection: ConnectionProfile | null
  /** Etkin backend oturumu; kuyruğa eklenen her öğe bu oturuma bağlanır (null: etkin oturum). */
  sessionId: number | null
  overwriteDefault?: 'ask' | 'overwrite'
  notifications?: boolean
  /** Aynı anda çalışan en fazla aktarım. */
  maxParallel?: number
  reloadLocal: () => void
  reloadRemote: () => void
}

function joinLocal(base: string, rel: string) {
  if (!rel) return base
  const sep = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`
}

function joinRemote(base: string, rel: string) {
  if (!rel) return base
  return base === '/' ? `/${rel}` : `${base.replace(/\/+$/, '')}/${rel}`
}

/** Hedefte zaten varsa sorun değil (klasör aktarımı yarıda kalmış olabilir); diğer hatalar yükselir. */
async function ensureFolder(side: 'local' | 'remote', parent: string, name: string, sessionId: number | null) {
  try {
    await api.mkdir(side, parent, name, side === 'remote' ? sessionId ?? undefined : undefined)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'exists') return
    throw error
  }
}

/**
 * Aktarım kuyruğu. Her öğe eklendiği oturuma bağlıdır (`sessionId`); bağlantı değişse de yanlış
 * sunucuya gitmez. Durum sorgusu geçici hatalarda iş kaybolmaz: birkaç kez yeniden denenir,
 * yine olmazsa öğe "durum alınamadı" olarak işaretlenir ve "Yeniden dene" aynı işi izlemeye döner.
 */
export function useTransferQueue({
  localPath,
  remotePath,
  activeConnection,
  sessionId,
  overwriteDefault = 'ask',
  notifications = true,
  maxParallel = 2,
  reloadLocal,
  reloadRemote,
}: UseTransferQueueOptions) {
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [queueOpen, setQueueOpen] = useState(true)
  /** Başlatılmış (çalışan) öğeler; StrictMode'da efekt iki kez çalışsa da iş bir kez başlar. */
  const inflight = useRef(new Set<string>())
  const cancelRequested = useRef(new Set<string>())
  const reloaders = useRef({ reloadLocal, reloadRemote })
  useEffect(() => {
    reloaders.current = { reloadLocal, reloadRemote }
  }, [reloadLocal, reloadRemote])
  /** Etkin oturum: kapanmış oturumdaki öğe, aynı bağlantı yeniden açıldıysa ona taşınır. */
  const current = useRef({ sessionId, connectionId: activeConnection?.id })
  useEffect(() => {
    current.current = { sessionId, connectionId: activeConnection?.id }
  }, [sessionId, activeConnection])

  const patch = useCallback((id: string, changes: Partial<TransferItem> | ((item: TransferItem) => Partial<TransferItem>)) => {
    setTransfers((items) => items.map((item) => item.id === id ? { ...item, ...(typeof changes === 'function' ? changes(item) : changes) } : item))
  }, [])

  const makeItem = useCallback((name: string, direction: TransferItem['direction'], localDir: string, remoteDir: string, size: number | null, label: string, session: number | null, connectionId?: string): TransferItem => {
    const remoteLabel = `${label}:${remoteDir}`
    return {
      id: crypto.randomUUID(),
      name,
      direction,
      localDir,
      remoteDir,
      sessionId: session,
      connectionId,
      from: direction === 'upload' ? localDir : remoteLabel,
      to: direction === 'upload' ? remoteLabel : localDir,
      size,
      transferred: 0,
      overwrite: overwriteDefault === 'overwrite',
      status: 'queued',
    }
  }, [overwriteDefault])

  const enqueueMany = useCallback((entries: FileEntry[], direction: TransferItem['direction']) => {
    if (!localPath || !remotePath || !activeConnection) return
    const label = connectionLabel(activeConnection)
    const added = entries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => {
        // Gezgin'den bırakılan dosyalarda klasör o anki yerel klasör değil, dosyanın kendi klasörüdür.
        const sourceDir = direction === 'upload' && entry.source === 'local' ? parentOf(entry.path) ?? localPath : localPath
        return makeItem(entry.name, direction, sourceDir, remotePath, entry.size, label, sessionId, activeConnection.id)
      })
    if (!added.length) return
    setTransfers((items) => [...items, ...added])
    setQueueOpen(true)
  }, [activeConnection, localPath, makeItem, remotePath, sessionId])

  /** Klasörleri dosya listesine açar ve hedefte klasör yapısını kurar. Hata olursa yükselir. */
  const enqueueFolders = useCallback(async (folders: FileEntry[], direction: TransferItem['direction']) => {
    if (!localPath || !remotePath || !activeConnection) return 0
    const session = sessionId
    const label = connectionLabel(activeConnection)
    const side = direction === 'upload' ? 'local' : 'remote'
    const targetSide = direction === 'upload' ? 'remote' : 'local'
    const allItems: TransferItem[] = []
    for (const folder of folders) {
      if (folder.kind !== 'folder') continue
      const plan = await api.planFolderTransfer(side, folder.path, side === 'remote' ? session ?? undefined : undefined)
      const baseLocal = direction === 'download' ? joinLocal(localPath, plan.rootName) : folder.path
      const baseRemote = direction === 'upload' ? joinRemote(remotePath, plan.rootName) : folder.path
      await ensureFolder(targetSide, direction === 'upload' ? remotePath : localPath, plan.rootName, session)

      const createdDirs = new Set<string>([''])
      for (const item of plan.files) {
        if (item.relativeDir && !createdDirs.has(item.relativeDir)) {
          let acc = ''
          for (const part of item.relativeDir.split('/')) {
            const parentRel = acc
            acc = acc ? `${acc}/${part}` : part
            if (createdDirs.has(acc)) continue
            const parentAbs = direction === 'upload' ? joinRemote(baseRemote, parentRel) : joinLocal(baseLocal, parentRel)
            await ensureFolder(targetSide, parentAbs, part, session)
            createdDirs.add(acc)
          }
        }
        allItems.push(makeItem(item.name, direction, joinLocal(baseLocal, item.relativeDir), joinRemote(baseRemote, item.relativeDir), item.size, label, session, activeConnection.id))
      }
    }
    if (allItems.length) {
      setTransfers((items) => [...items, ...allItems])
      setQueueOpen(true)
    }
    return allItems.length
  }, [activeConnection, localPath, makeItem, remotePath, sessionId])

  const enqueue = useCallback((entry: FileEntry, direction: TransferItem['direction']) => {
    enqueueMany([entry], direction)
  }, [enqueueMany])

  /** İşi bitene kadar izler. Geçici hatada geri çekilir; iş kimliği hiçbir zaman kaybolmaz. */
  const follow = useCallback(async (item: TransferItem, jobId: string): Promise<TransferJobStatus> => {
    let failures = 0
    for (;;) {
      await sleep(failures ? Math.min(4000, POLL_INTERVAL_MS * 2 ** failures) : POLL_INTERVAL_MS)
      let latest: TransferJobStatus
      try {
        latest = await api.getTransfer(jobId)
        failures = 0
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw error
        failures += 1
        if (failures >= MAX_POLL_FAILURES) {
          throw new ApiError('Aktarım durumu alınamadı. Aktarım arka planda sürüyor olabilir; "Yeniden dene" ile izlemeye devam edin.', 0, 'poll_failed')
        }
        continue
      }
      if (cancelRequested.current.has(item.id)) {
        cancelRequested.current.delete(item.id)
        void api.cancelTransfer(jobId).catch(() => undefined)
      }
      if (latest.status !== 'transferring') return latest
      patch(item.id, (current) => ({ transferred: latest.transferred, size: latest.total ?? current.size }))
    }
  }, [patch])

  const run = useCallback(async (item: TransferItem) => {
    const startedAt = Date.now()
    patch(item.id, { status: 'transferring', startedAt, transferred: item.jobId ? item.transferred : 0, error: undefined, errorCode: undefined })
    try {
      let jobId = item.jobId
      let started: TransferJobStatus | null = null
      if (!jobId) {
        started = await api.startTransfer({
          direction: item.direction,
          name: item.name,
          localDir: item.localDir,
          remoteDir: item.remoteDir,
          overwrite: item.overwrite,
          sessionId: item.sessionId ?? undefined,
          resume: item.resume,
        })
        jobId = started.id
        patch(item.id, { jobId })
      }
      // Küçük dosyada iş ilk yanıtta bitmiş olabilir; o zaman durum sorgusuna gerek yok.
      const latest = started && started.status !== 'transferring' ? started : await follow(item, jobId)
      if (latest.status === 'completed') {
        const finalSize = latest.result?.size ?? latest.total ?? item.size
        patch(item.id, { status: 'completed', size: finalSize, transferred: finalSize ?? undefined, finishedAt: Date.now(), jobId: undefined, resume: false })
        if (item.direction === 'upload') reloaders.current.reloadRemote()
        else reloaders.current.reloadLocal()
      } else if (latest.status === 'cancelled') {
        patch(item.id, { status: 'cancelled', finishedAt: Date.now(), jobId: undefined })
      } else {
        patch(item.id, { status: 'error', error: latest.error ?? 'Aktarım başarısız', errorCode: latest.errorCode ?? undefined, finishedAt: Date.now(), jobId: undefined })
      }
    } catch (error: unknown) {
      const code = error instanceof ApiError ? error.code : undefined
      // poll_failed: iş backend'de sürüyor olabilir; jobId saklanır ki yeniden deneme yeni kopya başlatmasın.
      patch(item.id, (current) => ({
        status: 'error',
        error: messageOf(error, 'Aktarım başarısız'),
        errorCode: code,
        finishedAt: Date.now(),
        jobId: code === 'poll_failed' ? current.jobId : undefined,
      }))
    } finally {
      inflight.current.delete(item.id)
      cancelRequested.current.delete(item.id)
    }
  }, [follow, patch])

  // Sıradaki öğeleri boş yuva kadar başlat.
  useEffect(() => {
    const free = Math.max(1, maxParallel) - inflight.current.size
    if (free <= 0) return
    const next = transfers.filter((item) => item.status === 'queued' && !inflight.current.has(item.id)).slice(0, free)
    for (const item of next) {
      inflight.current.add(item.id)
      void run(item)
    }
  }, [transfers, maxParallel, run])

  // Kuyruk boşalınca tek bir özet bildirimi (her dosya için ayrı bildirim değil).
  const busyRef = useRef(false)
  const notifiedUpTo = useRef(0)
  useEffect(() => {
    const busy = transfers.some((item) => item.status === 'queued' || item.status === 'transferring')
    if (busyRef.current && !busy && notifications) {
      const finished = transfers.filter((item) => (item.finishedAt ?? 0) > notifiedUpTo.current)
      const done = finished.filter((item) => item.status === 'completed').length
      const failed = finished.filter((item) => item.status === 'error').length
      if (done || failed) {
        const body = failed ? `${done} dosya aktarıldı, ${failed} dosyada hata var.` : `${done} dosya aktarıldı.`
        window.cyberGoose?.notify?.('CyberGoose aktarımı bitti', body)
      }
    }
    if (!busy) notifiedUpTo.current = Date.now()
    busyRef.current = busy
  }, [transfers, notifications])

  const cancelTransfer = useCallback((id: string) => {
    const target = transfers.find((item) => item.id === id)
    if (!target) return
    if (target.status === 'queued') {
      patch(id, { status: 'cancelled', finishedAt: Date.now() })
      return
    }
    if (target.status === 'error' && target.jobId) {
      // Durumu alınamayan iş arka planda sürüyor olabilir.
      void api.cancelTransfer(target.jobId).catch(() => undefined)
      patch(id, { status: 'cancelled', jobId: undefined, finishedAt: Date.now() })
      return
    }
    if (target.status !== 'transferring') return
    if (target.jobId) void api.cancelTransfer(target.jobId).catch(() => undefined)
    else cancelRequested.current.add(id) // İş henüz başlatılıyor; kimlik gelince iptal edilir.
  }, [patch, transfers])

  const retryTransfer = useCallback((id: string, overwrite?: boolean) => {
    setTransfers((items) => items.map((item) => {
      if (item.id !== id) return item
      const keepJob = item.errorCode === 'poll_failed' && item.jobId
      // Yarıda kesilen aktarım FTP/SFTP'de kaldığı yerden sürer; "zaten var" hatasında sürdürme olmaz.
      const resume = !keepJob && item.errorCode !== 'exists' && (item.transferred ?? 0) > 0
      const live = current.current
      const rebind = item.errorCode === 'session_closed' && live.sessionId !== null && item.connectionId !== undefined && item.connectionId === live.connectionId
      return {
        ...item,
        sessionId: rebind ? live.sessionId : item.sessionId,
        status: 'queued',
        overwrite: overwrite ?? item.overwrite,
        resume,
        jobId: keepJob ? item.jobId : undefined,
        error: undefined,
        errorCode: undefined,
      }
    }))
  }, [])

  const removeTransfer = useCallback((id: string) => {
    setTransfers((items) => {
      const target = items.find((item) => item.id === id)
      if (target?.jobId && target.status !== 'completed') void api.cancelTransfer(target.jobId).catch(() => undefined)
      return items.filter((item) => item.id !== id)
    })
  }, [])

  const clearFinished = useCallback(() => {
    setTransfers((items) => items.filter((item) => item.status !== 'completed' && item.status !== 'cancelled'))
  }, [])

  const activeTransfers = transfers.filter((item) => item.status === 'transferring')

  return {
    transfers,
    queueOpen,
    activeTransfer: activeTransfers[0],
    activeCount: activeTransfers.length,
    setQueueOpen,
    enqueue,
    enqueueMany,
    enqueueFolders,
    cancelTransfer,
    retryTransfer,
    removeTransfer,
    clearFinished,
  }
}

export function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index < 0) return null
  const parent = trimmed.slice(0, index)
  // "C:" → "C:\", "" → "/"
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  return parent || '/'
}
