import os
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from config import GOOGLE_CLIENT_SECRETS_FILE, GOOGLE_TOKEN_FILE

class DriveService:
    def __init__(
        self,
        client_secrets_file=GOOGLE_CLIENT_SECRETS_FILE,
        token_file=GOOGLE_TOKEN_FILE,
        scopes=None,
    ):
        self.client_secrets_file = client_secrets_file
        self.token_file = token_file
        self.scopes = scopes or ['https://www.googleapis.com/auth/drive']
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
