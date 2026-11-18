import os
import time
import webbrowser
import wsgiref.simple_server
import wsgiref.util
from urllib.parse import parse_qs
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from config import GOOGLE_CLIENT_SECRETS_FILE, GOOGLE_TOKEN_FILE
from oauth_pages import PAGE_HEADERS, render_oauth_page


class _QuietHandler(wsgiref.simple_server.WSGIRequestHandler):
    def log_message(self, *args):  # Tarayıcı isteklerini konsola yazma.
        pass


class _OAuthCallbackApp:
    """Google'ın yönlendirmesini karşılar, kodu token'a çevirir ve sonucu görsel sayfayla gösterir.

    google-auth-oauthlib'in `run_local_server`'ı düz metin döndürür ve izin reddedilse bile
    "tamamlandı" yazar; burada sayfa token alışverişinin gerçek sonucunu gösterir.
    """

    def __init__(self, flow):
        self.flow = flow
        self.done = False
        self.error = None

    def __call__(self, environ, start_response):
        if environ.get('PATH_INFO', '/') != '/' or self.done:
            start_response('404 Not Found', [('Content-Type', 'text/plain; charset=utf-8')])
            return [b'']
        query = parse_qs(environ.get('QUERY_STRING', ''))
        ok = False
        detail = ''
        if 'error' in query:
            self.error = query['error'][0]
            message = 'Google Drive izni verilmedi.' if self.error == 'access_denied' else 'Google izin isteği başarısız oldu.'
            detail = self.error
        elif 'code' not in query:
            self.error = 'Yetki kodu gelmedi'
            message = 'Google yetki kodu göndermedi.'
        else:
            # oauthlib yalnızca https kabul eder; yerel yönlendirme http olduğundan çevrilir.
            authorization_response = wsgiref.util.request_uri(environ).replace('http', 'https', 1)
            try:
                self.flow.fetch_token(authorization_response=authorization_response)
                ok = True
                message = ''
            except Exception as exc:  # noqa: BLE001 - kullanıcıya gösterilip yeniden fırlatılır
                self.error = str(exc) or exc.__class__.__name__
                message = 'Google erişim anahtarı alınamadı.'
                detail = self.error
        self.done = True
        start_response('200 OK' if ok else '400 Bad Request', list(PAGE_HEADERS.items()))
        return [render_oauth_page('Google Drive', ok, message, detail).encode('utf-8')]


def run_local_oauth(flow, host='localhost', port=0, timeout_seconds=300, open_browser=webbrowser.open):
    """InstalledAppFlow için yerel yönlendirme sunucusu; kimlik bilgilerini döndürür."""
    app = _OAuthCallbackApp(flow)
    server = wsgiref.simple_server.make_server(host, port, app, handler_class=_QuietHandler)
    try:
        flow.redirect_uri = f'http://{host}:{server.server_port}/'
        auth_url, _ = flow.authorization_url()
        open_browser(auth_url)
        deadline = time.monotonic() + timeout_seconds
        while not app.done:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Google izni zaman aşımına uğradı; bağlanmayı tekrar deneyin.')
            server.timeout = remaining
            server.handle_request()
    finally:
        server.server_close()
    if app.error:
        raise RuntimeError(f'Google Drive izni alınamadı: {app.error}')
    return flow.credentials


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
        self.credentials = None
        self.authorized_session = None  # Ham resumable yükleme isteklerinde kullanılır, ilk ihtiyaçta açılır.
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
                creds = run_local_oauth(flow)
            with open(self.token_file, 'w', encoding='utf-8') as token:
                token.write(creds.to_json())
        self.credentials = creds
        return build('drive', 'v3', credentials=creds)

    def close(self):
        session = getattr(self, 'authorized_session', None)
        if session is not None:
            session.close()
            self.authorized_session = None
        service = getattr(self, 'service', None)
        if service is not None and hasattr(service, 'close'):
            service.close()
