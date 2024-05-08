from ftplib import FTP

class FTPOperations:
    
    def __init__(self,host,port,username,password):
        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self.ftp = FTP()
        self.ftp.connect(self.host,self.port)
        self.ftp.login(self.username, self.password)

    def dosyalari_listele(self):
        dosya_listesi = []
        self.ftp.dir(dosya_listesi.append)
        j=0

        dosya_dict_listesi = []

        for line in dosya_listesi:
            # Satırları boşluklara göre bölelim
            j = j + 1
            parts = line.split()
            # Tarih ve dosya adını ayırarak alalım
            size = parts[4]
            date = ' '.join(parts[5:8])
            filename = ' '.join(parts[8:])
            # Yeni bir sözlük oluşturarak dosya adı ve zaman damgasını ekleyelim
            dosya_dict = {"Sira":j,"FileName": filename, "TimeStamp": date, "Size":str(size)+" Byte"}
            # Oluşturulan sözlüğü dosya_dict_listesi'ne ekleyelim
            dosya_dict_listesi.append(dosya_dict)

        return dosya_dict_listesi

    def open_folder(self, directory):
        self.ftp.cwd(directory)
        contents = self.ftp.nlst()

        dosya_dict_listesi = []

        for filename in contents:
            # Get file details
            size = self.ftp.size(filename)
            timestamp = self.ftp.voidcmd('MDTM ' + filename)[4:]
            # Create dictionary with file details
            dosya_dict = {"FileName": filename, "TimeStamp": timestamp, "Size": str(size) + " Byte"}
            # Add dictionary to the list
            dosya_dict_listesi.append(dosya_dict)

        return dosya_dict_listesi
        

    def dosya_indir(self, sunucu_dosya_adi, yerel_dosya_adi):
        with open(yerel_dosya_adi, 'wb') as dosya:
            self.ftp.retrbinary('RETR ' + sunucu_dosya_adi, dosya.write)


    def dosya_yukle(self,sunucu_dosya_adi,dosyaadi):
        # Dosyayı sunucuya yükleme
        with open(dosyaadi, 'rb') as dosya:
            self.ftp.storbinary('STOR ' + sunucu_dosya_adi, open(dosyaadi, 'rb'))

    def dosya_sil(self,dosyaadi):
        self.ftp.delete(dosyaadi)

    def baglanti_kapat(self):
        self.ftp.quit()

#if __name__ == "__main__":
    
 #   f = FTPOperations("ftpupload.net",21,"if0_36404009","0920bilal")
  #  print(f.dosyalari_listele())
   # print(f.open_folder("/htdocs"))
    #f.dosya_indir("/htdocs/index2.html","C:/FileServer/index2.html") bunlar tamam
    #f.dosya_yukle("/htdocs/index.html","C:/FileServer/index.html") buda tamam

    