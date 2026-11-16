import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../services/apiClient'
import type { ConnectionProfile, FileEntry, TransferItem } from '../types'
import { connectionLabel } from '../utils/formatters'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

type UseTransferQueueOptions = {
  localPath: string | null
  remotePath: string
  activeConnection: ConnectionProfile | null
  reloadLocal: () => void
  reloadRemote: () => void
}

export function useTransferQueue({ localPath, remotePath, activeConnection, reloadLocal, reloadRemote }: UseTransferQueueOptions) {
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [queueOpen, setQueueOpen] = useState(true)
  const runningRef = useRef(false)

  const enqueueMany = useCallback((entries: FileEntry[], direction: TransferItem['direction']) => {
    if (!localPath || !remotePath || !activeConnection) return
    const filesToQueue = entries.filter((entry) => entry.kind === 'file')
    if (!filesToQueue.length) return
    const remoteLabel = `${connectionLabel(activeConnection)}:${remotePath}`
    const added: TransferItem[] = filesToQueue.map((entry) => ({
      id: crypto.randomUUID(),
      name: entry.name,
      direction,
      localDir: localPath,
      remoteDir: remotePath,
      from: direction === 'upload' ? localPath : remoteLabel,
      to: direction === 'upload' ? remoteLabel : localPath,
      size: entry.size,
      transferred: 0,
      status: 'queued',
    }))
    setTransfers((items) => [...items, ...added])
    setQueueOpen(true)
  }, [activeConnection, localPath, remotePath])

  const enqueue = useCallback((entry: FileEntry, direction: TransferItem['direction']) => {
    enqueueMany([entry], direction)
  }, [enqueueMany])

  useEffect(() => {
    if (runningRef.current || transfers.some((item) => item.status === 'transferring')) return
    const next = transfers.find((item) => item.status === 'queued')
    if (!next) return
    runningRef.current = true
    const startedAt = Date.now()
    void Promise.resolve().then(async () => {
      setTransfers((items) => items.map((item) => item.id === next.id ? { ...item, status: 'transferring', startedAt, transferred: 0, error: undefined, errorCode: undefined } : item))
      try {
        const started = await api.startTransfer({
          direction: next.direction,
          name: next.name,
          localDir: next.localDir,
          remoteDir: next.remoteDir,
          overwrite: next.overwrite,
        })
        setTransfers((items) => items.map((item) => item.id === next.id ? { ...item, jobId: started.id } : item))
        let latest = started
        while (latest.status === 'transferring') {
          await new Promise((resolve) => window.setTimeout(resolve, 250))
          latest = await api.getTransfer(started.id)
          setTransfers((items) => items.map((item) => item.id === next.id ? {
            ...item,
            transferred: latest.transferred,
            size: latest.total ?? item.size,
          } : item))
        }
        if (latest.status === 'completed') {
          const finalSize = latest.result?.size ?? latest.total ?? next.size
          setTransfers((items) => items.map((item) => item.id === next.id ? {
            ...item,
            status: 'completed',
            size: finalSize,
            transferred: finalSize ?? item.transferred,
            finishedAt: Date.now(),
          } : item))
          if (next.direction === 'upload') reloadRemote()
          else reloadLocal()
        } else if (latest.status === 'cancelled') {
          setTransfers((items) => items.map((item) => item.id === next.id ? { ...item, status: 'cancelled', finishedAt: Date.now() } : item))
        } else {
          setTransfers((items) => items.map((item) => item.id === next.id ? {
            ...item,
            status: 'error',
            error: latest.error ?? 'Aktarım başarısız',
            errorCode: latest.errorCode ?? undefined,
            finishedAt: Date.now(),
          } : item))
        }
      } catch (error: unknown) {
        setTransfers((items) => items.map((item) => item.id === next.id ? {
          ...item,
          status: 'error',
          error: messageOf(error, 'Aktarım başarısız'),
          errorCode: error instanceof ApiError ? error.code : undefined,
          finishedAt: Date.now(),
        } : item))
      } finally {
        runningRef.current = false
      }
    })
  }, [transfers, reloadLocal, reloadRemote])

  const cancelTransfer = useCallback((id: string) => {
    const target = transfers.find((item) => item.id === id)
    if (!target) return
    if (target.status === 'queued') {
      setTransfers((items) => items.map((item) => item.id === id ? { ...item, status: 'cancelled', finishedAt: Date.now() } : item))
      return
    }
    if (target.status === 'transferring' && target.jobId) {
      void api.cancelTransfer(target.jobId).catch(() => undefined)
    }
  }, [transfers])

  const retryTransfer = useCallback((id: string, overwrite?: boolean) => {
    setTransfers((items) => items.map((item) => item.id === id
      ? { ...item, status: 'queued', overwrite: overwrite ?? item.overwrite, error: undefined, errorCode: undefined }
      : item))
  }, [])

  const removeTransfer = useCallback((id: string) => {
    setTransfers((items) => items.filter((item) => item.id !== id))
  }, [])

  const clearFinished = useCallback(() => {
    setTransfers((items) => items.filter((item) => item.status !== 'completed' && item.status !== 'cancelled'))
  }, [])

  const activeTransfer = transfers.find((item) => item.status === 'transferring')

  return {
    transfers,
    queueOpen,
    activeTransfer,
    setQueueOpen,
    enqueue,
    enqueueMany,
    cancelTransfer,
    retryTransfer,
    removeTransfer,
    clearFinished,
  }
}
