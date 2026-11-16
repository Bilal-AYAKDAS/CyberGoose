# CyberGoose

CyberGoose, yerel dosyalar ile FTP, SFTP, Dropbox ve Google Drive gibi uzak depolar arasında dosya aktarımı yapmayı hedefleyen iki panelli bir dosya yöneticisidir.

## Mevcut durum

Mevcut sürüm Flask ve server-rendered HTML/JavaScript kullanır. Yerel dosya listeleme, FTP/SFTP bağlantısı, Dropbox işlemleri, temel Google Drive bağlantısı, dosya yükleme/indirme/silme ve bağlantı bookmark'ları bulunur. OneDrive sınıfı henüz ana akışa bağlanmamıştır.

Yeni arayüz iskeleti React 19.3.1 + TypeScript + Vite 8.3.8 ve Electron 45.3.3 ile kurulmuştur. Tasarım sistemi Claude Artifact'taki Graphite/Paper temalarını, IBM Plex Sans/Mono tipografisini, 4px ızgarayı ve tek turuncu `#ff6a1f` aksanını takip eder.

Bu sürüm yeniden yapılandırma aşamasındadır. Güvenlik, sağlayıcı soyutlaması, hata yönetimi, testler ve kullanıcı arayüzü modernizasyonu önceliklidir.

## Kurulum

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

`.env` dosyasına yalnızca kullanılacak sağlayıcıların değerlerini girin. `.env`, OAuth token dosyaları, Google credentials dosyaları ve yerel veritabanı Git'e gönderilmemelidir.

```powershell
python app.py
```

Varsayılan adres: `http://127.0.0.1:5502`

React geliştirme arayüzü:

```powershell
npm run dev:frontend
```

Electron geliştirme penceresi:

```powershell
npm run dev
```

Production build ve Windows installer:

```powershell
npm run dist
```

## Yapılandırma

Yapılandırma [config.py](config.py) tarafından `.env` dosyasından okunur. Örnek değişkenler [.env.example](.env.example) dosyasındadır:

- Dropbox OAuth uygulama anahtarı, gizli anahtarı ve callback adresi
- Google Drive OAuth credentials/token dosya yolları
- Flask host, port ve debug ayarı

Gerçek anahtarlar, parolalar veya token'lar kaynak koda yazılmamalıdır. Daha önce açığa çıkmış anahtarlar ayrıca sağlayıcı panellerinden yenilenmelidir.

## Proje yapısı

- `app.py`: HTTP route'ları ve mevcut uygulama giriş noktası
- `config.py`: ortam değişkenleri ve uygulama ayarları
- `ftpconn.py`, `sftpconn.py`: FTP/SFTP sağlayıcıları
- `dropboxIslemleri.py`, `drive_conn.py`, `onedriveislem.py`: bulut sağlayıcıları
- `os_folder.py`: yerel dosya işlemleri
- `db.py`: mevcut SQLite bookmark işlemleri
- `template/`, `static/`: mevcut web arayüzü
- `docs/REFACTOR_PLAN.md`: hedef mimari ve aşamalı dönüşüm planı

## Flask gerekli mi?

Kısa vadede evet. Flask mevcut sağlayıcı kodlarını ve API endpoint'lerini React arayüzünden ayırmak için uygun bir geçiş katmanıdır. Ancak uzun vadede Flask route'larının doğrudan dosya işlemi yapması yerine provider/service katmanının arkasında kalan bir API olması gerekir.

Önerilen sıra:

1. Flask API ve Python sağlayıcı katmanını güvenli hale getirmek.
2. Mevcut HTML/JavaScript yerine React tabanlı bir web istemcisi geliştirmek.
3. Gerekirse React istemcisini Electron ile paketleyerek masaüstü uygulamasına dönüştürmek.

Electron kararı, ilk refactor tamamlanmadan verilmemelidir. Önce API ve React istemcisi tarayıcıda doğrulanır; böylece masaüstü paketleme sorunu iş mantığıyla karışmaz.

## Güvenlik notu

Bu proje uzak sistem kimlik bilgileri ve dosya işlemleriyle çalışır. Üretim kullanımından önce kimlik bilgisi kasası, şifreli bookmark saklama, SFTP host key doğrulaması, path doğrulaması, oturum yönetimi ve işlem onayları tamamlanmalıdır.
