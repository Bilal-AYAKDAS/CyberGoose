export {}

declare global {
  interface Window {
    cyberGoose?: {
      platform: string
      openExternal: (url: string) => Promise<void>
      /** Başlık çubuğu overlay rengini ve pencere zeminini temaya göre günceller. */
      setTheme?: (theme: 'dark' | 'light') => void
    }
  }
}
