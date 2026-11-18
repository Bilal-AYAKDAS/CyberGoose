// GitHub Releases üzerinden güncelleme. Ek bağımlılık yoktur: en son sürüm bilgisi alınır,
// mevcut sürümle karşılaştırılır ve uygun Windows paketi seçilir.
//
// Kurulum (main.cjs):
// * Taşınabilir exe: yeni exe aynı klasöre `<ad>.update` olarak indirilir, SHA-256 (GitHub'ın
//   verdiği özet) ya da boyut doğrulanır. "Yeniden başlat" denince gizli bir PowerShell betiği
//   uygulama kapanınca (exe kilidi kalkınca) eski exe'nin yerine yenisini koyar ve başlatır.
// * Kurulum (NSIS) sürümü: kurulum dosyası geçici klasöre indirilir ve çalıştırılır.
// * Klasöre yazılamıyorsa (ör. Program Files) ya da geliştirme modunda eskisi gibi indirme
//   sayfası tarayıcıda açılır.
const crypto = require('node:crypto');
const fs = require('node:fs');

const RELEASES_URL = 'https://api.github.com/repos/Bilal-AYAKDAS/CyberGoose/releases/latest';

/** "v1.2.3" / "1.2.3-beta.1" gibi sürümleri karşılaştırır: a>b ise 1, eşitse 0, küçükse -1. */
function compareVersions(a, b) {
  const parse = (value) => {
    const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(value || '').trim());
    if (!match) return null;
    return { nums: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)], pre: match[4] || '' };
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) throw new Error(`Geçersiz sürüm: ${!left ? a : b}`);
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  // Ön sürüm (beta) aynı numaralı kararlı sürümden küçüktür.
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

/** Kurulum türüne uygun .exe paketini seçer; yoksa sürüm sayfası kullanılır. */
function pickAsset(assets, portable) {
  const list = Array.isArray(assets) ? assets : [];
  const exes = list.filter((asset) => /\.exe$/i.test(asset?.name || ''));
  const match = exes.find((asset) => /portable/i.test(asset.name) === Boolean(portable));
  return match || null;
}

function isGithubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname.endsWith('.github.com'));
  } catch {
    return false;
  }
}

/** GitHub indirme yönlendirmesinin gidebileceği adresler (release dosyaları bu alan adlarında durur). */
function isGithubDownloadHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (isGithubUrl(value) || url.hostname.endsWith('.githubusercontent.com'));
  } catch {
    return false;
  }
}

/** İndirilecek paketin bilgileri: ad, adres, boyut ve varsa SHA-256 özeti ("sha256:..."). */
function releaseAsset(release, portable) {
  const asset = pickAsset(release?.assets, portable);
  if (!asset || !isGithubUrl(asset.browser_download_url)) return null;
  const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toLowerCase() : null;
  return { name: String(asset.name), url: asset.browser_download_url, size: Number(asset.size) || null, sha256: digest };
}

/** GitHub yanıtını arayüzün kullanacağı sonuca çevirir. */
function summarizeRelease(release, currentVersion, portable) {
  if (!release || typeof release.tag_name !== 'string') throw new Error('Sürüm bilgisi okunamadı');
  const latest = release.tag_name.replace(/^v/, '');
  const asset = pickAsset(release.assets, portable);
  const candidates = [asset?.browser_download_url, release.html_url];
  const url = candidates.find((value) => value && isGithubUrl(value)) || '';
  return {
    current: currentVersion,
    latest,
    available: !release.draft && compareVersions(latest, currentVersion) > 0,
    url,
    // Paket bulunduysa uygulama içinden indirip kurulabilir (main süreç ayrıca yazma iznine bakar).
    canInstall: Boolean(releaseAsset(release, portable)),
    notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
    publishedAt: release.published_at || '',
  };
}

