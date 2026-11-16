#!/usr/bin/env node
// Backend komutlarını proje sanal ortamındaki Python ile çalıştırır.
//
//   node scripts/python.cjs setup                    backend/.venv oluşturur ve paketleri kurar
//   node scripts/python.cjs run [--cwd dir] <args>   <args>'ı venv Python'u ile çalıştırır
//
// Venv sırası: backend/.venv, .venv, venv. Hiçbiri yoksa ne yapılacağını söyleyen bir hata verir.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const venvCandidates = ['backend/.venv', '.venv', 'venv'];
const requirements = path.join(root, 'backend', 'requirements-dev.txt');

function venvPython(dir) {
  const exe = isWindows ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python');
  return fs.existsSync(exe) ? exe : null;
}

function findVenvPython() {
  for (const candidate of venvCandidates) {
    const exe = venvPython(path.join(root, candidate));
    if (exe) return exe;
  }
  return null;
}

function fail(lines) {
  console.error(['', ...lines.map((line) => `  ${line}`), ''].join('\n'));
  process.exit(1);
}

function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { stdio: 'inherit', ...options });
  if (result.error) fail([`Çalıştırılamadı: ${exe}`, result.error.message]);
  return result.status ?? 1;
}

function sleep(milliseconds) {
  const sharedBuffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sharedBuffer), 0, 0, milliseconds);
}

function installRequirements(exe) {
  const attempts = isWindows ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (run(exe, ['-m', 'pip', 'install', '-r', requirements]) === 0) return true;
    if (attempt < attempts) {
      console.warn(`Paket dosyası kilitli olabilir; yeniden deneniyor (${attempt + 1}/${attempts})...`);
      sleep(2000);
    }
  }
  return false;
}

/** Sistemde bir Python 3.11+ bulur (Windows'ta önce "py -3"). */
function findSystemPython() {
  const options = isWindows ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [exe, prefix] of options) {
    const probe = spawnSync(exe, [...prefix, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const [major, minor] = probe.stdout.trim().split('.').map(Number);
    if (major === 3 && minor >= 11) return { exe, prefix };
  }
  return null;
}

function setup() {
  let exe = findVenvPython();
  if (!exe) {
    const system = findSystemPython();
    if (!system) {
      fail([
        'Python 3.11 veya üstü bulunamadı.',
        'https://www.python.org/downloads/ adresinden kurun ("Add python.exe to PATH" seçili olsun),',
        'sonra yeniden çalıştırın: npm run setup',
      ]);
    }
    const venvDir = path.join(root, 'backend', '.venv');
    console.log(`Sanal ortam oluşturuluyor: ${path.relative(root, venvDir)}`);
    if (run(system.exe, [...system.prefix, '-m', 'venv', venvDir]) !== 0) fail(['Sanal ortam oluşturulamadı.']);
    exe = venvPython(venvDir);
  }
  console.log(`Python paketleri kuruluyor (${path.relative(root, exe)})`);
  if (run(exe, ['-m', 'pip', 'install', '--upgrade', 'pip']) !== 0) fail(['pip güncellenemedi.']);
  if (!installRequirements(exe)) {
    fail([
      'Python paketleri kurulamadı.',
      'Windows bir paket dosyasını başka bir işlem kullanıyor olabilir.',
      'Çalışan pytest/Python süreçlerini kapatıp npm run setup komutunu yeniden çalıştırın.',
    ]);
  }
  console.log('Backend hazır.');
}

function runInVenv(argv) {
  let cwd = root;
  if (argv[0] === '--cwd') {
    cwd = path.resolve(root, argv[1]);
    argv = argv.slice(2);
  }
  const exe = findVenvPython();
  if (!exe) {
    fail([
      'Backend için Python sanal ortamı bulunamadı (backend/.venv).',
      'Bir kez şunu çalıştırın:  npm run setup',
      '(Yalnızca Python tarafı için:  npm run setup:backend)',
    ]);
  }
  const check = spawnSync(exe, ['-c', 'import flask, flask_cors, waitress, dotenv'], { encoding: 'utf8' });
  if (check.status !== 0) {
    fail([
      `${path.relative(root, exe)} içinde backend paketleri eksik.`,
      'Kurmak için:  npm run setup:backend',
    ]);
  }
  process.exit(run(exe, argv, { cwd }));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'setup') setup();
else if (command === 'run' && rest.length) runInVenv(rest);
else fail(['Kullanım: node scripts/python.cjs setup | run [--cwd dizin] <argümanlar>']);
