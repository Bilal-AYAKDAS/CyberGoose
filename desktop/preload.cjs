// Sandbox açıkken preload yalnızca sınırlı modüllere erişir (ipcRenderer, contextBridge...);
// `shell` burada yoktur. Bu yüzden harici link açma main sürece IPC ile devredilir.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cyberGoose', {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('cybergoose:open-external', String(url)),
  // Yalnızca 'dark' | 'light' kabul edilir; main süreç değeri tekrar doğrular.
  setTheme: (theme, source) => {
    if (theme === 'dark' || theme === 'light') ipcRenderer.send('cybergoose:theme', theme, source === 'system' ? 'system' : theme);
  },
  // Yerel API hazır olunca adresini ve istek anahtarını verir; başlatılamazsa hata fırlatır.
  backend: () => ipcRenderer.invoke('cybergoose:backend'),
  launchRdp: (host, port) => ipcRenderer.invoke('cybergoose:launch-rdp', String(host), port),
  // Yerel dosyayı varsayılan uygulamayla aç / Gezgin'de göster (main süreç yolu doğrular).
  openPath: (target) => ipcRenderer.invoke('cybergoose:open-path', String(target)),
  showItemInFolder: (target) => ipcRenderer.invoke('cybergoose:show-item', String(target)),
  // GitHub'daki son sürümü denetler: { current, latest, available, url, notes }.
  checkForUpdate: () => ipcRenderer.invoke('cybergoose:check-update'),
  // Son denetimde bulunan paketi indirir (adres main süreçte tutulur) ve doğrular.
  downloadUpdate: () => ipcRenderer.invoke('cybergoose:download-update'),
  // Uygulamayı kapatır, yeni sürümü yerine koyup başlatır.
  applyUpdate: () => ipcRenderer.invoke('cybergoose:apply-update'),
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback({ received: Number(progress?.received) || 0, total: Number(progress?.total) || null });
    ipcRenderer.on('cybergoose:update-progress', listener);
    return () => ipcRenderer.removeListener('cybergoose:update-progress', listener);
  },
  // Süren aktarım sayısı: pencere kapatılırken uyarı göstermek için.
  setActiveTransfers: (count) => ipcRenderer.send('cybergoose:active-transfers', Number(count) || 0),
  // Görev çubuğu ilerlemesi: 0..1 arası oran; null çubuğu kaldırır. mode: 'normal' | 'error'.
  setTaskbarProgress: (fraction, mode) => ipcRenderer.send('cybergoose:taskbar-progress', fraction === null ? null : Number(fraction), mode === 'error' ? 'error' : 'normal'),
  notify: (title, body) => ipcRenderer.send('cybergoose:notify', String(title), String(body)),
  // Gezgin'den bırakılan dosyanın yolu. File nesnesi yalnızca preload'da yola çevrilebilir;
  // yalnızca kullanıcının kendi sürüklediği dosyalar için çalışır.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
});
