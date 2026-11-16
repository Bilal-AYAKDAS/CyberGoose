# CyberGoose Mimarisi

Son güncelleme: 16.11.2026. Bu belge eski `ARCHITECTURE_AND_UPDATE_SUMMARY.md` dosyasının yerini alır.

## 1. Genel bakış

CyberGoose üç parçadan oluşur ve her parça kendi klasöründedir:

| Klasör | Teknoloji | Görevi |
|---|---|---|
| `backend/` | Python 3.11+, Flask, waitress | Yerel HTTP API. Yerel dosya sistemi, FTP/FTPS/SFTP, Dropbox ve Google Drive ile konuşur, SQLite'ta bağlantı ve yer imi saklar. |
| `frontend/` | React 19, TypeScript, Vite | Arayüz. Yalnızca API'yi çağırır; sağlayıcı SDK'ları burada yoktur. |
| `desktop/` | Electron 45 | Pencere, başlık çubuğu ve paketleme. Paketli uygulamada backend'i arka planda başlatır. |

```text
Electron (desktop/main.cjs)
 ├─ backend.cjs ─ spawn ─> cybergoose-backend.exe (Flask + waitress, 127.0.0.1:<rastgele port>)
 └─ BrowserWindow ─ file:// ─> frontend/dist/index.html
                                 └─ fetch + X-CyberGoose-Token ─> yerel API
```

Geliştirmede üç süreç ayrı çalışır (`npm run dev`): Flask `127.0.0.1:5502`, Vite `localhost:5175` (`/api` proxy'si Flask'a gider) ve Electron.

## 2. Klasör yapısı

```text
CyberGoose/
  backend/
    app.py                  HTTP route'ları ve sunucu giriş noktası (main)
    config.py               .env okuma, veri klasörü, yollar
    db.py                   SQLite: kayıtlı bağlantılar ve klasör yer imleri
    file_service.py         Normalize dosya servisi (listeleme, aktarım, silme, izinler)
    os_folder.py            Yerel dosya detayları (SHA-256, önizleme)
    providers/
      ftp.py                FTP ve FTPS (AUTH TLS + PROT P)
      sftp.py               SFTP (paramiko)
      dropbox_oauth.py      Dropbox OAuth akışı ve istemci
      google_drive.py       Google Drive OAuth ve servis
    tests/                  pytest (gerçek pyftpdlib FTP sunucusuyla)
    requirements.txt        Çalışma bağımlılıkları
    requirements-dev.txt    pytest, pyftpdlib, PyInstaller
    cybergoose-backend.spec PyInstaller paket tanımı
    .env.example
  frontend/
    index.html              Açılış ekranı (JS yüklenmeden görünür)
    src/
      components/           AppChrome, Sidebar, FileManagerView, FileTable, PathBar,
                            ConnectionModal, ContextMenu, ConfirmDialog, BookmarksPanel,
                            FileInspector, TransferQueue, Notice, Modal, Icon, GooseMark
      hooks/                useDirectory (klasör yükleme), useTheme
      services/apiClient.ts Tüm API çağrıları, ApiError
      styles/               tokens.css (iki tema), app.css (cg-* sınıfları)
      types/                API ve arayüz tipleri
      utils/                formatters, status
      __tests__/            Vitest + Testing Library
      App.tsx, main.tsx
  desktop/
    main.cjs                Pencere, tema IPC'si, backend yaşam döngüsü
    backend.cjs             Backend'i başlatma, sağlık kontrolü, kapatma
    preload.cjs             Renderer'a açılan sınırlı API
    assets/icon.png         Uygulama ikonu (512 px)
  docs/ARCHITECTURE.md
  scripts/python.cjs        Backend komutlarını backend/.venv Python'u ile çalıştırır
  package.json              Kök script'ler ve electron-builder ayarları
  README.md
```

## 3. Backend

### API

