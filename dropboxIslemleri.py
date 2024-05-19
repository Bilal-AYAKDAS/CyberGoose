import dropbox
import json
import requests
import webbrowser
import json
from flask import Flask, request
import threading
import dropbox

class DropboxOperations:
    APP_KEY = 'iifp8329rj2ofzk'
    APP_SECRET = 'mc561rg96d5a8zs'
    REDIRECT_URI = 'http://localhost:5000/oauth2/callback'

    def __init__(self):
        self.app = Flask(__name__)
        self.access_token = None
        self.dbx = None
        self.start()

        @self.app.route('/oauth2/callback')
        def oauth2_callback():
            code = request.args.get('code')
            token_url = 'https://api.dropboxapi.com/oauth2/token'
            data = {
                'code': code,
                'grant_type': 'authorization_code',
                'client_id': self.APP_KEY,
                'client_secret': self.APP_SECRET,
                'redirect_uri': self.REDIRECT_URI
            }
            response = requests.post(token_url, data=data)
            response_data = response.json()
            self.access_token = response_data.get('access_token')

            if self.access_token:
                # Save the access token to use later
                with open('access_token.json', 'w') as token_file:
                    json.dump({'access_token': self.access_token}, token_file)
                self.dbx = dropbox.Dropbox(self.access_token)
                return f"Access token: {self.access_token}"
            else:
                return "Error: Could not get access token"

    def get_access_token(self):
        auth_url = (
            f"https://www.dropbox.com/oauth2/authorize?"
            f"client_id={self.APP_KEY}&response_type=code&redirect_uri={self.REDIRECT_URI}"
        )
        webbrowser.open(auth_url)
        print("A web browser has been opened for Dropbox authentication. Please authorize the application.")

    def start(self):
        threading.Thread(target=lambda: self.app.run(port=5000, debug=False, use_reloader=False)).start()
        self.get_access_token()

    

    def open_folder(self, directory):
        if directory == "/":  # Root directory
            directory = ""
        dosya_listesi = []
        try:
            for entry in self.dbx.files_list_folder(directory).entries:
                dosya_dict = {
                    "FileName": entry.name,
                    "TimeStamp": entry.client_modified.strftime('%Y-%m-%d %H:%M:%S') if hasattr(entry, 'client_modified') else 'N/A',
                    "Size": f"{entry.size} Byte" if hasattr(entry, 'size') else 'N/A'
                }
                dosya_listesi.append(dosya_dict)
        except dropbox.exceptions.ApiError as err:
            print(f"Failed to list folder: {err}")
        return dosya_listesi
    
    def dosya_yukle(self, sunucu_dosya_adi, dosyaadi):
        with open(dosyaadi, 'rb') as f:
            self.dbx.files_upload(f.read(), sunucu_dosya_adi, mute=True)
            print(f"{dosyaadi} başarıyla yüklendi.")
    
    def dosya_indir(self, sunucu_dosya_adi, yerel_dosya_adi):
        with open(yerel_dosya_adi, "wb") as f:
            metadata, res = self.dbx.files_download(path=sunucu_dosya_adi)
            f.write(res.content)
            print(f"{sunucu_dosya_adi} başarıyla indirildi.")
    
    def dosya_sil(self, dosyaadi):
        self.dbx.files_delete_v2(dosyaadi)
        print(f"{dosyaadi} başarıyla silindi.")
    
    def get_file_details(self, filepath):
        details = {}
        try:
            metadata = self.dbx.files_get_metadata(filepath)
            details['Size'] = metadata.size if hasattr(metadata, 'size') else 'N/A'
            details['Change'] = metadata.client_modified.strftime('%Y-%m-%d %H:%M:%S') if hasattr(metadata, 'client_modified') else 'N/A'
            details['FileName'] = metadata.name
            details['FilePath'] = filepath
            details['Type'] = 'Directory' if isinstance(metadata, dropbox.files.FolderMetadata) else 'File'
            print("File details retrieved successfully!")
        except dropbox.exceptions.ApiError as err:
            details['Error'] = str(err)
        return details
    
    def change_file_mode(self, dosyaadi, mod):
        print("Dropbox, dosya izinlerini değiştirme işlevine sahip değildir.")
    
    def close(self):
        print("Bağlantı kapatıldı")

# Kullanım örneği
if __name__ == "__main__":
    # Load access token from file
    #with open('dropboxtoken.json', 'r') as token_file:
    #    token_data = json.load(token_file)
    #access_token = token_data['token']

    dropbox_operations = DropboxOperations()
    if dropbox_operations.access_token:
        print("Bağlantı başarılı.")
    
        print(dropbox_operations.open_folder(""))
    # dropbox_operations.dosya_yukle("/uploaded_file.txt", "local_file.txt")
    # dropbox_operations.dosya_indir("/uploaded_file.txt", "downloaded_file.txt")
    # dropbox_operations.dosya_sil("/uploaded_file.txt")
    # details = dropbox_operations.get_file_details("/uploaded_file.txt")
    # print(details)
        dropbox_operations.close()
