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
    url: assets[0].browser_download_url, notes: 'Yenilikler', publishedAt: '2026-11-01T00:00:00Z',
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
