const { app, BrowserWindow, ipcMain, nativeTheme, shell } = require('electron');
const path = require('node:path');

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
const isMac = process.platform === 'darwin';

// Tasarım sistemi token'ları: bg-app (pencere zemini/başlık çubuğu) ve text-muted (pencere ikonları).
// Pencere zemini bg-app ile aynı olmalı; aksi halde açılışta beyaz flaş görünür.
const chrome = {
  dark: { background: '#0F1113', symbol: '#9EA2A9' },
  light: { background: '#E9E6DF', symbol: '#5B5E65' },
};
const TITLEBAR_HEIGHT = 36;

function titleBarOptions(theme) {
  if (isMac) {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: chrome[theme].background, symbolColor: chrome[theme].symbol, height: TITLEBAR_HEIGHT },
  };
}

function createWindow() {
  const theme = 'dark'; // Graphite varsayılan; renderer kayıtlı temayı açılışta bildirir.
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'CyberGoose',
    backgroundColor: chrome[theme].background,
    ...titleBarOptions(theme),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDevelopment) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
    window.webContents.openDevTools();
  } else {
    window.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
}

// Renderer tema değiştirdiğinde başlık çubuğu overlay'i ve pencere zemini eşlenir.
ipcMain.on('cybergoose:theme', (event, theme) => {
  if (theme !== 'dark' && theme !== 'light') return;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  nativeTheme.themeSource = theme;
  window.setBackgroundColor(chrome[theme].background);
  if (!isMac && typeof window.setTitleBarOverlay === 'function') {
    window.setTitleBarOverlay({ color: chrome[theme].background, symbolColor: chrome[theme].symbol, height: TITLEBAR_HEIGHT });
  }
});

// Harici linkler (ör. OAuth izin sayfası) yalnızca https ile varsayılan tarayıcıda açılır.
ipcMain.handle('cybergoose:open-external', async (_event, url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Geçersiz URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Yalnızca https bağlantıları açılabilir');
  await shell.openExternal(parsed.toString());
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
