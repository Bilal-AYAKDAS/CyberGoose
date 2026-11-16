"""SSH interaktif terminal oturum yönetimi (PuTTY benzeri kabuk)."""
from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass

import file_service as files


@dataclass
class TerminalSession:
    id: str
    channel: object
    closed: bool = False


class TerminalManager:
    def __init__(self, session_manager):
        self._sessions = session_manager
        self._terminals: dict[str, TerminalSession] = {}
        self._lock = threading.Lock()

    def open_from_session(self, cols: int = 80, rows: int = 24) -> TerminalSession:
        with self._sessions.lock:
            conn = self._sessions.state.connection
            conn_type = self._sessions.state.type
            if conn is None or conn_type != "SFTP" or getattr(conn, "client", None) is None:
                raise files.FileServiceError("Terminal açmak için etkin bir SFTP bağlantısı gerekli.", 409, "sftp_required")
            try:
                channel = conn.client.invoke_shell(term="xterm-256color", width=max(20, cols), height=max(5, rows))
            except Exception as exc:
                raise files.FileServiceError(f"SSH kabuğu açılamadı: {exc}", 502, type(exc).__name__) from exc

        term = TerminalSession(id=str(uuid.uuid4()), channel=channel)
        with self._lock:
            self._terminals[term.id] = term
        return term

    def get(self, terminal_id: str) -> TerminalSession | None:
        with self._lock:
            return self._terminals.get(terminal_id)

    def close(self, terminal_id: str) -> bool:
        with self._lock:
            term = self._terminals.pop(terminal_id, None)
        if term is None:
            return False
        term.closed = True
        try:
            term.channel.close()
        except Exception:
            pass
        return True

    def attach_websocket(self, ws, terminal_id: str) -> None:
        term = self.get(terminal_id)
        if term is None:
            ws.send(json.dumps({"type": "error", "data": "Terminal oturumu bulunamadı"}))
            return

        stop_event = threading.Event()

        def pump_output() -> None:
            try:
                while not stop_event.is_set() and not term.closed:
                    if term.channel.exit_status_ready() and not term.channel.recv_ready():
                        break
                    data = term.channel.recv(4096)
                    if not data:
                        break
                    ws.send(json.dumps({"type": "output", "data": data.decode("utf-8", errors="replace")}))
            except Exception:
                pass
            finally:
                stop_event.set()
                try:
                    ws.send(json.dumps({"type": "exit"}))
                except Exception:
                    pass

        reader = threading.Thread(target=pump_output, daemon=True)
        reader.start()

        try:
            while not stop_event.is_set():
                raw = ws.receive()
                if raw is None:
                    break
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                kind = msg.get("type")
                if kind == "input":
                    payload = msg.get("data")
                    if isinstance(payload, str) and payload:
                        term.channel.send(payload)
                elif kind == "resize":
                    cols = int(msg.get("cols") or 80)
                    rows = int(msg.get("rows") or 24)
                    term.channel.resize_pty(width=max(20, cols), height=max(5, rows))
        except Exception:
            pass
        finally:
            stop_event.set()
            self.close(terminal_id)
