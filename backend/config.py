"""Uygulama ayarları.

Ayarlar ortam değişkenlerinden ve `.env` dosyasından okunur. Önce veri klasöründeki `.env`,
sonra `backend/.env` yüklenir (ilk bulunan değer geçerlidir).

Veri klasörü (`CYBERGOOSE_DATA_DIR`): veritabanı, OAuth token'ları ve Google credentials
burada durur. Geliştirmede `backend/` klasörüdür; paketlenmiş uygulamada Electron bunu
`%APPDATA%/CyberGoose` olarak verir, böylece tek exe güncellense de veriler kaybolmaz.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# PyInstaller ile paketlendiğinde __file__ geçici bir klasördedir; kaynak kök yalnızca okuma içindir.
BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
DATA_DIR = Path(os.getenv("CYBERGOOSE_DATA_DIR") or Path(__file__).resolve().parent)
DATA_DIR.mkdir(parents=True, exist_ok=True)

load_dotenv(DATA_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env")


def env(name, default=None):
    return os.getenv(name, default)


def data_path(value):
    """Göreli dosya yollarını veri klasörüne göre çözer."""
    path = Path(value)
    return str(path if path.is_absolute() else DATA_DIR / path)


DB_PATH = data_path(env("CYBERGOOSE_DB", "data.db"))

DROPBOX_APP_KEY = env("DROPBOX_APP_KEY", "")
DROPBOX_APP_SECRET = env("DROPBOX_APP_SECRET", "")
DROPBOX_REDIRECT_URI = env("DROPBOX_REDIRECT_URI", "http://localhost:5000/oauth2/callback")
DROPBOX_TOKEN_FILE = data_path(env("DROPBOX_TOKEN_FILE", "dropboxtoken.json"))

GOOGLE_CLIENT_SECRETS_FILE = data_path(env("GOOGLE_CLIENT_SECRETS_FILE", "credentials.json"))
GOOGLE_TOKEN_FILE = data_path(env("GOOGLE_TOKEN_FILE", "token.json"))

FLASK_HOST = env("FLASK_HOST", "127.0.0.1")
FLASK_PORT = int(env("FLASK_PORT", "5502"))
FLASK_DEBUG = env("FLASK_DEBUG", "false").lower() == "true"

# Paketlenmiş uygulamada Electron rastgele bir anahtar verir; her istek bu anahtarı taşımalıdır.
# Böylece makinedeki başka bir program yerel API'yi kullanamaz. Boşsa kontrol yapılmaz (geliştirme).
API_TOKEN = env("CYBERGOOSE_API_TOKEN", "")
