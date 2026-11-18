const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, pickAsset, isGithubUrl, summarizeRelease, checkForUpdate, RELEASES_URL } = require('../updater.cjs');

test('compareVersions orders numeric and prerelease versions', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('v1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.2'), 1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1);
  assert.throws(() => compareVersions('latest', '1.0.0'), /Geçersiz sürüm/);
});

const assets = [
  { name: 'CyberGoose-1.1.0-portable.exe', browser_download_url: 'https://github.com/o/r/releases/download/v1.1.0/CyberGoose-1.1.0-portable.exe' },
  { name: 'CyberGoose-1.1.0-x64.exe', browser_download_url: 'https://github.com/o/r/releases/download/v1.1.0/CyberGoose-1.1.0-x64.exe' },
  { name: 'latest.yml', browser_download_url: 'https://github.com/o/r/releases/download/v1.1.0/latest.yml' },
];

test('pickAsset chooses the package for the install type', () => {
  assert.match(pickAsset(assets, true).name, /portable/);
  assert.equal(pickAsset(assets, false).name, 'CyberGoose-1.1.0-x64.exe');
  assert.equal(pickAsset([], true), null);
  assert.equal(pickAsset(undefined, false), null);
});

test('isGithubUrl only accepts https github hosts', () => {
  assert.ok(isGithubUrl('https://github.com/o/r/releases/tag/v1'));
  assert.ok(!isGithubUrl('http://github.com/o/r'));
  assert.ok(!isGithubUrl('https://github.com.evil.example/x'));
  assert.ok(!isGithubUrl('not a url'));
});

test('summarizeRelease reports an available update with a github download url', () => {
  const info = summarizeRelease({ tag_name: 'v1.1.0', html_url: 'https://github.com/o/r/releases/tag/v1.1.0', body: 'Yenilikler', assets, published_at: '2026-11-01T00:00:00Z' }, '1.0.0', true);
  assert.deepEqual(info, {
    current: '1.0.0', latest: '1.1.0', available: true,
    url: assets[0].browser_download_url, canInstall: true, notes: 'Yenilikler', publishedAt: '2026-11-01T00:00:00Z',
  });
  assert.equal(summarizeRelease({ tag_name: 'v1.0.0', html_url: 'https://github.com/x' }, '1.0.0', false).available, false);
  assert.equal(summarizeRelease({ tag_name: 'v2.0.0', draft: true, html_url: 'https://github.com/x' }, '1.0.0', false).available, false);
  // GitHub dışı adres asla döndürülmez.
  assert.equal(summarizeRelease({ tag_name: 'v2.0.0', html_url: 'https://evil.example/x' }, '1.0.0', false).url, '');
  assert.throws(() => summarizeRelease({}, '1.0.0', false), /okunamadı/);
});

test('checkForUpdate calls the releases API and maps errors', async () => {
  let requested = '';
  const ok = async (url) => {
    requested = url;
    return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.0.1', html_url: 'https://github.com/o/r/releases/tag/v1.0.1', assets: [] }) };
  };
  const info = await checkForUpdate({ currentVersion: '1.0.0', portable: true, fetchImpl: ok });
  assert.equal(requested, RELEASES_URL);
  assert.equal(info.available, true);
  assert.equal(info.url, 'https://github.com/o/r/releases/tag/v1.0.1');

  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => ({ ok: false, status: 404 }) }), /bulunamadı/);
  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => { throw new Error('ENOTFOUND'); } }), /ENOTFOUND/);
  const slow = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: slow, timeoutMs: 20 }), /yanıt vermedi/);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { releaseAsset, downloadAsset, buildSwapScript, encodePowerShell, psQuote, installMode, isGithubDownloadHost } = require('../updater.cjs');

const payload = Buffer.from('yeni-surum-exe'.repeat(1000));
const sha = crypto.createHash('sha256').update(payload).digest('hex');
const portableAsset = {
  name: 'CyberGoose-1.1.0-portable.exe', size: payload.length, digest: `sha256:${sha}`,
  browser_download_url: 'https://github.com/o/r/releases/download/v1.1.0/CyberGoose-1.1.0-portable.exe',
};

function fakeResponse(body, { status = 200, url = 'https://objects.githubusercontent.com/x' } = {}) {
  return {
    ok: status < 400, status, url,
    headers: { get: (key) => (key === 'content-length' ? String(body.length) : null) },
    body: (async function* chunks() { for (let i = 0; i < body.length; i += 4096) yield body.subarray(i, i + 4096); })(),
  };
}

