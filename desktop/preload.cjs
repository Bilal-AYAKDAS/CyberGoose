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
