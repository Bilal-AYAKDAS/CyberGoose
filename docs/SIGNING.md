# Windows exe imzalama

İmzasız exe'yi Windows SmartScreen "tanınmayan uygulama" diye uyarır. İmzalı sürümde uygulama içi güncelleme de güvenceye alınır: çalışan exe imzalıysa indirilen güncelleme aynı yayıncının geçerli imzasını taşımazsa uygulanmaz.

## 1. Sertifika

- **OV kod imzalama sertifikası** (Sectigo, DigiCert, SSL.com vb.): SmartScreen itibarı indirmelerle zamanla oluşur.
- **EV sertifikası:** SmartScreen uyarısı ilk günden kalkar. Anahtar donanımda (USB token ya da bulut HSM) durur.
- **Azure Trusted Signing:** Bireysel geliştiriciler için uygun maliyetli; electron-builder `azureSignOptions` ile destekler.

Sertifikadaki CN (yayıncı adı) sonraki sürümlerde aynı kalmalıdır. Güncelleme kontrolü parmak izine değil yayıncı adına bakar, bu yüzden sertifika yenilemek sorun olmaz.

## 2. Dosya tabanlı sertifika (.pfx) ile imzalama

electron-builder bu ortam değişkenlerini kendiliğinden kullanır, `package.json`'da değişiklik gerekmez:

```powershell
$env:CSC_LINK = "C:\guvenli\cybergoose.pfx"   # ya da base64 içerik
$env:CSC_KEY_PASSWORD = "pfx-parolası"
npm run dist
```

Parolayı komut geçmişine yazmamak için oturumda `Read-Host -AsSecureString` kullanın ya da CI'da gizli değişken olarak verin. `.pfx` dosyası depoya asla eklenmemeli.

## 3. Donanım token'ı (EV) ile imzalama

Token takılıyken sertifika Windows sertifika deposunda görünür. `package.json` → `build.win` altına konu adını ya da parmak izini ekleyin:

```json
"win": {
  "signtoolOptions": { "certificateSubjectName": "Bilal AYAKDAS" }
}
```

## 4. Doğrulama

```powershell
Get-AuthenticodeSignature .\release\CyberGoose-<sürüm>-portable.exe | Format-List Status, SignerCertificate
```

`Status` değeri `Valid` olmalı. Zaman damgası electron-builder'ın varsayılan sunucusuyla eklenir; böylece sertifikanın süresi dolsa da imza geçerli kalır.

## 5. Güncelleme zinciri

1. İlk imzalı sürümü yayınlayın. İmzasız sürümden imzalıya geçişte kontrol zorunlu değildir (imzasız exe yayıncı bilgisi taşımaz).
2. Bundan sonraki her sürüm aynı yayıncı adıyla imzalanmalıdır. İmzasız ya da başka yayıncılı bir paket yayınlanırsa kullanıcılar uygulama içinden güncelleyemez, indirme sayfasına yönlendirilir.
