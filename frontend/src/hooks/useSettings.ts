import { useEffect, useState } from 'react'

export type AppSettings = {
  density: 'comfortable' | 'compact'
  overwriteDefault: 'ask' | 'overwrite'
  notifications: boolean
}

const STORAGE_KEY = 'cybergoose-settings'
const defaults: AppSettings = { density: 'comfortable', overwriteDefault: 'ask', notifications: true }

function readSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      overwriteDefault: parsed.overwriteDefault === 'overwrite' ? 'overwrite' : 'ask',
      notifications: parsed.notifications ?? true,
    }
  } catch {
    return defaults
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(readSettings)

  useEffect(() => {
    document.documentElement.dataset.density = settings.density
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Depolama kapalıysa ayarlar yalnızca oturumda kalır.
    }
  }, [settings])

  return { settings, setSettings }
}
