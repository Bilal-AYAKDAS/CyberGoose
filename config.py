import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def env(name, default=None, required=False):
    value = os.getenv(name, default)
    if required and not value:
        raise RuntimeError(f"Required environment variable is missing: {name}")
    return value


DROPBOX_APP_KEY = env("DROPBOX_APP_KEY", "")
DROPBOX_APP_SECRET = env("DROPBOX_APP_SECRET", "")
DROPBOX_REDIRECT_URI = env(
    "DROPBOX_REDIRECT_URI",
    "http://localhost:5000/oauth2/callback",
)
DROPBOX_TOKEN_FILE = env("DROPBOX_TOKEN_FILE", "dropboxtoken.json")
GOOGLE_CLIENT_SECRETS_FILE = env(
    "GOOGLE_CLIENT_SECRETS_FILE",
    "credentials.json",
)
GOOGLE_TOKEN_FILE = env("GOOGLE_TOKEN_FILE", "token.json")
FLASK_HOST = env("FLASK_HOST", "127.0.0.1")
FLASK_PORT = int(env("FLASK_PORT", "5502"))
FLASK_DEBUG = env("FLASK_DEBUG", "false").lower() == "true"
