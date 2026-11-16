import { useEffect, useState } from 'react'

/** Graphite (koyu, varsayılan) ve Paper (açık). */
export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'cybergoose-theme'

function readSavedTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readSavedTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Depolama kapalıysa tema yalnızca bu oturumda geçerli olur.
    }
    // Electron: başlık çubuğu overlay'i ve pencere zemini temaya uysun (beyaz flaş olmasın).
    window.cyberGoose?.setTheme?.(theme)
  }, [theme])

  return {
    theme,
    toggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark'),
  }
}
