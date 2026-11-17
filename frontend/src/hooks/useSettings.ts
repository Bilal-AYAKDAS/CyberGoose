import { useEffect, useState } from 'react'

export type AppSettings = {
  density: 'comfortable' | 'compact'
  overwriteDefault: 'ask' | 'overwrite'
  notifications: boolean
  /** Nokta ile başlayan ve Windows'ta gizli öznitelikli öğeleri göster. */
  showHidden: boolean
  /** Aynı anda çalışan aktarım sayısı (1-4). */
  maxParallel: number
}

const STORAGE_KEY = 'cybergoose-settings'
export const defaultSettings: AppSettings = { density: 'comfortable', overwriteDefault: 'ask', notifications: true, showHidden: false, maxParallel: 2 }

function readSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const parallel = Number(parsed.maxParallel)
    return {
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      overwriteDefault: parsed.overwriteDefault === 'overwrite' ? 'overwrite' : 'ask',
      notifications: parsed.notifications ?? true,
      showHidden: parsed.showHidden === true,
      maxParallel: Number.isInteger(parallel) && parallel >= 1 && parallel <= 4 ? parallel : defaultSettings.maxParallel,
    }
  } catch {
    return defaultSettings
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(readSettings)

  useEffect(() => {
    // Satır yüksekliği tokens.css'teki --size-row değişkeninden gelir (data-density).
    document.documentElement.dataset.density = settings.density
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Depolama kapalıysa ayarlar yalnızca oturumda kalır.
    }
  }, [settings])

  return { settings, setSettings }
}
