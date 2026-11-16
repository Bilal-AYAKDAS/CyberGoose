import dropbox
import json
import requests
import webbrowser
import os
from flask import Flask, request
import threading
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
            self.refresh_token = response_data.get('refresh_token')

            if self.access_token and self.refresh_token:
                # Save the tokens to use later
                with open(self.TOKEN_FILE, 'w') as token_file:
                    json.dump({'access_token': self.access_token, 'refresh_token': self.refresh_token}, token_file)
                self.dbx = self._client()
                threading.Thread(target=self.stop_server).start()
                return "Dropbox bağlantısı tamamlandı. Bu sekmeyi kapatıp CyberGoose'a dönebilirsiniz."
            else:
                return "Dropbox izni alınamadı. CyberGoose'a dönüp tekrar deneyin."

        if os.path.exists(self.TOKEN_FILE):
            with open(self.TOKEN_FILE, 'r') as token_file:
                token_data = json.load(token_file)
            self.access_token = token_data.get('access_token')
            self.refresh_token = token_data.get('refresh_token')
            self.dbx = self._client()
        else:
            self.start_server()
            self.get_access_token()

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
            'client_secret': self.APP_SECRET
        }
        response = requests.post(token_url, data=data)
        response_data = response.json()
        self.access_token = response_data.get('access_token')
        if not self.access_token:
            raise Exception("Failed to refresh access token")
        with open(self.TOKEN_FILE, 'w') as token_file:
            json.dump({'access_token': self.access_token, 'refresh_token': self.refresh_token}, token_file)
        self.dbx = self._client()

    def start_server(self):
        self.server = make_server('localhost', 5000, self.app)
        threading.Thread(target=self.server.serve_forever).start()

    def stop_server(self):
        if self.server is not None:
            self.server.shutdown()

    def close(self):
        self.stop_server()
