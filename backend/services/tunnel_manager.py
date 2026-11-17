"""SSH yerel port yönlendirme (Port Forwarding / Tünel) yöneticisi."""
from __future__ import annotations

import select
import socket
import threading
import uuid
from dataclasses import dataclass, field

import file_service as files


@dataclass
class TunnelEntry:
    id: str
    local_port: int
    remote_host: str
    remote_port: int
    server_socket: socket.socket
    stop_event: threading.Event = field(default_factory=threading.Event)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "localPort": self.local_port,
            "remoteHost": self.remote_host,
            "remotePort": self.remote_port,
        }


def _forward_pair(sock_a: socket.socket, chan) -> None:
    try:
        while True:
            r, _, _ = select.select([sock_a, chan], [], [], 0.5)
            if sock_a in r:
                data = sock_a.recv(4096)
                if not data:
                    break
                chan.sendall(data)
            if chan in r:
                data = chan.recv(4096)
                if not data:
                    break
                sock_a.sendall(data)
    except Exception:
        pass
    finally:
        try:
            chan.close()
        except Exception:
            pass
        try:
            sock_a.close()
        except Exception:
            pass


class TunnelManager:
    def __init__(self, session_manager):
        self._sessions = session_manager
        self._tunnels: dict[str, TunnelEntry] = {}
        self._lock = threading.Lock()

    def list(self) -> list[dict]:
        with self._lock:
            return [entry.to_dict() for entry in self._tunnels.values()]

    def open(self, local_port: int, remote_host: str, remote_port: int) -> dict:
        with self._sessions.lock:
            conn = self._sessions.state.connection
            if conn is None or self._sessions.state.type != "SFTP" or getattr(conn, "client", None) is None:
                raise files.FileServiceError("SSH tüneli için etkin bir SFTP bağlantısı gerekli.", 409, "sftp_required")
            transport = conn.client.get_transport()
            if transport is None or not transport.is_active():
                raise files.FileServiceError("SSH transport etkin değil.", 409, "sftp_required")

        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            # Windows'ta SO_REUSEADDR başka bir programın dinlediği portu da paylaştırır; tünel
            # sessizce o programla yarışırdı. Özel kullanım, dolu portta açık bir hata verir.
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            srv.bind(("127.0.0.1", local_port))
            srv.listen(16)
            srv.settimeout(0.5)
        except OSError as exc:
            srv.close()
            raise files.FileServiceError(
                f"Yerel port {local_port} açılamadı; başka bir program kullanıyor olabilir ({exc.strerror or exc}).",
                409, "port_in_use",
            ) from exc

        actual_port = srv.getsockname()[1]
        entry = TunnelEntry(
            id=str(uuid.uuid4()),
            local_port=actual_port,
            remote_host=remote_host,
            remote_port=remote_port,
            server_socket=srv,
        )

        def accept_loop() -> None:
            while not entry.stop_event.is_set():
                try:
                    client_sock, client_addr = srv.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                try:
                    chan = transport.open_channel("direct-tcpip", (remote_host, remote_port), client_addr)
                except Exception:
                    client_sock.close()
                    continue
                threading.Thread(target=_forward_pair, args=(client_sock, chan), daemon=True).start()

        with self._lock:
            self._tunnels[entry.id] = entry
        threading.Thread(target=accept_loop, daemon=True).start()
        return entry.to_dict()

    def close(self, tunnel_id: str) -> bool:
        with self._lock:
            entry = self._tunnels.pop(tunnel_id, None)
        if entry is None:
            return False
        entry.stop_event.set()
        try:
            entry.server_socket.close()
        except Exception:
            pass
        return True

    def close_all(self) -> None:
        with self._lock:
            ids = list(self._tunnels.keys())
        for tid in ids:
            self.close(tid)
