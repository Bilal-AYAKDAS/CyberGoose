# CyberGoose Mimari Denetim ve Güncelleme Özeti

> Son güncelleme: 16.11.2026. Bu sürümde frontend, CyberGoose Design System'e (Claude Artifact, `AppWindow` referans ekranı) göre yeniden düzenlendi; önceki sürümdeki yanlış/eksik ifadeler düzeltildi (bkz. Bölüm 9).

## 1. Kapsam

Bu çalışma; React 19 + Vite 8 + TypeScript + Electron arayüzünün denetlenmesini, arayüzün CyberGoose Design System'e uyumlu hale getirilmesini, frontend'in modülerleştirilmesini, unit test altyapısını ve uygulamanın doğrulanmasını kapsar.

Flask backend mevcut sağlayıcı iş mantığını korur. React tarafı Flask API'ye merkezi bir istemci katmanı (`services/apiClient.ts`) üzerinden erişir. İncelenen backend route grupları:

- Bağlantı ve dosya işlemleri: `/submit`, `/api/localfiles`, `/api/serverfilelist`, `/api/uploadFile`, `/api/downloadFile`
- Dosya detay ve izinleri: `/api/fileinfo`, `/api/fileUpdate`, `/api/localfileinfo`, `/api/localfilepreview`
- Silme: `/api/deleteFileFromLocal`, `/api/deleteFileFromServer`
- Bookmark: `/api/bookmark`, `/api/localBookmark`, `/api/getBookmarksList`, `/api/saveBookmark`, `/api/deleteBookmark`

**Önemli:** React arayüzünde şu an yalnızca bağlantı (`/submit`) ve yerel dosya inceleme (`/api/localfileinfo`) gerçek API'ye bağlıdır. Dosya listeleri, yer imleri ve transfer kuyruğu `frontend/src/data/sampleData.ts` içindeki örnek veriyle çalışır (bkz. Bölüm 10).

## 2. Tespit Edilen Sorunlar

### Frontend (ilk React sürümü)

- `App.tsx` ekran kabuğu, statik veri, tema ve tüm etkileşimleri tek bileşende tutuyordu.
- Bağlantı modalı, yer imleri, transfer kuyruğu ve dosya inspector ekranları yoktu.
- API çağrıları için merkezi istemci ve ortak TypeScript tipleri yoktu.

### Frontend — tasarım sistemi denetimi (bu sürümde düzeltildi)

- Pencere iskeleti tasarımdan farklıydı: 62px üst bar, sayfa başlığı bloğu ("Dosyalar"), kart paneller, ok butonları ve "activity" kartı vardı; durum çubuğu yoktu.
- Kenar çubuğu Yerel / Yer imleri / Bulut gruplarını ve `kullanıcı@host:port` satırını göstermiyordu; grup başlıkları büyük harfti.
- PathBar ve ProtocolTag yoktu. Satırlar 28px yerine 45px'ti, satır arası çizgi ve büyük harf sütun başlıkları vardı; boyut sağa hizalı değildi, sıralama oku yoktu.
- Odaktaki panel ile diğer panelin seçimi ayrılmıyordu (`bg-selected-inactive` yoktu); turuncu üst çizgi odakta değil hover'da çıkıyordu.
- Transfer kuyruğu alttaki çekmece yerine sağdan açılan drawer'dı; durum renkleri yoktu (tamamlanan aktarım da turuncuydu).
- Bağlantı diyaloğunda segment kontrol, parola alanı ve "Hesabı bağla" akışı yoktu; listede backend'in desteklemediği S3 vardı, FTPS yoktu.
- Token eksikleri: `text-accent`, `text-on-accent`, `bg-selected-inactive`, `line-control`, `accent-hover`, `focus-ring`, `status-*` (+ `-soft`), spacing, radius, size ve `shadow-overlay`.
- Primary butonda turuncu üstüne beyaz metin vardı (tasarım: `text-on-accent` grafit). Açık temada `text-muted` için kullanılan `#888b87` 4.5:1 kontrastın altındaydı.
- İkonlar SVG seti yerine Unicode karakterlerdi (▰ ★ ⌕ ☼); logo kaz işareti yerine "C" harfiydi. Notice bileşeni yoktu.
- Fontlar Google Fonts CDN'den yükleniyordu; Electron uygulaması çevrimdışı açıldığında fontlar gelmiyordu.
- Boyutlar 1024 tabanlı hesaplanıyordu; tasarım ondalık birim (1 MB = 10⁶ B) istiyor.
- `index.html` başlığı "frontend", dili `en` idi.