test('releaseAsset exposes digest and size; summary hides the asset from the renderer', async () => {
  const asset = releaseAsset({ assets: [portableAsset] }, true);
  assert.deepEqual(asset, { name: portableAsset.name, url: portableAsset.browser_download_url, size: payload.length, sha256: sha });
  assert.equal(releaseAsset({ assets: [{ ...portableAsset, browser_download_url: 'https://evil.example/x.exe' }] }, true), null);
  const info = await checkForUpdate({ currentVersion: '1.0.0', portable: true, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v1.1.0', html_url: 'https://github.com/o/r', assets: [portableAsset] }) }) });
  assert.equal(info.canInstall, true);
  assert.equal(info.asset.sha256, sha);
  assert.equal(JSON.parse(JSON.stringify(info)).asset, undefined);
});

test('downloadAsset verifies the SHA-256 digest and writes atomically', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-upd-'));
  const destination = path.join(dir, 'CyberGoose.exe.update');
  const seen = [];
  const result = await downloadAsset({ asset: releaseAsset({ assets: [portableAsset] }, true), destination, fetchImpl: async () => fakeResponse(payload), onProgress: (r) => seen.push(r) });
  assert.equal(result.size, payload.length);
  assert.deepEqual(fs.readFileSync(destination), payload);
  assert.equal(seen.at(-1), payload.length);

  const tampered = Buffer.from(payload);
  tampered[0] ^= 1;
  await assert.rejects(downloadAsset({ asset: { ...releaseAsset({ assets: [portableAsset] }, true) }, destination: `${destination}2`, fetchImpl: async () => fakeResponse(tampered) }), /SHA-256/);
  assert.ok(!fs.existsSync(`${destination}2`) && !fs.existsSync(`${destination}2.part`));

  await assert.rejects(downloadAsset({ asset: releaseAsset({ assets: [portableAsset] }, true), destination: `${destination}3`, fetchImpl: async () => fakeResponse(payload, { url: 'https://evil.example/x' }) }), /beklenmeyen/);
  await assert.rejects(downloadAsset({ asset: releaseAsset({ assets: [portableAsset] }, true), destination: `${destination}4`, fetchImpl: async () => fakeResponse(payload, { status: 404 }) }), /HTTP 404/);
  // Özet yoksa boyut kontrol edilir.
  const noDigest = { ...releaseAsset({ assets: [portableAsset] }, true), sha256: null, size: payload.length + 1 };
  await assert.rejects(downloadAsset({ asset: noDigest, destination: `${destination}5`, fetchImpl: async () => fakeResponse(payload) }), /eksik/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('swap script quotes paths with Turkish characters and apostrophes', () => {
  const script = buildSwapScript("C:\\Users\\Bilal\\Masaüstü\\Ali'nin\\CyberGoose.exe", 'C:\\x\\CyberGoose.exe.update');
  assert.match(script, /\$old = 'C:\\Users\\Bilal\\Masaüstü\\Ali''nin\\CyberGoose\.exe'/);
  assert.match(script, /Move-Item -LiteralPath \$new -Destination \$old -Force/);
  assert.equal(psQuote("a'b"), "'a''b'");
  assert.equal(Buffer.from(encodePowerShell(script), 'base64').toString('utf16le'), script);
});

test('installMode and download host checks', () => {
  assert.equal(installMode({ packaged: false, platform: 'win32', portableFile: 'x' }), 'manual');
  assert.equal(installMode({ packaged: true, platform: 'linux', portableFile: '' }), 'manual');
  assert.equal(installMode({ packaged: true, platform: 'win32', portableFile: 'C:\\a.exe' }), 'portable');
  assert.equal(installMode({ packaged: true, platform: 'win32', portableFile: '' }), 'installer');
  assert.ok(isGithubDownloadHost('https://objects.githubusercontent.com/a'));
  assert.ok(!isGithubDownloadHost('https://githubusercontent.com.evil.example/a'));
});

const { readSignature, publisherOf, checkUpdateSignature, signatureScript } = require('../updater.cjs');

test('readSignature parses PowerShell output and tolerates garbage', async () => {
  const seen = [];
  const sig = await readSignature("C:\\Apps\\O'Neil\\CyberGoose.exe", async (script) => {
    seen.push(script);
    return '{"status":"Valid","subject":"CN=Bilal AYAKDAS, O=CyberGoose","thumbprint":"AB12"}\r\n';
  });
  assert.deepEqual(sig, { status: 'Valid', subject: 'CN=Bilal AYAKDAS, O=CyberGoose', thumbprint: 'AB12' });
  assert.match(seen[0], /Get-AuthenticodeSignature -LiteralPath 'C:\\Apps\\O''Neil\\CyberGoose.exe'/);
  assert.equal((await readSignature('x.exe', async () => 'hata')).status, 'Unknown');
  assert.match(signatureScript('a.exe'), /ConvertTo-Json/);
});

test('publisherOf extracts the common name', () => {
  assert.equal(publisherOf('CN=Bilal AYAKDAS, O=CyberGoose, C=TR'), 'bilal ayakdas');
  assert.equal(publisherOf('O=X, CN="Acme, Inc.", C=US'), 'acme, inc.');
  assert.equal(publisherOf(null), null);
});

test('checkUpdateSignature requires the same publisher once the app is signed', () => {
  const signed = { status: 'Valid', subject: 'CN=Bilal AYAKDAS, O=CyberGoose', thumbprint: 'OLD' };
  const renewed = { status: 'Valid', subject: 'CN=Bilal Ayakdas, O=CyberGoose', thumbprint: 'NEW' };
  const other = { status: 'Valid', subject: 'CN=Someone Else', thumbprint: 'X' };
  const unsigned = { status: 'NotSigned', subject: null, thumbprint: null };
  const tampered = { status: 'HashMismatch', subject: 'CN=Bilal AYAKDAS', thumbprint: 'OLD' };

  assert.deepEqual(checkUpdateSignature(signed, renewed), { ok: true, enforced: true });
  assert.equal(checkUpdateSignature(signed, other).ok, false);
  assert.equal(checkUpdateSignature(signed, unsigned).ok, false);
  assert.equal(checkUpdateSignature(signed, tampered).ok, false);
  // İmzasız sürümden güncellemede imza zorunlu tutulamaz, ama bozuk imza yine reddedilir.
  assert.deepEqual(checkUpdateSignature(unsigned, unsigned), { ok: true, enforced: false });
  assert.deepEqual(checkUpdateSignature(unsigned, signed), { ok: true, enforced: false });
  assert.equal(checkUpdateSignature(unsigned, tampered).ok, false);
});
