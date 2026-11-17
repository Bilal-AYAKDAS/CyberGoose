const { app, BrowserWindow, ipcMain, Menu, nativeTheme, Notification, shell, Tray } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { startBackend } = require('./backend.cjs');

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
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: chrome[theme].background,
    ...titleBarOptions(theme),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Pencere ilk çizim hazır olunca gösterilir; açılış ekranı (index.html) hemen görünür.
  window.once('ready-to-show', () => window.show());

  if (isDevelopment) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
    window.webContents.openDevTools();
  } else {
    window.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
  return window;
}

let mainWindow = null;
let tray = null;

function setupTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, 'assets', 'icon.png'));
  tray.setToolTip('CyberGoose');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'CyberGoose\'u Göster', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { app.quit(); } },
  ]));
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
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

// Windows Uzak Masaüstü (mstsc.exe) başlatıcısı: yalnızca geçerli host/IP ve port kabul edilir.
ipcMain.handle('cybergoose:launch-rdp', async (_event, host, port) => {
  if (process.platform !== 'win32') throw new Error('Uzak Masaüstü (mstsc) yalnızca Windows üzerinde desteklenir');
  const cleanHost = String(host || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(cleanHost)) throw new Error('Geçersiz sunucu adresi');
  const portNum = port ? Number(port) : 3389;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) throw new Error('Geçersiz RDP portu');
  const target = portNum === 3389 ? cleanHost : `${cleanHost}:${portNum}`;
  execFile('mstsc.exe', [`/v:${target}`], { windowsHide: false }, () => {});
});

ipcMain.on('cybergoose:notify', (_event, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title: String(title || 'CyberGoose'), body: String(body || '') }).show();
  }
});

// Yerel API tek sefer başlatılır; renderer `cyberGoose.backend()` ile bekler.
let backendPromise = null;
let backendHandle = null;

function ensureBackend() {
  if (!backendPromise) {
    backendPromise = startBackend({
      packaged: app.isPackaged,
      dataDir: app.getPath('userData'),
      log: (line) => console.log(`[backend] ${line}`),
    }).then((handle) => {
      backendHandle = handle;
      return { base: handle.base, token: handle.token };
    });
    // Başarısız deneme önbellekte kalmasın; "Yeniden dene" yeni bir başlatma yapar.
    backendPromise.catch(() => { backendPromise = null; });
  }
  return backendPromise;
}

ipcMain.handle('cybergoose:backend', () => ensureBackend());

app.whenReady().then(() => {
  ensureBackend().catch(() => {});
  mainWindow = createWindow();
  setupTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('will-quit', () => {
  backendHandle?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