### Frontend — hatalar (bu sürümde düzeltildi)

- Bağlantı modalı parola göndermiyordu; backend parola istediği için FTP/SFTP bağlantısı hiç kurulamıyordu.
- Backend hata durumunda HTTP 200 + `{'error': 'var'}` döndüğü için arayüz başarısız bağlantıyı "bağlandı" olarak gösteriyordu.
- Frontend `Dropbox` gönderiyordu, backend `DropBox` bekliyordu.
- FileInspector uzak dosyalar için de yerel endpoint'i (`/api/localfileinfo`) çağırıyordu.
- Vite `base` ayarı yoktu; `npm run dist` sonrası Electron `file://` ile yüklediğinde `/assets/...` yolları kırılıyordu.

### Electron

- `preload.cjs` sandbox açıkken `shell` modülünü kullanıyordu; sandbox'lı preload'da `shell` bulunmadığı için `openExternal` çalışmıyordu. (Düzeltildi: IPC ile main sürece devredildi.)
- Pencere zemini (`backgroundColor`) ve başlık çubuğu (`titleBarOverlay` / `hiddenInset`) tasarımdaki gibi ayarlanmamıştı. (Düzeltildi.)
- Güvenlik ayarları doğru: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

### Flask

- `/submit` her durumda HTTP 200 dönüyordu; `username and server and port and passwd or sshkey` koşulu operatör önceliği yüzünden yanlış çalışıyordu; bilinmeyen bağlantı türünde de "Başarılı" dönüyordu. (Düzeltildi, bkz. Bölüm 4.)
- `SFTPOperations` kimlik doğrulama hatalarını yutuyor ve **parolayı konsola yazdırıyor** (`sftpconn.py`, `print(hostname, port, username, password)`). `/submit` artık oturum açılmadıysa 502 dönüyor; `print` satırı hâlâ kaldırılmalı.
- `SFTPOperations` `AutoAddPolicy` kullanıyor; host anahtarı doğrulanmıyor.
- Global `serverConn` bağlantı state'i kullanılıyor; çoklu pencere/oturum mümkün değil.
- Diğer route'larda geniş `except Exception`, `print` ve 200 dönen hata response'ları sürüyor (`/api/uploadFile`, `/api/downloadFile`, silme ve bookmark route'ları).
- `/api/localfiles`, `/api/fileUpdate`, `/api/saveBookmark`, `/api/deleteBookmark` content-type kontrolünü katı string karşılaştırmasıyla yapıyor; `charset` eklenirse istek reddediliyor.
- `/api/compdirs` sabit, kullanıcıya özel bir Windows yolu kullanıyor.
- Yerel path doğrulaması ve path traversal koruması yok. CORS tüm origin'lere açık.
- Büyük dosya transferleri senkron request içinde yürütülüyor; ilerleme ve iptal yok.
- Bookmark parolaları düz metin olarak SQLite'a yazılıyor.

## 3. Mimari Kararlar

Frontend yapısı:

```text
frontend/src/
  components/
    AppChrome.tsx        TitleBar, Toolbar, StatusBar
    BookmarksPanel.tsx   Dizin yer imleri (yüzen panel)
    ConnectionModal.tsx  Tasarımdaki ConnectionDialog
    FileInspector.tsx    Dosya detayları (yüzen panel)
    FileManagerView.tsx  İki panel + sürüklenebilir ayırıcı
    FileTable.tsx        Dosya listesi (sıralama, klavye)
    GooseMark.tsx        Kaz işareti (logo)
    Icon.tsx             SVG ikon seti
    Modal.tsx            Diyalog kabuğu (Esc/Enter)
    Notice.tsx           Uyarı/hata/başarı bandı
    PathBar.tsx          Yol çubuğu
    ProtocolTag.tsx      Protokol etiketi + durum noktası
    Sidebar.tsx          Tasarımdaki ConnectionList
    TransferQueue.tsx    Alt aktarım çekmecesi
  data/
    sampleData.ts        Geçici örnek veri (API bağlanana kadar)
  hooks/
    useTheme.ts
  services/
    apiClient.ts
  styles/
    tokens.css           Tasarım sistemi token'ları (iki tema)
    app.css              cg-* bileşen stilleri
  types/
    index.ts
    electron.d.ts
  utils/
    formatters.ts        Boyut, hız, tarih, yol, protokol biçimleri
    status.ts            Bağlantı durumu tonu, kuyruk sayacı
  __tests__/
    App.test.tsx
    apiClient.test.ts
    ConnectionModal.test.tsx
    FileInspector.test.tsx
    formatters.test.ts
  App.tsx
  index.css              Gömülü fontlar + taban stiller
  main.tsx
  testSetup.ts
```

`frontend/src/assets/` altındaki `hero.png`, `react.svg`, `vite.svg` ve `public/icons.svg` Vite şablonundan kalmıştır ve kullanılmaz; silinebilir.

### State yaklaşımı

- Pencere state'i `App.tsx`'te: etkin bağlantı, odaktaki panel (`local` / `remote`), panel başına seçim, arama, açık paneller (inspector, yer imleri, diyalog) ve transfer kuyruğu.
- Tema `useTheme` hook'unda; `localStorage` ile kalıcı, Electron'a `setTheme` ile bildirilir.
- Bağlantı profilleri parola içermez; parola yalnızca bağlantı isteği sırasında gönderilir.
- Uygulama büyüdüğünde bu state'ler reducer veya küçük bir store'a taşınabilir.

### API yaklaşımı

`apiClient.ts` tüm istekleri `apiRequest<T>` üzerinden geçirir:

- JSON header'ları merkezi eklenir; HTTP hataları `ApiError` olarak yükseltilir.
- `connect()` arayüz tiplerini backend adlarına eşler (`Dropbox` → `DropBox`) ve parolayı `passwd` olarak gönderir. Eski backend sürümleri için 200 + `error` gövdesini de hata sayar.
- `listLocalFiles`, `listRemoteFiles`, `listBookmarks`, `getLocalFileInfo`, `getLocalFilePreview` typed giriş noktalarıdır; listeleme fonksiyonları henüz arayüzde kullanılmıyor.
- Sağlayıcı SDK'ları renderer'a taşınmaz.

### Electron yaklaşımı

`preload.cjs` yalnızca kontrollü API yayar:

- `platform`
- `openExternal(url)` — IPC ile main sürece gider; main yalnızca `https:` URL'lerini açar.
- `setTheme('dark' | 'light')` — main, başlık çubuğu overlay rengini ve pencere zeminini eşler.

`main.cjs`:

- `backgroundColor` = `bg-app` (beyaz flaş olmaz).
- macOS: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 12, y: 12 }`.
- Windows/Linux: `titleBarStyle: 'hidden'` + `titleBarOverlay` (`bg-app` / `text-muted`, 36px).
- Başlık çubuğu `-webkit-app-region: drag`, butonları `no-drag`.

## 4. Ekranlar ve Özellikler

### Uygulama penceresi (AppWindow)

Yukarıdan aşağı: başlık çubuğu 36 · araç çubuğu 40 · paneller · transfer kuyruğu (en fazla %40) · durum çubuğu 24. Soldan sağa: kenar çubuğu 220 · yerel panel · 1px ayırıcı · uzak panel.

- **Başlık çubuğu:** kaz işareti, "CyberGoose — kullanıcı@host", tema değiştir.
- **Araç çubuğu:** Yeni bağlantı · Yükle / İndir · Yenile · Sil · Detaylar · Yer imleri · "Bu klasörde ara". Tek primary buton vardır ve yönü odaktaki panele göre değişir (yerel → Yükle, uzak → İndir). Sil, dosya API'si bağlanana kadar devre dışıdır.
- **Durum çubuğu:** odaktaki paneldeki öğe/seçim sayısı ve boyutu, toplam aktarım hızı, protokol ve durum (düz FTP için "şifresiz").

### Kenar çubuğu (ConnectionList)

- Gruplar: Yerel, Yer imleri (FTP/SFTP), Bulut (Dropbox/Drive).
- Her satır: ikon, ad, `kullanıcı@host:port` (mono), durum noktası. Etkin bağlantı `bg-raised` + 2px turuncu sol çizgi.

### Dosya panelleri (FilePane + PathBar)

- PathBar: ProtocolTag (YEREL, FTP, SFTP, DROPBOX, DRIVE + durum noktası), chevron'lu mono yol, yenile. Uzun yollar baştan kısalır.
- Odaktaki panelin yol çubuğunda 2px turuncu üst çizgi; seçim odakta `bg-selected`, diğer panelde `bg-selected-inactive`.
- Liste: 28px satır, klasörler önce, Ad/Boyut/Değiştirilme sütunlarında sıralama, ok tuşlarıyla gezinme, Enter/çift tık ile detaylar.
- Boş klasör ve bağlı olmayan bağlantı için boş durum ("Bu klasör boş", "… bağlı değil" + Bağlan).
- Paneller arası ayırıcı fareyle veya ok tuşlarıyla sürüklenir; çift tık eşit genişliğe döndürür.

### Bağlantı diyaloğu (ConnectionDialog)

- Protokol segment kontrolü: FTP · FTPS (devre dışı, backend desteği yok) · SFTP · DROPBOX · DRIVE. Protokol değişince varsayılan port güncellenir.
- Alanlar: bağlantı adı, sunucu (mono) + port, kullanıcı adı, parola, başlangıç yolu (mono). Dropbox/Drive seçilince sunucu alanları yerini "Hesabı bağla"ya bırakır.
- Alan bazlı doğrulama; düz FTP için uyarı bandı; bağlantı hatası için hata bandı (teknik kod tooltip'te).
- Footer: Vazgeç · Kaydet (bağlanmadan profili ekler) · Bağlan. Enter = Bağlan, Esc = Vazgeç.

### Transfer kuyruğu

- Satır: yön ikonu, dosya adı + `kaynak → hedef` rotası, 4px ilerleme çubuğu + durum metni, hız/boyut, eylem.
- Durumlar: sırada, aktarılıyor (turuncu), duraklatıldı/iptal (amber), tamamlandı (yeşil), hata (kırmızı).
- Başlık sayacı "1 etkin · 1 sırada · 1 hata". Hata varken çekmece kapanmaz. İptal, yeniden dene, kaldır, tamamlananları temizle.
- Yükle/İndir seçili dosyayı kuyruğa ekler. **Not:** kuyruk henüz backend'e bağlı değildir; aktarımı gerçekte başlatmaz.

### Yer imleri ve dosya detayları

- Yer imleri: yüzen panel, isimle filtreleme, seçilen yer iminin bağlantısına ve yoluna geçiş.
- Dosya detayları: tür, yol, boyut, değiştirilme, izinler, SHA-256 ve metin önizleme. Yerel dosyalar için `/api/localfileinfo` çağrılır (SHA-256 1 MB parçalarla, önizleme en fazla 64 KB). Uzak dosyalar için endpoint yoktur; listedeki bilgiler gösterilir.

### Backend: `/submit`

- Başarı: 200 `{'Bağlantı': 'Başarılı'}`.
- 415 JSON değil · 400 eksik/geçersiz parametre veya desteklenmeyen tür · 502 sağlayıcıya bağlanılamadı (SFTP oturumu açılmadıysa dahil).
- Bağlantı türü büyük/küçük harf duyarsız (`DropBox` ve `Dropbox` aynı).
- `print` yerine `app.logger` kullanılır; parola loglanmaz.

## 5. Tasarım Sistemi Uyumu

Kaynak: CyberGoose Design System (Claude Artifact). Token'lar `frontend/src/styles/tokens.css`, bileşen stilleri `frontend/src/styles/app.css` (`cg-*` sınıfları, tasarımdaki `components/bundle.css` referans alınarak).

- **Temalar:** Graphite (koyu, varsayılan) ve Paper (açık); `<html data-theme="dark|light">`. Token adları iki temada aynıdır.
- **Yüzey katmanları:** krom `bg-app` (başlık, kenar, kuyruk, durum) · şerit `bg-raised` (araç çubuğu, yol çubuğu) · veri `bg-pane` (listeler, input'lar) · yüzen `bg-overlay` + `shadow-overlay` (diyalog, yer imleri, detaylar).
- **Çizgi, gölge değil:** paneller ve şeritler 1px `line` ile ayrılır. Gölge yalnızca yüzen katmanlarda (`shadow-overlay`) kullanılır. Odak çizgisi ve etkin bağlantı işareti `inset box-shadow` ile çizilir; bu bir gölge değil, 2px çizgidir.
- **Tek turuncu:** `brand-beak` dolgu yalnızca primary buton, ilerleme çubuğu, odaktaki panel çizgisi ve etkin bağlantı işaretinde. Turuncu metin/ikon için `text-accent`; turuncu üzerindeki metin `text-on-accent` (grafit, asla beyaz).
- **Tipografi:** IBM Plex Sans (400/500/600) arayüz metni; IBM Plex Mono (400/500) yol, boyut, tarih, izin, host:port, hız. `@fontsource` ile pakete gömülüdür, çevrimdışı çalışır. Temel boyut 13px; büyük harf yalnızca ProtocolTag'de.
- **Ölçüler:** 4px ızgara; `size-titlebar` 36, `size-toolbar` 40, `size-pathbar` 32, `size-row` 28, `size-control` 28, `size-statusbar` 24, `size-sidebar` 220; köşe 4/6/10.
- **İkonlar:** 24 ızgara, 1.5 çizgi, dolgusuz, 16px; renk `currentColor` (varsayılan `text-muted`, klasör `text-accent`). Tasarımdaki 14 ikon birebir; close, plus, sun, moon, info, alert aynı kurallarla eklendi.
- **Durum renkleri** yalnızca durum anlamında ve her zaman metinle birlikte ("Tamamlandı", "Bağlantı koptu").
- **Hareket:** hover/seçim 120ms, `cubic-bezier(0.2, 0, 0, 1)`; `prefers-reduced-motion` açıksa kapanır.
- **Erişilebilirlik:** klavye odağı 2px `focus-ring`; yalnız ikonlu butonlarda `aria-label` + tooltip; tablo sıralaması `aria-sort`; ilerleme çubukları `role="progressbar"`.

Tasarımda olup henüz uygulanmayanlar Bölüm 10'dadır.

## 6. Test Kapsamı

Vitest + React Testing Library + jsdom.

- `formatters.test.ts`: ondalık boyut/hız biçimi, yol birleştirme/bölme, `kullanıcı@host:port`, bağlantı durum tonu (düz FTP sarı), kuyruk sayacı.
- `apiClient.test.ts`: başarılı response, typed HTTP error, `connect()` parola gönderimi ve `DropBox` eşlemesi, 200 + `error` gövdesinin hata sayılması, 4xx/5xx mesajı.
- `ConnectionModal.test.tsx`: zorunlu alanlar, parolanın gönderilip profilde saklanmaması, bağlantı hatası bandı, düz FTP uyarısı ve devre dışı FTPS, bulut sağlayıcılarda "Hesabı bağla".
- `FileInspector.test.tsx`: API'den gelen SHA-256 ve önizleme, uzak dosyada yerel endpoint'in çağrılmaması, API hatasında hata bandı.
- `App.test.tsx`: pencere anatomisi, odaktaki panele göre primary buton, yükleme kuyruğa ekleme, çift tıkla detaylar, tema geçişi, yer imi filtreleme ve bağlantı diyaloğu, hatalı aktarımı yeniden deneme ve kuyruğun açık kalması, bağlı olmayan bağlantıda Bağlan.

`/submit` değişikliği, sağlayıcı sınıfları taklit edilerek Flask test client ile 200/400/415/502 senaryolarında elle doğrulandı; repoda henüz backend testi yoktur.

## 7. Doğrulama Sonuçları (16.11.2026)

Linux ortamında temiz `npm ci` ile:

- `npm run test:unit`: başarılı, 5 dosya, 26/26 test.
- `npx tsc -b`: hatasız.
- `npx oxlint src`: hata/uyarı yok.
- `npm run build`: başarılı; fontlar `dist/assets` içine gömülü, varlık yolları göreli (`./assets/...`).
- `node --check electron/main.cjs` ve `electron/preload.cjs`: başarılı.
- `python -m py_compile app.py`: başarılı.
- Vite preview'da Graphite ve Paper temaları ekran görüntüsüyle kontrol edildi; konsol hatası yok.

Windows'ta yeni bağımlılıkları kurmak için (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` eklendi):

