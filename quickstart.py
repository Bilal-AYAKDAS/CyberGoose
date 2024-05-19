import os.path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
import io
from googleapiclient.errors import HttpError

# If modifying these scopes, delete the file token.json.
SCOPES = ["https://www.googleapis.com/auth/drive"]

class GoogleDrive:
   
    def __init__(self):
        self.creds = None
        # The file token.json stores the user's access and refresh tokens, and is
        # created automatically when the authorization flow completes for the first
        # time.
        if os.path.exists("token.json"):
            self.creds = Credentials.from_authorized_user_file("token.json", SCOPES)
        # If there are no (valid) credentials available, let the user log in.
        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
            else:
                self.flow = InstalledAppFlow.from_client_secrets_file(
                        "credentials.json", SCOPES
                )
                self.creds = self.flow.run_local_server(port=0)
            # Save the credentials for the next run
            with open("token.json", "w") as token:
                token.write(self.creds.to_json())

        self.service = build("drive", "v3", credentials=self.creds)
        print("Google Drive API'ye başarıyla bağlanıldı.")
    
    def list_dir(self):
        """Google Drive'da belirtilen klasördeki dosyaları listeler."""

        results = self.service.files().list().execute()
        #results = self.service.files().list(q="name = 'local.h'").execute() çalışıyor
        #items = results.get("files", []) çalılşıyor
        items = results.get("kinds", [])
        if not items:
            print("No files found.")
        else:
            print("Files:")
            for item in items:
                print(f"{item['name']} ({item['id']})")

    def dosya_indir(self, sunucu_dosyaadi, yerel_dosyaadi):
        """Google Drive'dan dosya indirir."""
        pass

    def dosya_yukle(self, yerel_dosyaadi, sunucu_dosyaadi):
        file_metadata = {"name": yerel_dosyaadi}
        media = MediaFileUpload(yerel_dosyaadi, mimetype="image/jpeg")
        # pylint: disable=maybe-no-member
        file = (
            self.service.files()
            .create(body=file_metadata, media_body=media, fields="id")
            .execute()
        )
        print(f"Dosya yüklendi: {file.get('id')}")
    

    def delete_file(self, file_id):
        """Google Drive'dan dosya siler."""
        self.service.files().delete(fileId=file_id).execute()
        print(f'Dosya silindi: {file_id}')

gd = GoogleDrive()
if __name__ == "__main__":
  print("List files in folder")
  print(gd.list_dir())
  #https://developers.google.com/drive/api/guides/about-sdk?hl=tr