import os
import sys
import tempfile
import threading
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Testler gerçek veritabanına ve token dosyalarına dokunmasın.
os.environ["CYBERGOOSE_DATA_DIR"] = tempfile.mkdtemp(prefix="cybergoose-test-")
os.environ.pop("CYBERGOOSE_API_TOKEN", None)


@pytest.fixture()
def client():
    import app as backend

    backend.app.config["TESTING"] = True
    with backend.app.test_client() as test_client:
        yield test_client
    with backend.state_lock:
        backend._close_current()


@pytest.fixture(scope="session")
def ftp_server(tmp_path_factory):
    """Gerçek bir FTP sunucusu (pyftpdlib) başlatır: kullanıcı `demo`, parola `password`."""
    pyftpdlib = pytest.importorskip("pyftpdlib")  # noqa: F841
    from pyftpdlib.authorizers import DummyAuthorizer
    from pyftpdlib.handlers import FTPHandler
    from pyftpdlib.ioloop import IOLoop
    from pyftpdlib.servers import ThreadedFTPServer

    root = tmp_path_factory.mktemp("ftp") / "ftp-root"
    (root / "pub").mkdir(parents=True)
    (root / "readme.txt").write_text("Merhaba FTP\n", encoding="utf-8")

    authorizer = DummyAuthorizer()
    authorizer.add_user("demo", "password", str(root), perm="elradfmwMT")
    handler = type("Handler", (FTPHandler,), {"authorizer": authorizer, "passive_ports": range(60000, 60100), "auth_failed_timeout": 0})
    # Her test kendi IOLoop'unu kullanır; varsayılan tekil döngü kapatılınca sonraki sunucu çalışmaz.
    server = ThreadedFTPServer(("127.0.0.1", 0), handler, ioloop=IOLoop())
    thread = threading.Thread(target=server.serve_forever, kwargs={"timeout": 0.2}, daemon=True)
    thread.start()
    yield {"port": server.address[1], "root": root}
    server.close_all()
