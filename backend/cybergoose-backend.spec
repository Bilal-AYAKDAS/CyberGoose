# -*- mode: python ; coding: utf-8 -*-
# Yerel API'yi tek klasörlük (onedir) bir çalıştırılabilir dosyaya paketler.
# Electron bu klasörü exe'nin içine gömer (package.json > build.extraResources).
# onedir seçildi: onefile her açılışta geçici klasöre açılır, daha yavaş başlar ve
# kapatılırken arkada süreç bırakabilir.
#
# Çalıştırma (kök klasörden):  npm run build:backend
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

datas = []
datas += collect_data_files("dropbox")          # Dropbox sertifika dosyası
datas += collect_data_files("certifi")

hiddenimports = []
hiddenimports += collect_submodules("providers")  # sağlayıcılar route içinde geç yüklenir
hiddenimports += collect_submodules("services")
hiddenimports += collect_submodules("keyring.backends")
hiddenimports += ["waitress", "msal", "flask_sock", "simple_websocket", "wsproto"]

a = Analysis(
    ["app.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "pyftpdlib"],
    noarchive=False,
)

# googleapiclient ~600 discovery belgesi taşır (~110 MB); yalnızca Drive v3 gerekli.
DOCS = "googleapiclient/discovery_cache/documents/"
a.datas = [
    entry for entry in a.datas
    if not entry[0].replace("\\", "/").startswith(DOCS) or entry[0].endswith("drive.v3.json")
]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="cybergoose-backend",
    debug=False,
    strip=False,
    upx=False,
    console=False,  # Electron arka planda başlatır; konsol penceresi açılmaz.
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="cybergoose-backend",
)
