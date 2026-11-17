// GitHub Releases üzerinden güncelleme denetimi. Ek bağımlılık yoktur: en son sürüm bilgisi
// alınır, mevcut sürümle karşılaştırılır ve uygun Windows paketinin indirme adresi döndürülür.
// İndirme kullanıcının tarayıcısında, yalnızca github.com adresinden yapılır.

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
  return summarizeRelease(await response.json(), currentVersion, portable);
}

module.exports = { RELEASES_URL, compareVersions, pickAsset, isGithubUrl, summarizeRelease, checkForUpdate };
