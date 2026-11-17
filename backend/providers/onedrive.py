"""Microsoft OneDrive OAuth (MSAL) ve Graph API istemcisi."""
from __future__ import annotations

import os
import threading

import msal
import requests

from config import ONEDRIVE_CLIENT_ID, ONEDRIVE_TOKEN_FILE
from oauth_pages import render_oauth_page

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
ONEDRIVE_SCOPES = ["Files.ReadWrite.All"]


ONEDRIVE_SUCCESS_PAGE = render_oauth_page("OneDrive", True)
ONEDRIVE_ERROR_PAGE = render_oauth_page("OneDrive", False, "OneDrive izni verilmedi.", "$error $error_description")


class _RefreshingAuth(requests.auth.AuthBase):
    """Her istekte geçerli erişim belirtecini ekler.

    Graph erişim belirteci yaklaşık bir saatte dolar. MSAL `acquire_token_silent` önbellekteki
    belirteci döndürür, süresi dolmak üzereyse yenileme belirteciyle sessizce yeniler. Böylece
    uzun açık kalan oturumda bir saat sonra her istek 401 almaz.
    """

    def __init__(self, service: "OneDriveService"):
        self.service = service

    def __call__(self, request):
        request.headers["Authorization"] = f"Bearer {self.service.access_token()}"
        return request


class OneDriveService:
    """MSAL ile etkileşimli/önbellekli OAuth oturumu ve Graph API HTTP oturumu."""

    def __init__(self, client_id: str = ONEDRIVE_CLIENT_ID, token_file: str = ONEDRIVE_TOKEN_FILE):
        if not client_id:
            raise ValueError("OneDrive için .env dosyasında ONEDRIVE_CLIENT_ID gerekli")
        self.client_id = client_id
        self.token_file = token_file
        self.cache = msal.SerializableTokenCache()
        if os.path.exists(self.token_file):
            try:
                with open(self.token_file, "r", encoding="utf-8") as handle:
                    self.cache.deserialize(handle.read())
            except OSError:
                pass

        self.pca = msal.PublicClientApplication(
            self.client_id,
            authority="https://login.microsoftonline.com/common",
            token_cache=self.cache,
        )
        self._lock = threading.Lock()
        self._account = None
        self._token = None
        self.session = requests.Session()
        self.session.auth = _RefreshingAuth(self)
        self.onedrive = True
        self._authenticate()

    def _save_cache(self) -> None:
        if self.cache.has_state_changed:
            try:
                with open(self.token_file, "w", encoding="utf-8") as handle:
                    handle.write(self.cache.serialize())
            except OSError:
                pass
            self.cache.has_state_changed = False

    def _authenticate(self) -> None:
        result = None
        accounts = self.pca.get_accounts()
        if accounts:
            result = self.pca.acquire_token_silent(ONEDRIVE_SCOPES, account=accounts[0])
        if not result or "access_token" not in result:
            result = self.pca.acquire_token_interactive(
                scopes=ONEDRIVE_SCOPES,
                timeout=120,
                # MSAL tarayıcıda gösterilecek sayfayı string.Template olarak alır ($error alanları kaçışlanır).
                success_template=ONEDRIVE_SUCCESS_PAGE,
                error_template=ONEDRIVE_ERROR_PAGE,
            )
        if not result or "access_token" not in result:
            detail = result.get("error_description") if isinstance(result, dict) else "Bilinmeyen OAuth hatası"
            raise RuntimeError(f"OneDrive yetkilendirmesi başarısız: {detail}")
        self._save_cache()
        self._token = result["access_token"]
        accounts = self.pca.get_accounts()
        self._account = accounts[0] if accounts else None

    def access_token(self) -> str:
        """Geçerli erişim belirteci; süresi dolduysa sessizce yenilenir (tarayıcı açılmaz)."""
        with self._lock:
            if self._account is not None:
                result = self.pca.acquire_token_silent(ONEDRIVE_SCOPES, account=self._account)
                if result and "access_token" in result:
                    self._token = result["access_token"]
                    self._save_cache()
            # Yenilenemediyse eski belirteç gönderilir; Graph 401 döner ve arayüz "yeniden bağlanın" der.
            return self._token or ""

    def close(self) -> None:
        self.session.close()