```powershell
npm --prefix frontend install
npm run test
npm run dev
```

## 8. Roadmap — Backend ve Güvenlik

1. `sftpconn.py` içindeki parolayı yazdıran `print` satırının kaldırılması ve kimlik doğrulama hatalarının yutulmak yerine yükseltilmesi.
2. Flask global `serverConn` yerine oturum bazlı `ConnectionManager`.
3. Provider interface ve FTP/SFTP/Dropbox/Drive adapter'larının ortak sözleşmesi.
4. Yerel dosya path allowlist ve traversal koruması.
5. Bookmark secret'larının Windows Credential Manager veya şifreli secret store'a taşınması.
6. `/api/uploadFile` ve `/api/downloadFile` için background job, ilerleme ve iptal API'si.
7. Kalan route'larda doğru HTTP durum kodları, `request.is_json` ve `app.logger` (bkz. Bölüm 2, Flask).
8. CORS'un yalnızca uygulama origin'iyle sınırlandırılması; `/api/compdirs` sabit yolunun kaldırılması.
9. SFTP host anahtarı doğrulaması (`AutoAddPolicy` yerine bilinen host'lar + kullanıcı onayı).
10. Google Drive, Dropbox ve OneDrive OAuth akışlarının tek bağlantı modeliyle birleştirilmesi.
11. E2E testleri, Electron smoke test ve backend için pytest.
12. Electron paketleme, Windows installer ve uygulama güncelleme stratejisi.

Önceki roadmap'teki "Dosya inspector için gerçek hash hesaplama ve preview endpoint'i" maddesi tamamlandı (`/api/localfileinfo`, `/api/localfilepreview`).

## 9. Bu Sürümde Düzeltilen Doküman Hataları

- "Hiçbir CSS kuralında `box-shadow` kullanılmaz" ifadesi yanlıştı: tasarım yüzen katmanlarda `shadow-overlay` ister. Doğru kural Bölüm 5'te.
- "Claude Artifact tasarım prensipleri korunmuştur" ifadesi önceki kod için doğru değildi; farklar Bölüm 2'de listelendi ve giderildi.
- Bağlantı modalının `/submit` ile çalıştığı yazıyordu; parola gönderilmediği ve hatalar 200 döndüğü için çalışmıyordu.
- Bağlantı modalında S3 desteği yazıyordu; backend'de S3 yoktur, kaldırıldı.
- Roadmap 8 (inspector hash/preview) tamamlanmış olarak anlatılıp listede açık iş olarak duruyordu.
- Klasör ağacında `FileInspector.test.tsx` eksikti; `preload.cjs`'in `shell` kullanımının sandbox'ta çalışmadığı belirtilmemişti.
- Test sayısı (10) eski haliyle doğruydu; bu sürümde 26'dır.

## 10. Eklenecek Özellikler

Tasarım sisteminde tanımlı olup henüz uygulanmayanlar ve API entegrasyonu. Öncelik sırasıyla:

### Veri ve API

1. **Dosya listelerini API'ye bağlama:** `/api/localfiles` ve `/api/serverfilelist` yanıtlarını `FileEntry`'ye çeviren mapper'lar; klasöre çift tıkla girme, `..` ile üst klasöre çıkma, PathBar parçalarına tıklayarak gezinme.
2. **Gerçek transfer kuyruğu:** Yükle/İndir'in backend job API'sine bağlanması; ilerleme, hız ve kalan süre güncellemeleri; duraklat/sürdür/iptal; bağlantı koptuğunda "Bağlantı koptu · Yeniden dene".
3. **Yer imlerini API'ye bağlama:** `/api/getBookmarksList`, `/api/saveBookmark`, `/api/deleteBookmark`; diyalogdaki "Kaydet"in kalıcı kayıt yapması (parolasız; secret store ile).
4. **Silme:** onay diyaloğu (danger secondary buton, primary turuncu değil) ve `/api/deleteFile*` entegrasyonu.
5. **Uzak dosya detayları:** uzak dosyalar için metadata/izin endpoint'i ve inspector'da izin değiştirme (`/api/fileUpdate`).
6. **Bulut hesabı bağlama:** "Hesabı bağla"nın OAuth sayfasını `openExternal` ile varsayılan tarayıcıda açması ve dönüşte bağlantıyı tamamlaması.

### Tasarım sisteminde olup eksik olanlar

7. **FTPS** desteği (backend + segmentte etkinleştirme).
8. **SSH özel anahtarı** ile SFTP bağlantısı (diyalogda "Özel anahtar" alanı; hata örneği: "Anahtar okunamadı. Dosya izinlerini kontrol edin (600).").
9. **Bilinmeyen host anahtarı onayı:** Notice ile parmak izi gösterip kullanıcı onayı bekleme.
10. **PathBar düzenleme:** çift tık veya Ctrl+L / ⌘L ile yolu input'a çevirme; kopyalanan yolun `/` ile birleşmesi.
11. **Sağ tık menüleri:** bağlantılar için Bağlan, Düzenle, Kopyala, Sil; dosyalar için Yükle/İndir, Yeniden adlandır, Sil, Detaylar.
12. **Kenar çubuğunda sürükle-bırak ile sıralama.**
13. **Sürükle-bırak aktarım:** dosyayı panelden panele veya işletim sisteminden pencereye bırakma ("Dosyaları buraya bırakın").
14. **Çoklu seçim** (Shift/Ctrl) ve durum çubuğunda toplam boyut.
15. **İzinler sütunu** (opsiyonel) ve tarih biçiminin kullanıcı yerel ayarına göre seçilmesi.
16. **Ayarlar ekranı:** satır yoğunluğu (compact 28 / comfortable 32), tema (Graphite / Paper / Sistem — Electron `nativeTheme.shouldUseDarkColors`), ikili/ondalık birim tercihi.
17. **Başarı bildirimleri:** birkaç saniye sonra kendiliğinden kapanan ok Notice'leri (hata ve uyarılar kapanmaz).
18. **Uygulama ikonları:** tasarım sistemindeki `electron-icons/` (`icon.icns`, `icon.ico`, `icon.png`, `trayTemplate.png`) dosyalarının projeye eklenmesi ve `build.mac.icon` / `build.win.icon` / `build.linux.icon` ayarları; tepsi ikonu.
19. **Klavye kısayolları:** Ctrl+U yükle, Ctrl+D indir, F5 yenile, Delete sil, Tab ile paneller arası geçiş; kısayolların tooltip'te `mono-small` ile gösterilmesi.
20. **Electron Sistem teması:** `nativeTheme` değişikliğini renderer'a bildirme.
