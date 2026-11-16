"""Microsoft OneDrive OAuth (MSAL) ve Graph API istemcisi."""
from __future__ import annotations

import os
import msal
import requests

from config import ONEDRIVE_CLIENT_ID, ONEDRIVE_TOKEN_FILE

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
ONEDRIVE_SCOPES = ["Files.ReadWrite.All"]


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
        self.session = requests.Session()
        self.onedrive = True
        self._authenticate()

    def _save_cache(self) -> None:
        if self.cache.has_state_changed:
            with open(self.token_file, "w", encoding="utf-8") as handle:
                handle.write(self.cache.serialize())

    def _authenticate(self) -> None:
        result = None
        accounts = self.pca.get_accounts()
        if accounts:
            result = self.pca.acquire_token_silent(ONEDRIVE_SCOPES, account=accounts[0])
        if not result or "access_token" not in result:
            result = self.pca.acquire_token_interactive(scopes=ONEDRIVE_SCOPES, timeout=120)
        if not result or "access_token" not in result:
            detail = result.get("error_description") if isinstance(result, dict) else "Bilinmeyen OAuth hatası"
            raise RuntimeError(f"OneDrive yetkilendirmesi başarısız: {detail}")
        self._save_cache()
        self.session.headers.update({"Authorization": f"Bearer {result['access_token']}"})

    def close(self) -> None:
        self.session.close()
