import os
from google.auth.exceptions import RefreshError
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
        if os.path.exists(self.token_file):
            try:
                creds = Credentials.from_authorized_user_file(self.token_file, self.scopes)
            except (ValueError, OSError):
                creds = None

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                except RefreshError:
                    creds = None
                    try:
                        os.remove(self.token_file)
                    except OSError:
                        pass
            if not creds or not creds.valid:
                if not os.path.exists(self.client_secrets_file):
                    raise FileNotFoundError(f"credentials.json bulunamadı: {self.client_secrets_file}")
                flow = InstalledAppFlow.from_client_secrets_file(self.client_secrets_file, self.scopes)
                creds = flow.run_local_server(port=0)
            with open(self.token_file, 'w', encoding='utf-8') as token:
                token.write(creds.to_json())
        return build('drive', 'v3', credentials=creds)

    def close(self):
        service = getattr(self, 'service', None)
        if service is not None and hasattr(service, 'close'):
            service.close()
