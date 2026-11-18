const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, Notification, shell, Tray } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { startBackend } = require('./backend.cjs');
const { buildSwapScript, checkForUpdate, checkUpdateSignature, downloadAsset, encodePowerShell, installMode, readSignature } = require('./updater.cjs');

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

  // Aktarım sürerken pencere kapatılırsa backend de kapanır ve işler yarım kalır: önce sorulur.
  window.on('close', (event) => {
    if (quitConfirmed || activeTransfers <= 0) return;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Aktarımları bekle', 'Yine de çık'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'CyberGoose',
      message: `${activeTransfers} aktarım sürüyor.`,
      detail: 'Çıkarsanız aktarımlar yarıda kalır. FTP ve SFTP aktarımları sonra "Yeniden dene" ile kaldığı yerden sürdürülebilir.',
    });
    if (choice === 0) event.preventDefault();
    else quitConfirmed = true;
  });

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
/** Renderer'ın bildirdiği süren aktarım sayısı; kapatırken uyarı için. */
let activeTransfers = 0;
let quitConfirmed = false;

ipcMain.on('cybergoose:active-transfers', (_event, count) => {
  const value = Number(count);
  activeTransfers = Number.isInteger(value) && value > 0 ? value : 0;
});

ipcMain.on('cybergoose:taskbar-progress', (_event, fraction, mode) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const value = typeof fraction === 'number' && Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : -1;
  // -1 çubuğu kaldırır; Windows görev çubuğunda ve macOS Dock'ta görünür.
  mainWindow.setProgressBar(value, { mode: value < 0 ? 'none' : mode === 'error' ? 'error' : 'normal' });
});

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
// PORTABLE_EXECUTABLE_FILE tanımlıdır (asıl exe'nin yolu); ona göre doğru paket seçilir.
// İndirme adresi renderer'dan alınmaz: son denetimin sonucu burada tutulur.
let lastUpdate = null;
let downloadedUpdate = null;
const portableFile = process.env.PORTABLE_EXECUTABLE_FILE || '';

function updateInstallMode() {
  return installMode({ packaged: app.isPackaged, platform: process.platform, portableFile });
}

/** Taşınabilir exe'nin klasörüne yazılabiliyor mu? (Program Files gibi yerlerde yazılamaz.) */
function canWriteBeside(file) {
  try {
    fs.accessSync(path.dirname(file), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

ipcMain.handle('cybergoose:check-update', async () => {
  const info = await checkForUpdate({
    currentVersion: app.getVersion(),
    portable: Boolean(portableFile),
    fetchImpl: (url, init) => net.fetch(url, init),
  });
  lastUpdate = info;
  const mode = updateInstallMode();
  const writable = mode !== 'portable' || canWriteBeside(portableFile);
  return { ...info, canInstall: Boolean(info.canInstall && info.asset && mode !== 'manual' && writable) };
});

/** PowerShell betiğini gizli pencerede çalıştırıp çıktısını döndürür. */
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)],
      { windowsHide: true, timeout: 30000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

ipcMain.handle('cybergoose:download-update', async (event) => {
  const mode = updateInstallMode();
  const asset = lastUpdate?.available ? lastUpdate.asset : null;
  if (mode === 'manual' || !asset) throw new Error('Bu kurulumda güncelleme uygulama içinden indirilemez; indirme sayfasını kullanın.');
  const destination = mode === 'portable'
    ? `${portableFile}.update`
    : path.join(app.getPath('temp'), 'CyberGoose-update', asset.name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let lastSent = 0;
  const result = await downloadAsset({
    asset,
    destination,
    fetchImpl: (url, init) => net.fetch(url, init),
    onProgress: (received, total) => {
      const now = Date.now();
      if (now - lastSent < 150 && received !== total) return;
      lastSent = now;
      if (!event.sender.isDestroyed()) event.sender.send('cybergoose:update-progress', { received, total });
    },
  });
  // Çalışan exe imzalıysa güncelleme de aynı yayıncının geçerli imzasını taşımalı.
  const currentExe = mode === 'portable' ? portableFile : process.execPath;
  const [currentSig, nextSig] = await Promise.all([readSignature(currentExe, runPowerShell), readSignature(result.path, runPowerShell)]);
  const verdict = checkUpdateSignature(currentSig, nextSig);
  if (!verdict.ok) {
    fs.rmSync(result.path, { force: true });
    throw new Error(`${verdict.reason} Güncelleme uygulanmadı; indirme sayfasından kontrol edin.`);
  }
  downloadedUpdate = { mode, path: result.path, version: lastUpdate.latest };
  return { ready: true, version: lastUpdate.latest, mode, signed: verdict.enforced };
});

ipcMain.handle('cybergoose:apply-update', async () => {
  if (!downloadedUpdate || !fs.existsSync(downloadedUpdate.path)) throw new Error('Önce güncellemeyi indirin.');
  if (downloadedUpdate.mode === 'portable') {
    // Gizli PowerShell: uygulama kapanıp exe kilidi kalkınca dosyayı değiştirir ve yeni sürümü açar.
    const script = buildSwapScript(portableFile, downloadedUpdate.path);
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShell(script)], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
  } else {
    spawn(downloadedUpdate.path, [], { detached: true, stdio: 'ignore' }).unref();
  }
  quitConfirmed = true; // Kullanıcı "Yeniden başlat" dedi; aktarım uyarısı tekrar sorulmaz.
  setImmediate(() => app.quit());
  return { restarting: true };
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
  // Yarım kalmış ya da uygulanmamış eski güncelleme dosyaları (ör. indirme sırasında kapatıldı).
  if (portableFile) {
    for (const leftover of [`${portableFile}.update`, `${portableFile}.update.part`]) fs.rmSync(leftover, { force: true });
  }
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
