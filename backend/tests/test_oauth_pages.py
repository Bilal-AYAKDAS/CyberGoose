"""OAuth dönüş sayfaları: görsel HTML, kaçışlama ve gerçek sonucun gösterilmesi."""
import string
import threading
import urllib.error
import urllib.request
from types import SimpleNamespace

import pytest

from oauth_pages import PAGE_HEADERS, render_oauth_page


def test_success_page_uses_branding_and_theme():
    html = render_oauth_page("Google Drive", True)
    assert html.startswith("<!doctype html>")
    assert "Google Drive bağlantısı tamamlandı" in html
    assert "CyberGoose" in html and "#FF6A1F" in html  # logo gagası
    assert "prefers-color-scheme:light" in html
    assert 'role="status"' in html
    assert "<script" not in html and "http" not in html.replace("http://www.w3.org", "")


def test_error_page_escapes_detail():
    html = render_oauth_page("Dropbox", False, "İzin verilmedi", '<script>alert("x")</script>')
    assert 'role="alert"' in html
    assert "Dropbox bağlantısı kurulamadı" in html
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_headers_block_scripts_and_caching():
    assert PAGE_HEADERS["Content-Type"].startswith("text/html")
    assert "default-src 'none'" in PAGE_HEADERS["Content-Security-Policy"]
    assert PAGE_HEADERS["Cache-Control"] == "no-store"


def test_onedrive_templates_are_safe_for_msal():
    from providers import onedrive

    # MSAL sayfayı string.Template ile doldurur; başka $ alanı olmamalı.
    assert onedrive.ONEDRIVE_SUCCESS_PAGE == string.Template(onedrive.ONEDRIVE_SUCCESS_PAGE).safe_substitute()
    filled = string.Template(onedrive.ONEDRIVE_ERROR_PAGE).safe_substitute(error="access_denied", error_description="")
    assert "access_denied" in filled and "OneDrive bağlantısı kurulamadı" in filled


class FakeFlow:
    def __init__(self, fail=None):
        self.redirect_uri = None
        self.fail = fail
        self.token_response = None
        self.credentials = SimpleNamespace(token="tok")

    def authorization_url(self):
        return "https://accounts.example/auth", "state"

    def fetch_token(self, authorization_response):
        self.token_response = authorization_response
        if self.fail:
            raise self.fail


def _run(flow, query, extra_paths=()):
    from providers.google_drive import run_local_oauth

    pages = []
    threads = []

    def browser(_url):
        def visit():
            for path in extra_paths:
                try:
                    urllib.request.urlopen(flow.redirect_uri.rstrip("/") + path, timeout=5)
                except urllib.error.HTTPError as exc:
                    pages.append((path, exc.code, ""))
            try:
                with urllib.request.urlopen(flow.redirect_uri + query, timeout=5) as response:
                    pages.append(("/", response.status, response.read().decode(), response.headers["Content-Type"]))
            except urllib.error.HTTPError as exc:
                pages.append(("/", exc.code, exc.read().decode(), exc.headers["Content-Type"]))
        thread = threading.Thread(target=visit, daemon=True)
        threads.append(thread)
        thread.start()

    result = error = None
    try:
        result = run_local_oauth(flow, timeout_seconds=10, open_browser=browser)
    except Exception as exc:  # noqa: BLE001
        error = exc
    for thread in threads:
        thread.join(5)
    return result, error, pages


def test_google_flow_shows_branded_success_after_token_exchange():
    flow = FakeFlow()
    creds, error, pages = _run(flow, "?state=s&code=abc", extra_paths=("/favicon.ico",))
    assert error is None and creds.token == "tok"
    assert flow.token_response.startswith("https://localhost:")
    assert pages[0][:2] == ("/favicon.ico", 404)
    _, status, body, content_type = pages[-1]
    assert status == 200 and content_type.startswith("text/html")
    assert "Google Drive bağlantısı tamamlandı" in body


def test_google_flow_reports_denied_access():
    flow = FakeFlow()
    creds, error, pages = _run(flow, "?error=access_denied&state=s")
    assert creds is None and "access_denied" in str(error)
    assert flow.token_response is None
    _, status, body, _ = pages[-1]
    assert status == 400 and "Google Drive izni verilmedi" in body


def test_google_flow_shows_token_exchange_failure():
    flow = FakeFlow(fail=ValueError("Mismatching state"))
    creds, error, pages = _run(flow, "?state=bad&code=abc")
    assert creds is None and "Mismatching state" in str(error)
    assert "Google erişim anahtarı alınamadı" in pages[-1][2]


