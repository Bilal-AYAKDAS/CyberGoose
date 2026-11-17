import { useEffect, useState } from 'react'

/** Graphite (koyu, varsayılan) ve Paper (açık). */
export type Theme = 'dark' | 'light'
/** Kullanıcı tercihi: sabit tema ya da Windows/macOS ayarını izle. */
export type ThemePreference = Theme | 'system'

const STORAGE_KEY = 'cybergoose-theme'

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'system' ? saved : 'dark'
  } catch {
    return 'dark'
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference)
  const [system, setSystem] = useState<Theme>(systemTheme)
  const theme: Theme = preference === 'system' ? system : preference

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!query) return
    const onChange = () => setSystem(query.matches ? 'light' : 'dark')
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Depolama kapalıysa tema yalnızca bu oturumda geçerli olur.
    }
  }, [preference])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    // Electron: başlık çubuğu overlay'i ve pencere zemini temaya uysun (beyaz flaş olmasın).
    window.cyberGoose?.setTheme?.(theme, preference)
  }, [theme, preference])

  return {
    theme,
    preference,
    setPreference,
    toggleTheme: () => setPreference(theme === 'dark' ? 'light' : 'dark'),
  }
}
