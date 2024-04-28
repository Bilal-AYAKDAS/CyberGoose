from ftplib import FTP

class FTPIslemleri:
    
    def __init__(self,host,username,password):
        self.host = host
        self.username = username
        self.password = password
        self.ftp = FTP(self.host)
        self.ftp.login(self.username, self.password)

    def dosyalari_listele(self):
        self.ftp.dir()

    def dosya_indir(self,dosyaadi):
        with open(dosyaadi, 'wb') as dosya:
            ftp.retrbinary('RETR sunucuda_bulunan_dosya.txt', dosya.write)

    def dosya_yukle(self,dosyaadi):
        # Dosyayı sunucuya yükleme
        with open(dosyaadi, 'rb') as dosya:
            ftp.storbinary('STOR sunucuda_olusturulacak_dosya.txt', dosya)

    def dosya_sil(self,dosyaadi):
        ftp.delete(dosyaadi)

    def baglanti_kapat():
        ftp.quit()
    
ftp = FTPIslemleri("speedtest.tele2.net","anonymous","")
ftp.dosyalari_listele()
   