Tüm hatalar `{"error": "mesaj", "code": "kod"}` gövdesi ve uygun HTTP durum koduyla döner. POST/PUT istekleri JSON olmalıdır (aksi halde 415).

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/health` | Sağlık kontrolü |
| GET | `/api/session` | Açık uzak bağlantı |
| POST | `/api/connect` | `{type, host, port, username, password}` ya da `{type, connectionId}`. Kayıtlı parola yoksa 400 `password_required`. Dropbox izni bekleniyorsa 202 `{pending, message}` |
| POST | `/api/disconnect` | Bağlantıyı kapatır |
| GET | `/api/local/home` | Ev klasörü |
| POST | `/api/local/list` | `{path}` → `{path, parent, crumbs, entries}` |
| POST | `/api/local/info` | SHA-256, izinler, metin önizlemesi (64 KB) |
| POST | `/api/remote/list` | Uzak klasör listesi (aynı biçim) |
| POST | `/api/remote/info` | Uzak izinler, `canChmod` |
| POST | `/api/remote/chmod` | FTP/SFTP izin değiştirme |
| POST | `/api/transfer` | `{direction, name, localDir, remoteDir, overwrite?}`; hedef varsa 409 `exists` |
| POST | `/api/delete` | `{side: local\|remote, path}` (yalnızca dosya) |
| GET/POST | `/api/connections` | Kayıtlı bağlantılar (parola asla dönmez, `hasPassword` döner) |
| PUT/DELETE | `/api/connections/<id>` | Düzenleme ve silme |
| GET/POST | `/api/bookmarks` | Klasör yer imleri |
| DELETE | `/api/bookmarks/<id>` | Yer imi silme |

Dosya girdisi: `{name, kind: file|folder, size, modified, path}`.

### Yapılandırma ve veri klasörü

`config.py` önce veri klasöründeki, sonra `backend/` içindeki `.env` dosyasını okur. Veri klasörü (`CYBERGOOSE_DATA_DIR`) `data.db`, `dropboxtoken.json`, `token.json` ve `credentials.json` dosyalarını tutar.

- Geliştirmede veri klasörü `backend/`.
- Paketli uygulamada Electron `%APPDATA%\CyberGoose` verir; exe güncellense de veriler kalır.

### Güvenlik

- API yalnızca `127.0.0.1`'e bağlanır.
- Paketli uygulamada Electron her açılışta rastgele bir anahtar üretir (`CYBERGOOSE_API_TOKEN`). Anahtarsız istekler 401 alır, böylece makinedeki başka programlar API'yi kullanamaz.
- CORS yalnızca Vite geliştirme adresine ve `file://` (`null`) kaynağına açıktır.
- Parolalar API yanıtlarında dönmez ve loglanmaz.
- Açık iş: kayıtlı parolalar SQLite'ta hâlâ düz metindir (bkz. Bölüm 7).

## 4. Frontend

- **Veri:** Tüm veriler API'den gelir; örnek veri yoktur. API'ye ulaşılamazsa veya bir işlem başarısız olursa backend'in mesajı hata olarak gösterilir: panelde "Yeniden dene" düğmeli Notice, diyalogda hata bandı, kuyrukta hata satırı.
- **Durum:** `App.tsx` bağlantıları, panelleri, seçimi, kuyruğu ve diyalogları yönetir. `useDirectory` klasör yükleme ve yarışan istekleri yönetir.
- **Aktarım kuyruğu:** İşler sırayla `/api/transfer` ile yapılır. Hedef dosya varsa "Üzerine yaz", diğer hatalarda "Yeniden dene" sunulur. Backend aktarımı tek istekte yaptığı için yüzde ilerleme ve iptal henüz yok.
- **Açılış ekranı:** `index.html` içinde, JS yüklenmeden görünür ve kayıtlı temayı kullanır. Kaz işareti çizilerek gelir, ardından ad ve ince bir yükleme çizgisi görünür. Masaüstünde backend hazır olana kadar "Yerel sunucu başlatılıyor" yazar; başlatılamazsa hatayı ve "Yeniden dene" düğmesini gösterir. Uygulama ilk verileri aldıktan sonra (en az 900 ms) ekran yumuşakça kaybolur. `prefers-reduced-motion` açıksa animasyon yapılmaz.
- **Kısayollar:** Ctrl+L yol düzenleme, Ctrl+F arama, F5 yenile, Delete sil, Ctrl+U yükle, Ctrl+D indir, Backspace üst klasör, sağ tık menüleri.

## 5. Masaüstü (Electron)

- `contextIsolation`, `sandbox` açık, `nodeIntegration` kapalı.
- `preload.cjs` yalnızca şunları açar: `platform`, `openExternal` (yalnızca https), `setTheme`, `backend()` (API adresi ve anahtarı).
- Pencere `show: false` ile açılır ve `ready-to-show` olayında gösterilir. Zemin rengi `bg-app` ile aynıdır, böylece beyaz flaş olmaz.
- `backend.cjs` boş bir port seçer ve `cybergoose-backend.exe`'yi başlatır. `/api/health` yanıt verene kadar (en fazla 30 sn) bekler. Uygulama kapanırken süreci (Windows'ta `taskkill /T`) sonlandırır.

## 6. Tek exe paketleme

`npm run dist` şu adımları çalıştırır:

1. `build:frontend`: Vite, `frontend/dist`.
2. `build:backend`: PyInstaller, `backend/dist/cybergoose-backend/`. Onedir paket kullanılır çünkü onefile her açılışta açılır, daha yavaş başlar ve arkada süreç bırakabilir. Google API'nin 600 discovery belgesinden yalnızca `drive.v3.json` alınır; bu sayede paket 171 MB'tan 62 MB'a iner.
3. `electron-builder --win portable`: backend klasörü `extraResources` olarak gömülür ve sonuç `release/CyberGoose-<sürüm>-portable.exe` olur. Bu tek dosyadır ve kurulum gerektirmez.