def test_google_flow_times_out():
    from providers.google_drive import run_local_oauth

    with pytest.raises(TimeoutError):
        run_local_oauth(FakeFlow(), timeout_seconds=0.3, open_browser=lambda _url: None)


@pytest.fixture()
def dropbox_app(monkeypatch):
    from providers import dropbox_oauth

    monkeypatch.setattr(dropbox_oauth.DropboxOperations, "_load_existing_token", lambda self: True)
    ops = dropbox_oauth.DropboxOperations()
    return ops, ops.app.test_client(), dropbox_oauth


def test_dropbox_callback_rejects_bad_state_with_branded_page(dropbox_app):
    _, client, _ = dropbox_app
    response = client.get("/oauth2/callback?state=wrong&code=x")
    assert response.status_code == 400
    assert response.content_type.startswith("text/html")
    body = response.get_data(as_text=True)
    assert "Dropbox bağlantısı kurulamadı" in body and "doğrulanamadı" in body


def test_dropbox_callback_reports_denied_access(dropbox_app):
    ops, client, _ = dropbox_app
    response = client.get(f"/oauth2/callback?state={ops.state}&error=access_denied&error_description=Kullan%C4%B1c%C4%B1+reddetti")
    assert response.status_code == 400
    assert "Kullanıcı reddetti" in response.get_data(as_text=True)


def test_dropbox_callback_success_page(dropbox_app, monkeypatch, tmp_path):
    ops, client, module = dropbox_app
    monkeypatch.setattr(ops, "TOKEN_FILE", str(tmp_path / "dropbox.json"))
    monkeypatch.setattr(ops, "_client", lambda: object())
    monkeypatch.setattr(ops, "stop_server", lambda: None)
    monkeypatch.setattr(module.requests, "post", lambda *a, **k: SimpleNamespace(json=lambda: {"access_token": "a", "refresh_token": "r"}))
    response = client.get(f"/oauth2/callback?state={ops.state}&code=abc")
    assert response.status_code == 200
    assert "Dropbox bağlantısı tamamlandı" in response.get_data(as_text=True)
    assert response.headers["Cache-Control"] == "no-store"


def test_dropbox_callback_shows_network_error(dropbox_app, monkeypatch):
    ops, client, module = dropbox_app

    def boom(*_a, **_k):
        raise module.requests.ConnectionError("ağ yok")

    monkeypatch.setattr(module.requests, "post", boom)
    response = client.get(f"/oauth2/callback?state={ops.state}&code=abc")
    assert response.status_code == 502
    assert "ağ yok" in response.get_data(as_text=True)


# ---------------------------------------------------------------- OneDrive yönlendirme adresi

class _FakePCA:
    def __init__(self, result):
        self.result = result
        self.kwargs = None

    def get_accounts(self):
        return []

    def acquire_token_interactive(self, **kwargs):
        self.kwargs = kwargs
        return self.result


def _onedrive(monkeypatch, tmp_path, result, port=None):
    from providers import onedrive

    fake = _FakePCA(result)
    monkeypatch.setattr(onedrive.msal, "PublicClientApplication", lambda *a, **k: fake)
    try:
        service = onedrive.OneDriveService(client_id="abc", token_file=str(tmp_path / "t.json"), redirect_port=port)
    except RuntimeError as exc:
        return fake, exc
    return fake, service


def test_onedrive_uses_random_port_by_default(monkeypatch, tmp_path):
    fake, service = _onedrive(monkeypatch, tmp_path, {"access_token": "t"})
    assert "port" not in fake.kwargs
    assert service.access_token  # bağlandı


def test_onedrive_uses_fixed_port_when_configured(monkeypatch, tmp_path):
    fake, _ = _onedrive(monkeypatch, tmp_path, {"access_token": "t"}, port=8400)
    assert fake.kwargs["port"] == 8400


def test_onedrive_failure_explains_redirect_registration(monkeypatch, tmp_path):
    _, error = _onedrive(monkeypatch, tmp_path, {"error": "invalid_request"}, port=8400)
    message = str(error)
    assert "http://localhost:8400" in message
    assert "Mobil ve masaüstü uygulamaları" in message


def test_onedrive_denied_access_has_no_redirect_hint(monkeypatch, tmp_path):
    _, error = _onedrive(monkeypatch, tmp_path, {"error": "access_denied", "error_description": "Kullanıcı reddetti"})
    assert "Kullanıcı reddetti" in str(error) and "redirect_uri" not in str(error)


def test_redirect_port_parsing():
    from config import _port

    assert _port("8400") == 8400
    assert _port("") is None and _port("abc") is None and _port("70000") is None
