import json
import os
import secrets
import threading
import webbrowser
from urllib.parse import urlencode, urlparse

import dropbox
from dropbox.exceptions import AuthError, BadInputError
from flask import Flask, request
import requests
from werkzeug.serving import make_server

from oauth_pages import PAGE_HEADERS, render_oauth_page
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
        # OAuth "state": dönüş adresine başka bir sayfanın sahte kod göndermesini engeller.
        self.state = secrets.token_urlsafe(24)

        @self.app.route('/oauth2/callback')
        def oauth2_callback():
            def page(ok, message='', detail='', status=200):
                return render_oauth_page('Dropbox', ok, message, detail), status, PAGE_HEADERS

            if request.args.get('state') != self.state:
                return page(False, 'İzin isteği doğrulanamadı. Bu bağlantı CyberGoose tarafından başlatılmamış olabilir.', status=400)
            if request.args.get('error'):
                return page(False, 'Dropbox izni verilmedi.', request.args.get('error_description') or request.args.get('error'), 400)
            code = request.args.get('code')
            if not code:
                return page(False, 'Dropbox yetki kodu göndermedi.', status=400)
            token_url = 'https://api.dropboxapi.com/oauth2/token'
            data = {
                'code': code,
                'grant_type': 'authorization_code',
                'client_id': self.APP_KEY,
                'client_secret': self.APP_SECRET,
                'redirect_uri': self.REDIRECT_URI,
            }
            try:
                response = requests.post(token_url, data=data, timeout=15)
                response_data = response.json()
            except (requests.RequestException, ValueError) as exc:
                return page(False, 'Dropbox erişim anahtarı alınamadı.', str(exc), 502)
            self.access_token = response_data.get('access_token')
            self.refresh_token = response_data.get('refresh_token')

            if self.access_token and self.refresh_token:
                with open(self.TOKEN_FILE, 'w', encoding='utf-8') as token_file:
                    json.dump({'access_token': self.access_token, 'refresh_token': self.refresh_token}, token_file)
                self.dbx = self._client()
                threading.Thread(target=self.stop_server, daemon=True).start()
                return page(True)
            detail = response_data.get('error_description') or response_data.get('error') or ''
            return page(False, 'Dropbox erişim anahtarı alınamadı.', str(detail), 400)

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

    def authorize_url(self) -> str:
        return "https://www.dropbox.com/oauth2/authorize?" + urlencode({
            "client_id": self.APP_KEY,
            "response_type": "code",
            "redirect_uri": self.REDIRECT_URI,
            "token_access_type": "offline",
            "state": self.state,
        })

    def get_access_token(self):
        """İzin sayfasını varsayılan tarayıcıda açar (sekme kapatıldıysa yeniden çağrılabilir)."""
        webbrowser.open(self.authorize_url())

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
        try:
            self.server = make_server(host, port, self.app)
        except OSError as exc:
            raise RuntimeError(
                f"Dropbox izin dönüşü için {host}:{port} portu açılamadı; başka bir program kullanıyor olabilir. "
                ".env içindeki DROPBOX_REDIRECT_URI portunu değiştirip Dropbox uygulamasına da ekleyin."
            ) from exc
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop_server(self):
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    def close(self):
        self.stop_server()