Kurulumlu sürüm için `npm run dist:installer` (NSIS) kullanılır.

Doğrulama (Linux konteynerinde):

- PyInstaller paketi oluştu ve token'lı istekleri karşıladı.
- `backend.cjs` paketi 0,4 sn'de başlattı ve temiz kapattı.
- Windows'ta electron-builder çıktısı henüz denenmedi; ilk Windows build'inde kontrol edilmeli.

## 7. Tasarım sistemi uyumu

Kaynak, CyberGoose Design System'dir (Claude Artifact). Token'lar `frontend/src/styles/tokens.css`, bileşenler `app.css` içindedir.

- **Temalar:** Graphite (koyu, varsayılan) ve Paper (açık).
- **Yüzeyler:** Krom alanlar `bg-app`, şeritler `bg-raised`, veri alanları `bg-pane`. Yüzen katmanlar `bg-overlay` ve `shadow-overlay` kullanır; gölge yalnızca bunlardadır.
- **Turuncu:** Tek turuncu dolgu yalnızca primary buton, ilerleme çubuğu, odak çizgisi ve etkin bağlantı işaretinde kullanılır. Turuncu üzerindeki metin grafittir.
- **Tipografi:** IBM Plex Sans arayüz metninde, IBM Plex Mono yol, boyut, tarih ve host bilgisinde kullanılır. Fontlar pakete gömülüdür.
- **Ölçü ve hareket:** 4px ızgara kullanılır. Ölçüler başlık 36, araç çubuğu 40, yol 32, satır 28, durum 24 ve kenar 220'dir. Hareket 120 ms sürer; `prefers-reduced-motion` desteklenir.
- **Silme onayı:** Danger secondary buton kullanılır, turuncu primary değil.

## 8. Testler

| Komut | Kapsam |
|---|---|
| `npm run test:frontend` | 25 test: uygulama penceresi (gerçek API mock'u, hata durumu, bağlanma, indirme, tema), bağlantı diyaloğu, dosya detayları, API istemcisi, biçimlendiriciler |
| `npm run test:backend` | 12 test: sağlık, JSON zorunluluğu, API anahtarı, yerel listeleme ve hatalar, dosya detayı, bağlantı ve yer imi CRUD (parola sızmaz). Ayrıca gerçek FTP sunucusunda listeleme, indirme, 409 `exists`, üzerine yazma, yükleme, silme ve yanlış parola hatası. |

Ücretsiz test sunucusu: `test.rebex.net`. Kullanıcı adı `demo`, parola `password`. SFTP portu 22, FTP/FTPS portu 21. Sunucu salt okunurdur; listeleme ve indirme denenebilir.

## 9. Roadmap

### Backend ve güvenlik

1. Kayıtlı parolaları Windows Credential Manager'a taşımak (`keyring` paketi).
2. SFTP host anahtarı doğrulaması: `AutoAddPolicy` yerine parmak izini gösterip kullanıcı onayı almak.
3. Aktarım işleri için job API: ilerleme yüzdesi, hız, iptal ve SSE ile bildirim.
4. Tek global bağlantı yerine bağlantı kimliğiyle çoklu oturum.
5. Klasör silme ve yeniden adlandırma.
6. Git geçmişindeki `credentials.json`, `token.json`, `dropboxtoken.json` ve `data.db` dosyalarını takipten çıkarmak (`git rm --cached`) ve anahtarları yenilemek.

### Arayüz (tasarım sisteminde olup eksik olanlar)

7. SFTP özel anahtar ile giriş.
8. Sürükle-bırak aktarım ve kenar çubuğunda sıralama.
9. Çoklu seçim ve toplam boyut.
10. Ayarlar ekranı: yoğunluk, Sistem teması, birim tercihi.
11. Kendiliğinden kapanan başarı bildirimleri.
12. macOS/Linux ikonları ve tepsi ikonu.

### Bu sürümde tamamlananlar

- Örnek veriler tamamen kaldırıldı ve tüm ekranlar gerçek API'ye bağlandı.
- Klasörde gezinme (çift tık, `..`, yol parçaları, Ctrl+L) eklendi.
- Gerçek aktarım kuyruğu: yükleme, indirme, üzerine yazma ve yeniden deneme.
- Klasör yer imleri veritabanına bağlandı.
- Onaylı silme, uzak izinler ve chmod eklendi.
- FTPS desteği eklendi.
- Sağ tık menüleri ve klavye kısayolları eklendi.
- Logolu, animasyonlu açılış ekranı eklendi.
- Tek exe paketleme ve yerel API anahtarı eklendi.
- Klasörler `backend/`, `frontend/` ve `desktop/` olarak ayrıldı.
- Eski jQuery arayüzü (`template/`, `static/`, `images/`), OneDrive taslağı ve Vite şablon dosyaları kaldırıldı.
