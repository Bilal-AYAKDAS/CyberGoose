export type UpdateInfo = { current: string; latest: string; available: boolean; url: string; notes: string; publishedAt: string }

declare global {
  interface Window {
    cyberGoose?: {
      platform: string
      openExternal: (url: string) => Promise<void>
      /** Başlık çubuğu overlay rengini ve pencere zeminini temaya göre günceller. */
      setTheme?: (theme: 'dark' | 'light', source?: 'dark' | 'light' | 'system') => void
      /** Yerel API hazır olunca adresi ve istek anahtarı; başlatılamazsa reddedilir. */
      backend?: () => Promise<{ base: string; token: string }>
      launchRdp?: (host: string, port?: number) => Promise<void>
      notify?: (title: string, body: string) => void
      /** GitHub Releases üzerinden yeni sürüm denetimi. */
      checkForUpdate?: () => Promise<UpdateInfo>
      /** Yerel dosyayı varsayılan uygulamayla açar. */
      openPath?: (path: string) => Promise<void>
      /** Yerel dosyayı Windows Gezgini'nde seçili gösterir. */
      showItemInFolder?: (path: string) => Promise<void>
      /** Gezgin'den sürüklenen dosyanın diskteki yolu (Electron webUtils). */
      pathForFile?: (file: File) => string
    }
  }
}
