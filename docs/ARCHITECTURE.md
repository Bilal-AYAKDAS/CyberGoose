# CyberGoose Mimarisi

Son güncelleme: 17.11.2026. Bu belge eski `ARCHITECTURE_AND_UPDATE_SUMMARY.md` dosyasının yerini alır.

## 1. Genel bakış

CyberGoose üç parçadan oluşur ve her parça kendi klasöründedir:

| Klasör | Teknoloji | Görevi |
|---|---|---|
| `backend/` | Python 3.11+, Flask, flask-sock, Werkzeug (threaded) | Yerel HTTP API. Yerel dosya sistemi, FTP/FTPS/SFTP, Dropbox ve Google Drive ile konuşur, SQLite'ta bağlantı ve yer imi saklar. |
| `frontend/` | React 19, TypeScript, Vite | Arayüz. Yalnızca API'yi çağırır; sağlayıcı SDK'ları burada yoktur. |
| `desktop/` | Electron 45 | Pencere, başlık çubuğu ve paketleme. Paketli uygulamada backend'i arka planda başlatır. |

```text
Electron (desktop/main.cjs)
 ├─ backend.cjs ─ spawn ─> cybergoose-backend.exe (Flask + Werkzeug, 127.0.0.1:<rastgele port>)
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

Tüm hatalar `{"error": "mesaj", "code": "kod", ...ek}` gövdesi ve uygun HTTP durum koduyla döner. POST/PUT istekleri JSON olmalıdır (aksi halde 415). Sayı alanları (`port`, `cols`, `sessionId`...) geçersizse 400 döner.

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/health` | Sağlık kontrolü |
| GET/PUT | `/api/session` | Etkin oturum `{connected, type, connectionId, sessionId}` |
| GET | `/api/providers` | Bulut hesaplarının ayarlı olup olmadığı `{dropbox, googledrive, onedrive}` |
| POST | `/api/connect` | `{type, host, port, username, password, keyPath?, trustHostKey?}` ya da `{type, connectionId}`. Yanıt `{connected, type, sessionId}`. Kayıtlı parola yoksa 400 `password_required`; SFTP anahtarı ilk kez görülüyorsa 409 `host_key_unknown` + `hostKey {host, type, fingerprint}`; anahtar değiştiyse 502 `host_key_changed`; yanlış kimlik 401 `auth_failed`. Dropbox izni bekleniyorsa 202 `{pending, message}` |
| POST | `/api/disconnect` | Bağlantıyı kapatır |
| GET | `/api/local/home`, `/api/local/drives` | Ev klasörü, sürücüler |
| POST | `/api/local/list` | `{path}` → `{path, parent, crumbs, entries}` |
| POST | `/api/local/stat` | Tek öğe (Gezgin'den bırakılan yol için) |
| POST | `/api/local/info` | SHA-256 (1 GB'a kadar, üstünde `null`), izinler, metin önizlemesi |
| POST | `/api/remote/list`, `/api/remote/info`, `/api/remote/chmod` | Uzak liste, izinler, chmod |
| POST | `/api/remote/read`, `/api/remote/write` | Metin düzenleyici. Okuma `{content, encoding, newline}` döner; ikili dosya 415, 256 KB üstü 413. Yazma aynı kodlama ve satır sonuyla, geçici dosya + yeniden adlandırma ile atomik yapılır |
| POST | `/api/transfers` | `{direction, name, localDir, remoteDir, overwrite?, resume?, sessionId?}` → iş. Hedef varsa 409 `exists` |
| GET | `/api/transfers/<id>` | İş durumu `{status, transferred, total, error, errorCode, result}` |
| POST | `/api/transfers/<id>/cancel` | İptal |
| POST | `/api/transfer/plan` | Klasörü dosya listesine açar (`sessionId?`) |
| POST | `/api/mkdir`, `/api/rename`, `/api/archive` | Klasör, yeniden adlandırma, zip |
| POST | `/api/delete` | `{side, path, permanent?}`. Yerelde varsayılan Geri Dönüşüm Kutusu'dur; taşınamazsa 409 `trash_failed`, ağ veya çıkarılabilir sürücüde 409 `trash_unavailable` (orada çöp kutusu yok) |
| GET/POST | `/api/connections` | Kayıtlı bağlantılar (parola asla dönmez, `hasPassword` döner; keyring yazılamazsa `warning`) |
| PUT/DELETE | `/api/connections/<id>` | Düzenleme ve silme |
| GET/POST/DELETE | `/api/bookmarks[/<id>]` | Klasör yer imleri |
| POST/DELETE | `/api/terminal/...`, WS `/ws/terminal/<id>` | SSH terminali |
| GET/POST/DELETE | `/api/tunnels[/<id>]` | SSH tünelleri |

Dosya girdisi: `{name, kind: file|folder, size, modified, path, hidden}`. `hidden`, adı nokta ile başlayan ya da Windows'ta gizli öznitelikli öğelerde `true` olur.

### Oturumlar ve aktarımlar

- `SessionManager` bir anda tek *etkin* oturum tutar. Panel işlemleri onun bağlantısını `lock` ile sırayla kullanır (ftplib ve paramiko eşzamanlı kullanılamaz). Bağlanma ağ işlemi kilidin dışında yapılır.
- Her oturuma artan bir `sessionId` ve bir `SessionSnapshot` verilir. Görüntü, aynı sunucuya yeni bağlantı açan bir `factory` içerir (FTP/FTPS/SFTP ve Google Drive). Bağlantı değişince eski görüntü "kapandı" işaretlenir ama son 16 görüntü tutulur, böylece kuyrukta bekleyen işler doğru sunucuya gider.
- `TransferManager` panel kilidini hiç tutmaz. İşler en fazla 4 paralel çalışır ve oturum başına küçük bir `ConnectionPool`'dan bağlantı ödünç alır (en fazla 2 boşta). Hatalı ya da iptal edilen bağlantı havuza geri konmaz.
- FTP ve SFTP aktarımları önce `.cgpart` dosyasına yazılır, bitince yeniden adlandırılır. `resume` ile yarım kalan dosyanın sonundan devam edilir (FTP `REST`/`APPE`, SFTP ofset).
- Uzaktan uzağa aktarım: sol panel `POST /api/side/connect` ile ikinci bir oturum açabilir (`open_side`). Bu oturum etkin oturumu değiştirmez, eski görüntü sınırına takılmaz ve `POST /api/side/disconnect` ile kapanır. Sol paneldeki listeleme, detaylar, chmod, metin/tablo düzenleyici, önizleme, harici düzenleyici, zip açma, arama ve karşılaştırma `sessionId` ile o oturumdan yapılır.
- `direction: "copy"` işi önce hedefteki çakışmayı çözer (atlanacak dosya hiç okunmaz), sonra veriyi **diske yazmadan akışla** taşır: bir iş parçacığı kaynaktan okuyup sınırlı bir bellek kanalına (`StreamPipe`, ~4 MB) yazar, iş hedefe yükler. İptal ve iki taraftaki hatalar karşı tarafı da durdurur; eksik kalan aktarım `incomplete` hatası verir. Google Drive ve OneDrive'a akış, boyut biliniyorsa ham resumable oturumla yapılır; boyutu bilinmeyen bir dosya (dışa aktarılan Google belgesi) bu iki hedefe gidiyorsa eski yönteme düşülür: `DATA_DIR/relay` altına indir, yükle, sil. Akışlı kopya iki sunucu yuvasını birlikte tutar; yuvalar tek bir kilit altında topluca alınır, böylece ters yönlü kopyalar birbirini kilitlemez.
- Bulut yüklemelerinde sürdürme: Dropbox (upload session), OneDrive (`createUploadSession`) ve Google Drive (`uploadType=resumable`, `AuthorizedSession` ile ham istek) büyük dosyaları parça parça gönderir. Oturum kimliği/adresi ve gönderilen bayt her parçadan sonra `DATA_DIR/upload_sessions.json`'a yazılır; anahtar yerel dosyanın yolu, boyutu, değiştirilme zamanı ve hedef yoludur. Kuyrukta yeniden denenen yükleme (`resume`) kayıt bulursa sunucuya kaç bayt aldığını sorar (OneDrive `nextExpectedRanges`, Drive `Content-Range: bytes */N`) ve oradan sürer; oturum düşmüşse baştan başlar. Kayıtlar 6 gün sonra unutulur. Drive bir parçanın yalnız bir kısmını alırsa dosya geri sarılır; akışta bu durum hatadır.
- Uzak zip açma (`POST /api/extract` `side: "remote"`): arşiv geçici klasöre indirilir, yerel açmayla aynı güvenlik kurallarıyla (zip-slip, boyut ve öğe sınırı) açılır ve klasör sunucuya `ad` ya da `ad (1)` olarak yüklenir. Sunucuda komut çalıştırılmaz, her sağlayıcıda çalışır.
- Harici düzenleyici (`edits/<kimlik>/`): her klasörde son yüklenen imzayı tutan `.cg-edit.json` vardır. Uygulama çöker ya da kapatılmadan sonlanırsa açılışta temizlenir: değişmemiş kopyalar silinir, yüklenmemiş değişiklik içeren kopya 7 gün tutulur.
- Terminal WebSocket'i Werkzeug'un threaded sunucusunda çalışır (paketli uygulamada da). Çok baytlı UTF-8 karakterler parçalara bölünse de artımlı çözücüyle doğru gösterilir. `?token=` sorgu parametresi yalnızca `/ws/` yollarında kabul edilir.

### Veritabanı

SQLite şeması `PRAGMA user_version` ile sürümlenir (şu an 6). Sürüm 1'deki `BOOKMARKS` tablosu `CONNECTIONS` tablosuna kimlikleri korunarak taşınır. Sürüm 3, SFTP bağlantılarına `KEY_PATH` (özel anahtar dosyasının yolu, dosyanın kendisi değil) ekler; 4 `GROUP_NAME`, 5 `USE_AGENT`, 6 `COMPARE_OFFSET` (karşılaştırma saat farkı, dakika; NULL otomatik). Parolalar keyring'de `CyberGoose` servis adı ve bağlantı kimliğiyle saklanır.

### Yapılandırma ve veri klasörü

`config.py` önce veri klasöründeki, sonra `backend/` içindeki `.env` dosyasını okur. Veri klasörü (`CYBERGOOSE_DATA_DIR`) `data.db`, `dropboxtoken.json`, `token.json` ve `credentials.json` dosyalarını tutar.

- Geliştirmede veri klasörü `backend/`.
- Paketli uygulamada Electron `%APPDATA%\CyberGoose` verir; exe güncellense de veriler kalır.

### Güvenlik

- API yalnızca `127.0.0.1`'e bağlanır.
- Paketli uygulamada Electron her açılışta rastgele bir anahtar üretir (`CYBERGOOSE_API_TOKEN`). Anahtarsız istekler 401 alır, böylece makinedeki başka programlar API'yi kullanamaz.
- CORS yalnızca Vite geliştirme adresine ve `file://` (`null`) kaynağına açıktır.
- Parolalar API yanıtlarında dönmez, loglanmaz ve SQLite'a yazılmaz (keyring).
- SFTP sunucu anahtarı ilk bağlantıda kullanıcıya gösterilir; onaylanmadan `known_hosts`'a yazılmaz. Değişen anahtarda bağlantı durdurulur.
- FTPS sertifikası önce sistemin güvendiği sertifika otoriteleriyle doğrulanır. Doğrulanamazsa (kendinden imzalı sertifika) parola gönderilmeden SHA-256 parmak izi kullanıcıya gösterilir; onaylanırsa `ftps_certs.json`'a sabitlenir. Sabitlenmiş sertifika değişirse bağlantı `host_key_changed` ile durdurulur.

## 4. Frontend

- **Veri:** Tüm veriler API'den gelir; örnek veri yoktur. API'ye ulaşılamazsa veya bir işlem başarısız olursa backend'in mesajı hata olarak gösterilir: panelde "Yeniden dene" düğmeli Notice, diyalogda hata bandı, kuyrukta hata satırı.
- **Durum:** `App.tsx` yalnızca parçaları birleştirir. Mantık hook'lardadır:
  - `useConnections`: kayıtlı, hızlı ve bulut bağlantıları, `sessionId`, sunucu anahtarı onayı.
  - `useTransferQueue`: paralel kuyruk, iş durumu sorgusu (geçici hatada geri çekilerek yeniden dener, iş kimliği kaybolmaz), iptal, sürdürme, kuyruk bitince tek özet bildirimi.
  - `useFileActions`: silme (çöp kutusu / kalıcı), yeni klasör, yeniden adlandırma, zip.
  - `useOverlays`: tüm diyalog, menü, detay ve terminal katmanları tek reducer'da; bir katman açıkken genel kısayollar kapanır.
  - `useDirectory`, `useBookmarks`, `useSettings`, `useTheme`.
- **Kod bölme:** Terminal (xterm.js), düzenleyici, ayarlar, tüneller ve uzak erişim diyalogları `React.lazy` ile ayrı parçalardır; açılış paketi bunları içermez.
- **Sürükle-bırak:** Satırlar (dosya ve klasör) diğer panele sürüklenir. Windows Gezgini'nden uzak panele bırakılan dosyaların yolu preload'daki `pathForFile` (Electron `webUtils`) ile alınır, `/api/local/stat` ile doğrulanıp kuyruğa eklenir.
- **Dar panel:** Paneller CSS container query kullanır; dar panelde önce tarih, sonra boyut sütunu gizlenir.
- **Açılış ekranı:** `index.html` içinde, JS yüklenmeden görünür ve kayıtlı temayı kullanır. Masaüstünde backend hazır olana kadar "Yerel sunucu başlatılıyor" yazar; başlatılamazsa hatayı ve "Yeniden dene" düğmesini gösterir. `prefers-reduced-motion` açıksa animasyon yapılmaz.
- **Kısayollar:** README'deki tabloya bakın.

## 5. Masaüstü (Electron)

- `contextIsolation`, `sandbox` açık, `nodeIntegration` kapalı.
- `preload.cjs` yalnızca şunları açar: `platform`, `openExternal` (yalnızca https), `setTheme`, `backend()` (API adresi ve anahtarı), `launchRdp`, `notify`, `pathForFile` (sürüklenen dosyanın yolu), güncelleme (`checkForUpdate`, `downloadUpdate`, `applyUpdate`, `onUpdateProgress`), `setActiveTransfers` ve `setTaskbarProgress`.
- Pencere `show: false` ile açılır ve `ready-to-show` olayında gösterilir. Zemin rengi `bg-app` ile aynıdır, böylece beyaz flaş olmaz.
- `backend.cjs` boş bir port seçer ve `cybergoose-backend.exe`'yi başlatır. `/api/health` yanıt verene kadar (en fazla 30 sn) bekler. Uygulama kapanırken süreci (Windows'ta `taskkill /T`) sonlandırır.

### Klasör karşılaştırma ve saat dilimi

`POST /api/compare` dosyaları boyuta göre "aynı/farklı" sayar; tarih yalnızca hangi tarafın daha yeni olduğunu söyler. FTP `LIST` tarihleri sunucunun yerel saatidir (ve yalnız dakika/gün hassasiyetindedir), Dropbox UTC verir. Dropbox tarihleri yerel saate çevrilir; `LIST` girdileri `mtimePrecision` taşır ve tolerans buna göre büyür. Sunucu saat farkı `timeOffsetMinutes` ile verilebilir; verilmezse aynı boyuttaki dosyaların çoğunluğu aynı çeyrek saatlik farkla kaymışsa bu fark otomatik uygulanır (`timeOffsetDetected`). Arayüzde "Sunucu saat farkı" seçimi vardır; kayıtlı bağlantılarda seçim `PUT /api/connections/<id>/compare-offset` ile saklanır ve sonraki karşılaştırmada hazır gelir. `leftSessionId` verilirse sol taraf da uzak bir klasördür.

"Hedefte fazla olan seçili dosyaları sil" açılırsa eşitleme, hedefte olup kaynakta olmayan seçili dosyaları da siler. Silmeden önce liste ve sonuç (yerelde Geri Dönüşüm Kutusu, sunucuda kalıcı) gösterilip onay istenir. Boş kalan klasörler silinmez.

### Büyük klasörler

`FileTable` 300 satırın üzerinde yalnızca görünen satırları (±20 tampon) çizer; üst ve alt boşluk satırları kaydırma yüksekliğini korur. Seçim, Ctrl+A ve Shift aralığı tüm listeye uygulanır; ok tuşlarıyla pencere dışına inildiğinde satır kaydırılıp çizildikten sonra odaklanır.

### Görev çubuğu

Kuyruk çalışırken renderer grup ilerlemesini (bayt oranı; boyutu bilinmeyen dosya varsa dosya başına ortalama) `setTaskbarProgress` ile gönderir, main `BrowserWindow.setProgressBar` çağırır. Hata alan dosya varsa çubuk kırmızıdır; kuyruk boşalınca kaldırılır.

### Güncelleme

`desktop/updater.cjs` GitHub Releases'tan son sürümü alır. Paket adresi renderer'a verilmez, main süreçte tutulur.

İndirmeden sonra çalışan exe ile indirilen exe'nin Authenticode imzası (`Get-AuthenticodeSignature`) okunur. Çalışan exe geçerli imzalıysa güncelleme de geçerli imzalı ve aynı yayıncıdan (sertifika konusundaki CN) olmalıdır; değilse dosya silinir ve güncelleme uygulanmaz. İmzasız derlemeden güncellemede imza zorunlu tutulamaz, yalnızca bozuk imza (`HashMismatch`) reddedilir. İmzalama adımları için `docs/SIGNING.md`.

- Taşınabilir exe: yeni exe aynı klasöre `<exe>.update` olarak indirilir; GitHub'ın verdiği SHA-256 özeti (yoksa boyut) doğrulanır. "Yeniden başlat ve güncelle" gizli bir PowerShell betiği (`-EncodedCommand`, Türkçe yollar güvenli) başlatır ve uygulamayı kapatır; betik exe kilidi kalkınca eskisinin yerine yenisini koyar ve başlatır. Değiştiremezse yeni exe'yi olduğu yerden açar.
- Kurulumlu sürüm: kurulum dosyası geçici klasöre indirilip çalıştırılır.
- Exe'nin klasörüne yazılamıyorsa (ör. Program Files) ya da geliştirme modunda indirme sayfası tarayıcıda açılır.

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
| `npm run test:frontend` | Vitest: uygulama penceresi (bağlanma, indirme, hızlı bağlan ve oturum bağlama, sunucu anahtarı onayı, gizli dosyalar, çöp kutusu / kalıcı silme, ayarlanmamış bulut), aktarım kuyruğu hook'u (oturum bağlama, durum sorgusu yeniden denemesi, iptal), diyaloglar, düzenleyici, API istemcisi, biçimlendiriciler |
| `npm run test:backend` | pytest: API sözleşmesi, gerçek yerel FTP ve SFTP sunucularıyla uçtan uca aktarım, sürdürme, kilitlenmeme (aktarım sürerken panel listeler), oturum bağlama, sunucu anahtarı onayı, paketli sunucuda WebSocket ve UTF-8, çöp kutusu, keyring uyarısı, eski veritabanı geçişi, düzenleyici kodlama/ikili/büyük dosya kontrolleri |

Ücretsiz test sunucusu: `test.rebex.net`. Kullanıcı adı `demo`, parola `password`. SFTP portu 22, FTP/FTPS portu 21. Sunucu salt okunurdur; listeleme ve indirme denenebilir.

## 9. Roadmap

1. Git geçmişindeki `credentials.json`, `token.json`, `dropboxtoken.json` ve `access_token.json` dosyalarını geçmişten temizlemek (anahtarlar yenilendikten sonra, sahibinin onayıyla).
2. Bulut indirmelerinde sürdürme (yüklemeler sürdürülüyor).
3. Aynı anda birden fazla etkin uzak bağlantı (sekmeli uzak panel).
4. macOS/Linux paketleri ve tepsi ikonu.
5. Kod imzalama sertifikası alınıp sürümlerin imzalı yayınlanması (altyapı hazır, bkz. `docs/SIGNING.md`).
