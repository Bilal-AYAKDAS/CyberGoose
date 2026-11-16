const { contextBridge, shell } = require('electron');

contextBridge.exposeInMainWorld('cyberGoose', {
  platform: process.platform,
  openExternal: (url) => shell.openExternal(url),
});
