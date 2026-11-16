// Sandbox açıkken preload yalnızca sınırlı modüllere erişir (ipcRenderer, contextBridge...);
// `shell` burada yoktur. Bu yüzden harici link açma main sürece IPC ile devredilir.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cyberGoose', {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('cybergoose:open-external', String(url)),
  // Yalnızca 'dark' | 'light' kabul edilir; main süreç değeri tekrar doğrular.
  setTheme: (theme) => {
    if (theme === 'dark' || theme === 'light') ipcRenderer.send('cybergoose:theme', theme);
  },
  // Yerel API hazır olunca adresini ve istek anahtarını verir; başlatılamazsa hata fırlatır.
  backend: () => ipcRenderer.invoke('cybergoose:backend'),
});
