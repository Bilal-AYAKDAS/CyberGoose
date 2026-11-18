<p align="center"><img src="desktop/assets/icon.png" width="96" alt="CyberGoose"></p>

# CyberGoose

CyberGoose, yerel dosyalar ile FTP, FTPS, SFTP, Dropbox, Google Drive ve OneDrive arasında dosya aktaran iki panelli bir masaüstü dosya yöneticisidir. Windows için tek bir `.exe` olarak paketlenir.

- İki panel: yerel ve uzak. Klasörde gezinme, arama, sıralama, sağ tık menüleri ve gizli dosya gösterme (Ctrl+H) vardır.
- Kayıtlı bağlantılar ve klasör yer imleri kenar çubuğundadır. Parolalar Windows Kimlik Bilgileri Yöneticisi'nde (keyring) saklanır, arayüze hiç dönmez.
- Hızlı bağlan (Ctrl+K): kaydetmeden tek seferlik bağlantı. `user@sunucu:port` yapıştırılabilir.
- Aktarımlar arka planda, paralel (1-4) bir kuyrukta çalışır: ilerleme yüzdesi, iptal, yeniden deneme ve FTP/SFTP'de kaldığı yerden sürdürme. Her iş eklendiği bağlantıya bağlıdır; bağlantı değişse de dosya doğru sunucuya gider. Uzun aktarım sırasında panel kullanılmaya devam eder.
- Sürükle-bırak: panelden panele ya da Windows Gezgini'nden uzak panele dosya ve klasör.
- SFTP sunucusu ilk kez görüldüğünde parmak izi gösterilir ve onay istenir; anahtar değişirse bağlantı durdurulur.
- Yerel silme Geri Dönüşüm Kutusu'na taşır. Shift+Delete kalıcı siler.
- Uzak metin dosyası düzenleyici: dosyanın kodlaması (UTF-8, UTF-8 BOM, Windows-1254) ve satır sonu (CRLF/LF) korunur.
- Dosya detayları: SHA-256 (1 GB'a kadar), metin önizlemesi ve uzak dosya izinleri (chmod).
- SSH terminali (çok sekmeli), SSH tünelleri ve Uzak Masaüstü (RDP) kısayolu.
- Graphite (koyu), Paper (açık) ve Sistem temaları, iki satır yoğunluğu ve logolu bir açılış ekranı vardır.
- Bir şey çalışmazsa uygulama örnek veri göstermez, gerçek hatayı gösterir.

## Proje yapısı

```text
backend/    Python yerel API (Flask + flask-sock, Werkzeug sunucusu), sağlayıcılar, SQLite, pytest
frontend/   React + TypeScript + Vite arayüzü
desktop/    Electron kabuğu, backend'i başlatan kod, uygulama ikonu
docs/       Mimari belge
```

Ayrıntılar: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Gereksinimler

- Node.js 20 veya üstü
- Python 3.11 veya üstü (Windows'ta `py` başlatıcısı ya da PATH'te `python`)

## Kurulum

```powershell
npm run setup
```

`npm run setup` şunları yapar:

- kökteki Electron araçlarını ve `frontend/` bağımlılıklarını kurar,
- `backend\.venv` sanal ortamını oluşturur (yoksa),
- `backend/requirements-dev.txt` içindeki Python paketlerini bu ortama kurar (Send2Trash, keyring, paramiko dahil).

Venv'i elle etkinleştirmeniz gerekmez. Backend komutları (`dev:backend`, `test:backend`, `build:backend`) `scripts/python.cjs` aracılığıyla `backend\.venv` içindeki Python'u kendiliğinden kullanır. Sanal ortam yoksa ya da paketler eksikse komut ne yapılacağını söyleyen bir hata verir. Python paketleri değişirse yalnızca `npm run setup:backend` çalıştırmak yeterlidir.

Bulut hesapları için `backend/.env.example` dosyasını `backend/.env` olarak kopyalayıp doldurun:

- **Dropbox:** <https://www.dropbox.com/developers/apps> adresinde bir uygulama oluşturun. `DROPBOX_APP_KEY` ve `DROPBOX_APP_SECRET` değerlerini girin. Redirect URI olarak `http://localhost:5000/oauth2/callback` ekleyin.
- **Google Drive:** Google Cloud Console'da "Masaüstü uygulaması" türünde bir OAuth istemcisi oluşturun. İndirdiğiniz dosyayı `backend/credentials.json` olarak kaydedin.
- **OneDrive:** Azure portalında bir uygulama kaydı oluşturun ve `ONEDRIVE_CLIENT_ID` değerini girin. Kayıtta *Kimlik doğrulama > Platform ekle > Mobil ve masaüstü uygulamaları* altına `http://localhost` yönlendirme adresini ekleyin ve *Genel istemci akışlarına izin ver* seçeneğini açın. Aksi halde Microsoft `redirect_uri` hatası verir.

Ayarlanmamış bulut hesabı kenar çubuğunda soluk görünür; tıklayınca ne yapılacağı yazar.

FTP, FTPS ve SFTP için ayar gerekmez; bağlantıyı uygulamadan eklersiniz.

## Geliştirme

```powershell
npm run dev
```

Bu komut üç süreci birlikte açar:

- Flask API: `127.0.0.1:5502`
- Vite: `localhost:5175`
- Electron penceresi

Ayrı ayrı çalıştırmak için `npm run dev:backend`, `npm run dev:frontend` ve `npm run dev:electron` kullanılır. Yalnızca tarayıcıda denemek için backend ve frontend'i açıp `http://localhost:5175` adresine gidin.

Ücretsiz test sunucusu: `test.rebex.net`. Kullanıcı adı `demo`, parola `password`. SFTP portu 22, FTP/FTPS portu 21. Sunucu salt okunurdur; listeleme ve indirme denenebilir.

## Klavye kısayolları

| Kısayol | İş |
|---|---|
| Ctrl+K | Hızlı bağlan |
| Ctrl+L | Yolu düzenle |
| Ctrl+F | Bu klasörde ara |
| Ctrl+H | Gizli dosyaları göster / sakla |
| Ctrl+U / Ctrl+D | Seçilenleri yükle / indir |
| Ctrl+Shift+N | Yeni klasör |
| F2 | Yeniden adlandır |
| F5 | Yenile |
| Delete / Shift+Delete | Çöp kutusuna taşı / kalıcı sil |
| Tab | Diğer panele geç |
| Enter / Backspace | Aç / üst klasör |

## Test

```powershell
npm test               # frontend (Vitest) + backend (pytest)
npm run test:frontend
npm run test:backend   # gerçek yerel FTP ve SFTP sunucularıyla uçtan uca testler
npm run lint
```

## Tek exe oluşturma (Windows)

```powershell
npm run dist
```

Sonuç `release\CyberGoose-1.0.0-portable.exe` dosyasıdır. Tek dosyadır, kurulum gerektirmez. Adımlar:

1. `frontend` Vite ile derlenir.
2. `backend` PyInstaller ile `backend\dist\cybergoose-backend\` klasörüne paketlenir. Python kurulu olmayan makinede de çalışır.
3. electron-builder backend'i exe'nin içine gömer. Uygulama açılınca backend'i arka planda rastgele bir portta ve bir erişim anahtarıyla başlatır, kapanınca durdurur.

Kurulum sihirbazlı sürüm için `npm run dist:installer` kullanılır.

İmzalı exe üretmek için `CSC_LINK` ve `CSC_KEY_PASSWORD` ortam değişkenlerini verin; ayrıntılar `docs/SIGNING.md`'de.

Paketli uygulama verilerini `%APPDATA%\CyberGoose` klasöründe tutar: `data.db`, token dosyaları, `credentials.json` ve isteğe bağlı `.env`. Dropbox ve Drive'ı paketli uygulamada kullanmak için `.env` ve `credentials.json` dosyalarını bu klasöre koyun.

## Güvenlik notları

- `.env`, `credentials.json`, `token.json`, `dropboxtoken.json` ve `data.db` artık `backend/` altında ve `.gitignore`'da. Kökteki eski kopyalar bir sonraki commit'te takipten düşer. Ancak eski commit'lerde hâlâ duruyorlar; Dropbox ve Google anahtarlarını sağlayıcı panellerinden yenileyin.
- Kayıtlı parolalar SQLite'ta değil, Windows Kimlik Bilgileri Yöneticisi'nde (keyring) saklanır. Keyring yazılamazsa bağlantı parolasız kaydedilir ve arayüz bunu bir uyarıyla söyler; parola hiçbir zaman düz metin olarak diske yazılmaz.
- Eski sürümün `BOOKMARKS` tablosu ilk açılışta `CONNECTIONS` tablosuna taşınır (şema sürümü `PRAGMA user_version`). Kimlikler korunur.
- SFTP sunucu anahtarları `known_hosts` dosyasına yalnızca kullanıcı parmak izini onaylayınca yazılır.
- FTPS'de sertifika doğrulanır; kendinden imzalı sertifika parmak izi onaylanınca `ftps_certs.json`'a sabitlenir, değişirse bağlantı durdurulur.
