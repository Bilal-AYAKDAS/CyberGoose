export type UpdateInfo = {
  current: string
  latest: string
  available: boolean
  url: string
  notes: string
  publishedAt: string
  /** Paket uygulama içinden indirilip kurulabilir (taşınabilir exe ya da kurulum dosyası). */
  canInstall?: boolean
}

export type UpdateProgress = { received: number; total: number | null }

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
      /** Süren aktarım sayısını bildirir; pencere kapatılırken uyarı için. */
      setActiveTransfers?: (count: number) => void
      /** Görev çubuğunda aktarım ilerlemesi (0..1); null çubuğu kaldırır. */
      setTaskbarProgress?: (fraction: number | null, mode?: 'normal' | 'error') => void
      /** GitHub Releases üzerinden yeni sürüm denetimi. */
      checkForUpdate?: () => Promise<UpdateInfo>
      /** Son denetimde bulunan paketi indirir ve doğrular. */
      downloadUpdate?: () => Promise<{ ready: boolean; version: string; mode: 'portable' | 'installer' }>
      /** Uygulamayı kapatıp yeni sürümü kurar ve başlatır. */
      applyUpdate?: () => Promise<{ restarting: boolean }>
      /** İndirme ilerlemesi; dönen fonksiyon dinlemeyi bırakır. */
      onUpdateProgress?: (callback: (progress: UpdateProgress) => void) => () => void
      /** Yerel dosyayı varsayılan uygulamayla açar. */
      openPath?: (path: string) => Promise<void>
      /** Yerel dosyayı Windows Gezgini'nde seçili gösterir. */
      showItemInFolder?: (path: string) => Promise<void>
      /** Gezgin'den sürüklenen dosyanın diskteki yolu (Electron webUtils). */
      pathForFile?: (file: File) => string
    }
  }
}