async function checkForUpdate({ currentVersion, portable, fetchImpl = fetch, timeoutMs = 15000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CyberGoose-Updater' },
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(controller.signal.aborted ? 'Güncelleme sunucusu yanıt vermedi' : `Güncelleme denetlenemedi: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) throw new Error('Yayınlanmış bir sürüm bulunamadı');
  if (!response.ok) throw new Error(`Güncelleme denetlenemedi (HTTP ${response.status})`);
  const release = await response.json();
  const summary = summarizeRelease(release, currentVersion, portable);
  // Paket bilgisi renderer'a gitmez; indirme adresi main süreçte tutulur.
  Object.defineProperty(summary, 'asset', { value: releaseAsset(release, portable), enumerable: false });
  return summary;
}

/**
 * Paketi `destination` yoluna indirir: önce `<hedef>.part` dosyasına yazar, özet/boyut tutarsa
 * yerine taşır. Yönlendirme yalnızca GitHub alan adlarına izinlidir.
 */
async function downloadAsset({ asset, destination, fetchImpl = fetch, onProgress = () => {}, timeoutMs = 30 * 60 * 1000 }) {
  if (!asset || !isGithubUrl(asset.url)) throw new Error('Güncelleme paketi bulunamadı');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const partial = `${destination}.part`;
  try {
    const response = await fetchImpl(asset.url, { headers: { 'User-Agent': 'CyberGoose-Updater' }, signal: controller.signal, redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Güncelleme indirilemedi (HTTP ${response.status})`);
    if (response.url && !isGithubDownloadHost(response.url)) throw new Error('Güncelleme beklenmeyen bir adrese yönlendirildi');
    const total = Number(response.headers?.get?.('content-length')) || asset.size || null;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(partial);
    let received = 0;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        hash.update(buffer);
        received += buffer.length;
        if (!out.write(buffer)) await new Promise((resolve) => out.once('drain', resolve));
        onProgress(received, total);
      }
    } finally {
      await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    }
    const digest = hash.digest('hex');
    if (asset.sha256 && digest !== asset.sha256) throw new Error('İndirilen güncelleme doğrulanamadı (SHA-256 uyuşmuyor)');
    if (!asset.sha256 && asset.size && received !== asset.size) throw new Error('İndirilen güncelleme eksik (boyut uyuşmuyor)');
    fs.renameSync(partial, destination);
    return { path: destination, size: received, sha256: digest };
  } catch (error) {
    fs.rmSync(partial, { force: true });
    if (controller.signal.aborted) throw new Error('Güncelleme indirmesi zaman aşımına uğradı');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** PowerShell tek tırnaklı dize: tek tırnak iki kez yazılır (Türkçe karakterler korunur). */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Uygulama kapanınca eski exe'yi yenisiyle değiştirip başlatan PowerShell betiği.
 * Taşınabilir exe çalışırken kilitlidir; betik kilit kalkana kadar (en fazla ~60 sn) dener.
 * Değiştiremezse yeni exe'yi olduğu yerden başlatır, eski sürüm kaybolmaz.
 */
function buildSwapScript(currentExe, newExe) {
  return [
    `$old = ${psQuote(currentExe)}`,
    `$new = ${psQuote(newExe)}`,
    'for ($i = 0; $i -lt 120; $i++) {',
    '  try { Move-Item -LiteralPath $new -Destination $old -Force -ErrorAction Stop; Start-Process -FilePath $old; exit 0 }',
    '  catch { Start-Sleep -Milliseconds 500 }',
    '}',
    'Start-Process -FilePath $new',
  ].join('\n');
}

/** `powershell -EncodedCommand` için UTF-16LE base64 (komut satırında kaçış sorunu olmaz). */
function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Authenticode imzasını okuyan PowerShell betiği (JSON tek satır yazar). */
function signatureScript(file) {
  return [
    `$s = Get-AuthenticodeSignature -LiteralPath ${psQuote(file)}`,
    '$c = $s.SignerCertificate',
    '[pscustomobject]@{ status = [string]$s.Status; subject = if ($c) { $c.Subject } else { $null }; thumbprint = if ($c) { $c.Thumbprint } else { $null } } | ConvertTo-Json -Compress',
  ].join('\n');
}

/**
 * Dosyanın Authenticode imzası: { status: 'Valid' | 'NotSigned' | ..., subject, thumbprint }.
 * `run(script)` PowerShell'i çalıştırıp stdout döndürür (testlerde sahte verilir).
 */
async function readSignature(file, run) {
  const output = await run(signatureScript(file));
  try {
    const parsed = JSON.parse(String(output).trim());
    return { status: String(parsed.status || 'Unknown'), subject: parsed.subject || null, thumbprint: parsed.thumbprint || null };
  } catch {
    return { status: 'Unknown', subject: null, thumbprint: null };
  }
}

/** Sertifika konusundan (CN=..., O=...) yayıncı adı; karşılaştırma büyük/küçük harf duyarsızdır. */
function publisherOf(subject) {
  if (!subject) return null;
  const match = /(?:^|,\s*)CN=("([^"]*)"|[^,]*)/i.exec(subject);
  const name = match ? (match[2] ?? match[1]) : subject;
  return name.trim().toLowerCase() || null;
}

/**
 * Güncelleme imza kararı. Çalışan exe imzalıysa indirilen exe de geçerli imzalı ve aynı yayıncıdan
 * olmalıdır (sertifika yenilenebileceği için parmak izi değil yayıncı adı karşılaştırılır).
 * Çalışan exe imzasızsa (ör. imzasız yerel derleme) imza zorunlu tutulamaz; yalnızca indirilen
 * dosyanın imzası bozuksa (HashMismatch) reddedilir.
 */
function checkUpdateSignature(current, next) {
  const currentSigned = current.status === 'Valid' && publisherOf(current.subject);
  if (!currentSigned) {
    if (next.status === 'HashMismatch') return { ok: false, reason: 'İndirilen güncellemenin imzası bozuk.' };
    return { ok: true, enforced: false };
  }
  if (next.status !== 'Valid') {
    return { ok: false, reason: `İndirilen güncelleme geçerli bir imza taşımıyor (${next.status}).` };
  }
  if (publisherOf(next.subject) !== publisherOf(current.subject)) {
    return { ok: false, reason: 'İndirilen güncelleme başka bir yayıncı tarafından imzalanmış.' };
  }
  return { ok: true, enforced: true };
}

/**
 * Kurulum türü: taşınabilir exe (yerinde değiştirme), kurulum dosyası (çalıştırma) ya da
 * elle (tarayıcıda indirme sayfası).
 */
function installMode({ packaged, platform, portableFile }) {
  if (!packaged || platform !== 'win32') return 'manual';
  return portableFile ? 'portable' : 'installer';
}

module.exports = {
  RELEASES_URL, compareVersions, pickAsset, isGithubUrl, isGithubDownloadHost, releaseAsset, summarizeRelease,
  checkForUpdate, downloadAsset, psQuote, buildSwapScript, encodePowerShell, installMode,
  signatureScript, readSignature, publisherOf, checkUpdateSignature,
};
