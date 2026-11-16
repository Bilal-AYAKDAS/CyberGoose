import json
import os
import threading
import webbrowser
from urllib.parse import urlparse

import dropbox
from dropbox.exceptions import AuthError, BadInputError
from flask import Flask, request
import requests
from werkzeug.serving import make_server

from config import (
    DROPBOX_APP_KEY,
    DROPBOX_APP_SECRET,
    DROPBOX_REDIRECT_URI,
    DROPBOX_TOKEN_FILE,
)


class DropboxOperations:
    APP_KEY = DROPBOX_APP_KEY
    APP_SECRET = DROPBOX_APP_SECRET
    REDIRECT_URI = DROPBOX_REDIRECT_URI
    TOKEN_FILE = DROPBOX_TOKEN_FILE

    def __init__(self):
        self.app = Flask(__name__)
        self.server = None
        self.access_token = None
        self.refresh_token = None
        self.dbx = None

        @self.app.route('/oauth2/callback')
        def oauth2_callback():
            code = request.args.get('code')
            if not code:
                return "Dropbox izni alınamadı. CyberGoose'a dönüp tekrar deneyin.", 400
            token_url = 'https://api.dropboxapi.com/oauth2/token'
            data = {
                'code': code,
                'grant_type': 'authorization_code',
                'client_id': self.APP_KEY,
                'client_secret': self.APP_SECRET,
                'redirect_uri': self.REDIRECT_URI,
            }
            response = requests.post(token_url, data=data, timeout=15)
            response_data = response.json()
            self.access_token = response_data.get('access_token')
            self.refresh_token = response_data.get('refresh_token')

            if self.access_token and self.refresh_token:
                with open(self.TOKEN_FILE, 'w', encoding='utf-8') as token_file:
                    json.dump({'access_token': self.access_token, 'refresh_token': self.refresh_token}, token_file)
                self.dbx = self._client()
                threading.Thread(target=self.stop_server, daemon=True).start()
                return "Dropbox bağlantısı tamamlandı. Bu sekmeyi kapatıp CyberGoose'a dönebilirsiniz."
            return "Dropbox izni alınamadı. CyberGoose'a dönüp tekrar deneyin.", 400

        if self._load_existing_token():
            return

        if not (self.APP_KEY and self.APP_SECRET):
            raise ValueError("Dropbox için .env dosyasında DROPBOX_APP_KEY ve DROPBOX_APP_SECRET gerekli")

        self.start_server()
        self.get_access_token()

    def _load_existing_token(self) -> bool:
        if not os.path.exists(self.TOKEN_FILE):
            return False
        try:
            with open(self.TOKEN_FILE, 'r', encoding='utf-8') as token_file:
                token_data = json.load(token_file)
            self.access_token = token_data.get('access_token')
            self.refresh_token = token_data.get('refresh_token')
            if not self.access_token and not (self.refresh_token and self.APP_KEY and self.APP_SECRET):
                raise ValueError("Eksik Dropbox token bilgisi")
            client = self._client()
            client.users_get_current_account()
            self.dbx = client
            return True
        except (OSError, ValueError, AuthError, BadInputError):
            self.access_token = None
            self.refresh_token = None
            self.dbx = None
            try:
                os.remove(self.TOKEN_FILE)
            except OSError:
                pass
            return False

    def _client(self):
        """Refresh token varsa SDK süresi dolan erişim token'ını kendisi yeniler."""
        if self.refresh_token and self.APP_KEY and self.APP_SECRET:
            return dropbox.Dropbox(
                oauth2_access_token=self.access_token,
                oauth2_refresh_token=self.refresh_token,
                app_key=self.APP_KEY,
                app_secret=self.APP_SECRET,
            )
        return dropbox.Dropbox(self.access_token)

    def get_access_token(self):
        auth_url = (
            f"https://www.dropbox.com/oauth2/authorize?"
            f"client_id={self.APP_KEY}&response_type=code&redirect_uri={self.REDIRECT_URI}&token_access_type=offline"
        )
        webbrowser.open(auth_url)

    def refresh_access_token(self):
        token_url = 'https://api.dropboxapi.com/oauth2/token'
        data = {
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token,
            'client_id': self.APP_KEY,
            'client_secret': self.APP_SECRET,
        }
        response = requests.post(token_url, data=data, timeout=15)
        response_data = response.json()
        self.access_token = response_data.get('access_token')
        if not self.access_token:
            raise RuntimeError("Failed to refresh access token")
        with open(self.TOKEN_FILE, 'w', encoding='utf-8') as token_file:
            json.dump({'access_token': self.access_token, 'refresh_token': self.refresh_token}, token_file)
        self.dbx = self._client()

    def start_server(self):
        parsed = urlparse(self.REDIRECT_URI)
        host = parsed.hostname or 'localhost'
        port = parsed.port or 5000
        self.server = make_server(host, port, self.app)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop_server(self):
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    def close(self):
        self.stop_server()
