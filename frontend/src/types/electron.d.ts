export {}

declare global {
  interface Window {
    cyberGoose?: {
      platform: string
      openExternal: (url: string) => Promise<void>
      /** Başlık çubuğu overlay rengini ve pencere zeminini temaya göre günceller. */
      setTheme?: (theme: 'dark' | 'light') => void
      /** Yerel API hazır olunca adresi ve istek anahtarı; başlatılamazsa reddedilir. */
      backend?: () => Promise<{ base: string; token: string }>
      launchRdp?: (host: string, port?: number) => Promise<void>
      notify?: (title: string, body: string) => void
    }
  }
}
