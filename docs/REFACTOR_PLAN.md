# CyberGoose Yeniden Yapılandırma Planı

## Hedef

CyberGoose'u güvenli, test edilebilir ve yeni depolama sağlayıcıları eklenebilir bir dosya yönetim uygulamasına dönüştürmek. Mevcut Flask uygulaması tamamen bir kerede çöpe atılmayacak; önce API ve iş mantığı ayrıştırılacak, ardından arayüz kademeli olarak yenilenecek.

## Mimari karar

### Önerilen teknoloji

- **Backend:** Python servisleri ve Flask API
- **Frontend:** React + TypeScript
- **Masaüstü hedefi:** İlk React sürümü tarayıcıda doğrulandıktan sonra Electron ile paketleme
- **Veri:** İlk aşamada SQLite; bookmark şifreleme ve migration altyapısından sonra gerekirse daha gelişmiş depolama
- **Yapılandırma:** `.env` ve üretimde işletim sistemi secret store'u

### Neden Flask korunmalı?

Flask mevcut FTP, SFTP, Dropbox ve Google Drive Python kütüphanelerini yeniden kullanmamızı sağlar. React yalnızca görünüm ve kullanıcı etkileşimini üstlenir; Flask da dosya sistemi ve üçüncü taraf servislerle güvenli bir API üzerinden konuşur. Böylece arayüz değişikliği bağlantı iş mantığını tekrar yazmayı gerektirmez.

Flask yalnızca geçiş çözümü değildir; küçük/orta ölçekli tek kullanıcı masaüstü uygulaması için yerel API olarak kalabilir. Ancak route'lar sağlayıcı detaylarını bilmemeli ve global bağlantı değişkeni kullanılmamalıdır.

## Öncelik sırası

### Faz 0 — Güvenlik ve temizlik

- `.env` kullanımı eklendi; Dropbox, Google ve Flask ayarları [config.py](../config.py) üzerinden okunuyor.
- Gerçek secret/token/credential dosyalarının Git geçmişinden çıkarılması ve tüm açığa çıkmış anahtarların yenilenmesi.
- `.gitignore` kontrolü ve mevcut hassas dosyaların takipten çıkarılması.
- Düz metin parolaların bookmark veritabanından kaldırılması.
- Windows Credential Manager veya işletim sistemi secret store entegrasyonu.
- SFTP host key doğrulaması; `AutoAddPolicy` kaldırılmalı.
- CORS yalnızca izin verilen origin'lerle sınırlandırılmalı.
- Debug varsayılan olarak kapalı tutulmalı.
- Yerel dosya erişimi izin verilen kök klasörle sınırlandırılmalı.

### Faz 1 — Backend katmanlarını ayırma

Önerilen yapı:

```text
backend/
  api/
  services/
  providers/
  models/
  security/
  errors/
```

- `StorageProvider` benzeri ortak bir arayüz tanımlanacak: `connect`, `list`, `stat`, `upload`, `download`, `delete`, `close`.
- FTP, SFTP, Dropbox, Google Drive, OneDrive ve local filesystem adapter'ları bu arayüzü uygulayacak.
- `serverConn` global değişkeni kaldırılacak; bağlantılar session/connection id ile yönetilecek.
- Her endpoint JSON başarı/hata sözleşmesine sahip olacak.
- `print` yerine yapılandırılabilir logging kullanılacak.
- Sağlayıcı hataları ortak hata tiplerine dönüştürülecek.
- Upload/download işlemleri job id ile takip edilecek; ilerleme ve iptal desteklenecek.
- Dosya yolları sağlayıcıya göre normalize edilecek; isim üzerinden belirsiz arama yapılmayacak.

### Faz 2 — Veri modeli ve testler

- Bookmark modeli: sağlayıcı, isim, host, port, kullanıcı ve secret referansı.
- Parolalar ve token'lar düz metin olarak SQLite'a yazılmayacak.
- SQLite migration mekanizması eklenecek.
- Provider adapter'ları mock'lanarak unit test yazılacak.
- API için bağlantı, listeleme, upload, download, silme ve hatalı path testleri eklenecek.
- Büyük dosya ve bağlantı kopması senaryoları test edilecek.
- CI'da lint, type-check ve test çalıştırılacak.

### Faz 3 — React arayüzü

Mevcut menü ve popup yaklaşımı yerine:

- Sol panel: yerel dosya sistemi.
- Sağ panel: aktif uzak bağlantı.
- Üst toolbar: bağlantı, yenile, yükle, indir, sil, yeni klasör.
- Sol sidebar: kayıtlı bağlantılar ve sağlayıcı filtreleri.
- Breadcrumb ve klasör ağacı.
- Sağ tık menüsü ve klavye kısayolları.
- Sürükle-bırak upload/download.
- İşlem kuyruğu ve ilerleme paneli.
- Toast tabanlı başarı/hata bildirimleri.
- Dosya ayrıntıları için modal.
- Koyu/açık tema, responsive düzen ve erişilebilirlik.

React bileşenleri API sözleşmelerine göre yazılmalı; sağlayıcı SDK'ları frontend'e sızmamalıdır.

### Faz 4 — Electron kararı ve paketleme

React web istemcisi ve Flask API ayrı ayrı stabil olduktan sonra:

- Electron main/preload katmanı tasarlanacak.
- Python backend uygulamayla birlikte güvenli şekilde başlatılacak.
- Renderer ile main process arasında yalnızca güvenli IPC kullanılacak.
- `nodeIntegration` kapalı, `contextIsolation` açık olacak.
- Windows installer, uygulama logları, güncelleme ve temiz kaldırma senaryoları eklenecek.

Electron masaüstü dağıtımı için uygundur; ancak bellek tüketimi ve Python runtime paketleme maliyeti vardır. Sadece web hedefi istenirse Electron eklenmez. Daha düşük kaynak tüketimi önemliyse React + Tauri ayrıca değerlendirilebilir.

## Uygulamaya eklenebilecek özellikler

1. Çoklu bağlantı sekmeleri.
2. Klasör senkronizasyonu ve iki yönlü karşılaştırma.
3. Dosya çakışması çözümü ve sürüm geçmişi.
4. Transfer kuyruğu, duraklatma, devam ettirme ve yeniden deneme.
5. Büyük dosyalarda parça parça aktarım.
6. Arama, filtreleme, sıralama ve sayfalama.
7. Toplu yeniden adlandırma ve toplu silme.
8. Dosya önizleme ve metin editörü.
9. Bağlantı sağlık kontrolü ve yeniden bağlanma.
10. Detaylı işlem geçmişi ve dışa aktarılabilir log.
11. Şifreli bağlantı profilleri.
12. S3-compatible storage, WebDAV ve SMB sağlayıcıları.

## İlk uygulanacak teknik işler

1. Secret rotation ve hassas dosyaların Git geçmişinden temizlenmesi.
2. Provider interface ve `ConnectionManager` oluşturulması.
3. Path güvenliği ve ortak hata yanıtlarının eklenmesi.
4. Mevcut API davranışlarının testlerle sabitlenmesi.
5. React + TypeScript istemci iskeletinin oluşturulması.
6. İki panelli dosya görünümünün React'e taşınması.
7. Transfer kuyruğunun eklenmesi.
8. Electron paketlemesinin karar verilerek uygulanması.
