const { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, Notification, shell, Tray } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { startBackend } = require('./backend.cjs');
const { checkForUpdate } = require('./updater.cjs');

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
      // Dosya detaylarındaki PDF önizlemesi için Chromium PDF görüntüleyicisi.
      plugins: true,
    },
  });

  // Pencere ilk çizim hazır olunca gösterilir; açılış ekranı (index.html) hemen görünür.
  window.once('ready-to-show', () => window.show());

  // Gezgin'den bırakılan dosya bir bırakma alanının dışına düşerse pencere o dosyaya gitmesin;
  // uygulama yalnızca kendi sayfasını gösterir.
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  // Uygulama içinden yeni Electron penceresi açılmaz; https linkleri varsayılan tarayıcıya gider.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

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
// `source` 'system' ise işletim sistemi teması izlenir (prefers-color-scheme sabitlenmez).
ipcMain.on('cybergoose:theme', (event, theme, source) => {
  if (theme !== 'dark' && theme !== 'light') return;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  nativeTheme.themeSource = source === 'system' ? 'system' : theme;
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

// Yerel dosyayı varsayılan uygulamayla açar ya da Gezgin'de gösterir. Yalnızca var olan mutlak
// yollar kabul edilir; renderer bir URL ya da komut veremez.
function existingLocalPath(target) {
  const value = String(target || '');
  if (!path.isAbsolute(value) || !fs.existsSync(value)) throw new Error('Dosya bulunamadı');
  return path.normalize(value);
}

ipcMain.handle('cybergoose:open-path', async (_event, target) => {
  const message = await shell.openPath(existingLocalPath(target));
  if (message) throw new Error(`Dosya açılamadı: ${message}`);
});

ipcMain.handle('cybergoose:show-item', async (_event, target) => {
  shell.showItemInFolder(existingLocalPath(target));
});

ipcMain.on('cybergoose:notify', (_event, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title: String(title || 'CyberGoose'), body: String(body || '') }).show();
  }
});

// Güncelleme denetimi: GitHub'daki son sürüm bilgisi. Taşınabilir sürümde
// PORTABLE_EXECUTABLE_FILE tanımlıdır; ona göre doğru paket seçilir.
ipcMain.handle('cybergoose:check-update', () => checkForUpdate({
  currentVersion: app.getVersion(),
  portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  fetchImpl: (url, init) => net.fetch(url, init),
}));

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

// Tek örnek: ikinci kez açılınca ikinci bir yerel sunucu (aynı veritabanı ve token dosyaları)
// başlatılmaz; mevcut pencere öne getirilir.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!hasLock) return;
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
