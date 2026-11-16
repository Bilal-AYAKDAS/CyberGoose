// Yerel API'yi (Flask, PyInstaller ile paketlenmiş) başlatır ve hazır olmasını bekler.
// Geliştirmede backend'i `npm run dev:backend` ayrıca çalıştırır; burada yalnızca beklenir.
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const HOST = '127.0.0.1';
const DEV_PORT = 5502;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`, { headers: token ? { 'X-CyberGoose-Token': token } : {} });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Yerel sunucu ${Math.round(timeoutMs / 1000)} sn içinde yanıt vermedi (${lastError?.message ?? 'bilinmiyor'}).`);
}

function backendExecutable() {
  const name = process.platform === 'win32' ? 'cybergoose-backend.exe' : 'cybergoose-backend';
  return path.join(process.resourcesPath, 'backend', name);
}

/**
 * @param {{ packaged: boolean, dataDir: string, log: (line: string) => void }} options
 * @returns {Promise<{ base: string, token: string, stop: () => void }>}
 */
async function startBackend({ packaged, dataDir, log }) {
  if (!packaged) {
    const base = `http://${HOST}:${DEV_PORT}`;
    await waitForHealth(base, '', 20000);
    return { base: '', token: '', stop: () => {} };
  }

  const executable = backendExecutable();
  if (!fs.existsSync(executable)) throw new Error(`Backend bulunamadı: ${executable}`);
  const port = await freePort();
  const token = crypto.randomBytes(24).toString('hex');
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      FLASK_HOST: HOST,
      FLASK_PORT: String(port),
      FLASK_DEBUG: 'false',
      CYBERGOOSE_DATA_DIR: dataDir,
      CYBERGOOSE_API_TOKEN: token,
      PYTHONUNBUFFERED: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => log(String(chunk).trimEnd()));
  child.stderr.on('data', (chunk) => log(String(chunk).trimEnd()));

  const exited = new Promise((_, reject) => {
    child.once('exit', (code) => reject(new Error(`Yerel sunucu kapandı (çıkış kodu ${code}).`)));
    child.once('error', reject);
  });

  const stop = () => {
    if (child.exitCode !== null || child.killed) return;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill();
    }
  };

  const base = `http://${HOST}:${port}`;
  try {
    await Promise.race([waitForHealth(base, token, 30000), exited]);
  } catch (error) {
    stop();
    throw error;
  }
  return { base, token, stop };
}

module.exports = { startBackend };
