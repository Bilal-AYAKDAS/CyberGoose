import os
import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

class DriveService:
    def __init__(self, client_secrets_file='credentials.json', token_file='token.json', scopes=['https://www.googleapis.com/auth/drive']):
        self.client_secrets_file = client_secrets_file
        self.token_file = token_file
        self.scopes = scopes
        self.service = self.create_drive_service()

    def create_drive_service(self):
        creds = None
        # Token dosyası mevcutsa yükleyin
        if os.path.exists(self.token_file):
            creds = Credentials.from_authorized_user_file(self.token_file, self.scopes)
        # Token mevcut değilse veya geçersizse, kullanıcı kimlik doğrulaması yapın
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(self.client_secrets_file, self.scopes)
                creds = flow.run_local_server(port=0)
            # Yeni tokenı kaydedin
            with open(self.token_file, 'w') as token:
                token.write(creds.to_json())
        return build('drive', 'v3', credentials=creds)

    def list_files(self, folder):
        dosya_dict_listesi = []
        if folder == "/":
            query = "'root' in parents and trashed=false"
        else:
            query = f"'{folder}' in parents and trashed=false"
        results = self.service.files().list(q=query, pageSize=100).execute()
        items = results.get('files', [])
        if not items:
            print('No files found.')
        else:
            print('Files:')
            j = 0
            for item in items:
                j = j + 1
                # Dosya adı, ID ve boyutunu alalım
                filename = item['name']
                id = item['id']
                size = ""
                # Yeni bir sözlük oluşturarak dosya adı, ID ve boyutunu ekleyelim
                dosya_dict = {"Sira":j,"FileName": filename, "TimeStamp": id, "Size":str(size)+" Byte"}
                # Oluşturulan sözlüğü dosya_dict_listesi'ne ekleyelim
                dosya_dict_listesi.append(dosya_dict)
        return dosya_dict_listesi

    def upload_file(self, file_path, mime_type='application/octet-stream'):
        file_metadata = {'name': os.path.basename(file_path)}
        media = MediaFileUpload(file_path, mimetype=mime_type)
        file = self.service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        print(f"Uploaded file with ID {file.get('id')}")

    def download_file(self, file_id, output_file):
        request = self.service.files().get_media(fileId=file_id)
        with open(output_file, 'wb') as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
        print(f"Downloaded file to {output_file}")

    def delete_file(self, file_id):
        self.service.files().delete(fileId=file_id).execute()
        print(f"Deleted file with ID {file_id}")

drive_service = DriveService()
if __name__ == '__main__':
    print(drive_service.list_files("/"))
    
    #drive_service.upload_file("test.txt")
#drive bağlantısı var denendi
#dosya yükleme var denendi
#klasör yapısı farklı 
