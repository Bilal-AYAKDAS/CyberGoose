import { useEffect, useRef } from 'react'
import type { TransferItem } from '../types'

export type TaskbarProgress = { fraction: number; mode: 'normal' | 'error' } | null

/**
 * Bir aktarım grubunun toplam ilerlemesi. Boyutların hepsi biliniyorsa bayt oranı, değilse
 * dosya başına ortalama kullanılır. Bitmiş, atlanmış ya da hata almış dosyalar tamam sayılır.
 */
export function batchProgress(items: TransferItem[]): TaskbarProgress {
  const counted = items.filter((item) => item.status !== 'cancelled')
  if (!counted.length) return null
  const fractionOf = (item: TransferItem) => {
    if (item.status === 'completed' || item.status === 'error') return 1
    if (item.status === 'queued' || !item.size) return 0
    return Math.min(1, (item.transferred ?? 0) / item.size)
  }
  const knownSizes = counted.every((item) => typeof item.size === 'number')
  let fraction: number
  if (knownSizes) {
    const total = counted.reduce((sum, item) => sum + (item.size ?? 0), 0)
    fraction = total > 0
      ? counted.reduce((sum, item) => sum + fractionOf(item) * (item.size ?? 0), 0) / total
      : counted.reduce((sum, item) => sum + fractionOf(item), 0) / counted.length
  } else {
    fraction = counted.reduce((sum, item) => sum + fractionOf(item), 0) / counted.length
  }
  return { fraction, mode: counted.some((item) => item.status === 'error') ? 'error' : 'normal' }
}

/**
 * Kuyruk çalışırken görev çubuğu simgesinde ilerleme gösterir. Grup, kuyruk boşalana kadar eklenen
 * tüm dosyalardır; kuyruk boşalınca çubuk kaldırılır.
 */
export function useTaskbarProgress(transfers: TransferItem[]) {
  const batchRef = useRef<Set<string>>(new Set())
  const lastSentRef = useRef<string>('')

  useEffect(() => {
    const send = window.cyberGoose?.setTaskbarProgress
    if (!send) return
    const pending = transfers.filter((item) => item.status === 'queued' || item.status === 'transferring')
    let progress: TaskbarProgress = null
    if (pending.length) {
      for (const item of pending) batchRef.current.add(item.id)
      progress = batchProgress(transfers.filter((item) => batchRef.current.has(item.id)))
    } else {
      batchRef.current = new Set()
    }
    // Yüzde değişmedikçe IPC gönderilmez.
    const key = progress ? `${Math.round(progress.fraction * 100)}:${progress.mode}` : 'none'
    if (key === lastSentRef.current) return
    lastSentRef.current = key
    send(progress ? progress.fraction : null, progress?.mode)
  }, [transfers])
}
