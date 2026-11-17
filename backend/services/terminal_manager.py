"""SSH etkileşimli terminal oturumları (xterm.js ↔ WebSocket ↔ paramiko kanalı)."""
from __future__ import annotations

import codecs
import json
import threading
import uuid
from dataclasses import dataclass

import file_service as files

MIN_COLS, MAX_COLS = 20, 500
MIN_ROWS, MAX_ROWS = 5, 200


def clamp_size(cols, rows) -> tuple[int, int]:
    """İstemciden gelen terminal boyutunu doğrular; geçersiz değerde varsayılana döner."""
    try:
        cols = int(cols or 80)
        rows = int(rows or 24)
    except (TypeError, ValueError):
        raise files.FileServiceError("Terminal boyutu sayı olmalı", 400)
    return max(MIN_COLS, min(MAX_COLS, cols)), max(MIN_ROWS, min(MAX_ROWS, rows))


@dataclass
class TerminalSession:
    id: str
    channel: object
    owned_client: object = None
    closed: bool = False


class TerminalManager:
    def __init__(self, session_manager):
        self._sessions = session_manager
        self._terminals: dict[str, TerminalSession] = {}
        self._lock = threading.Lock()

    def open_from_session(self, cols: int = 80, rows: int = 24) -> TerminalSession:
        cols, rows = clamp_size(cols, rows)
        with self._sessions.lock:
            conn = self._sessions.state.connection
            conn_type = self._sessions.state.type
            if conn is None or conn_type != "SFTP" or getattr(conn, "client", None) is None:
                raise files.FileServiceError("Terminal açmak için etkin bir SFTP bağlantısı gerekli.", 409, "sftp_required")
            try:
                channel = conn.client.invoke_shell(term="xterm-256color", width=cols, height=rows)
            except Exception as exc:
                raise files.FileServiceError(f"SSH kabuğu açılamadı: {exc}", 502, type(exc).__name__) from exc

        term = TerminalSession(id=str(uuid.uuid4()), channel=channel)
        with self._lock:
            self._terminals[term.id] = term
        return term

    def open_direct(
        self,
        host: str,
        port: int,
        username: str,
        password: str | None = None,
        key_path: str | None = None,
        cols: int = 80,
        rows: int = 24,
        trusted_fingerprint: str | None = None,
        passphrase: str | None = None,
        use_agent: bool = False,
    ) -> TerminalSession:
        cols, rows = clamp_size(cols, rows)
        conn = self._sessions.connect_server(
            "SFTP", host, port, username, password, key_path=key_path, trusted_fingerprint=trusted_fingerprint,
            passphrase=passphrase, use_agent=use_agent,
        )
        try:
            channel = conn.client.invoke_shell(term="xterm-256color", width=cols, height=rows)
        except Exception as exc:
            conn.close()
            raise files.FileServiceError(f"SSH kabuğu açılamadı: {exc}", 502, type(exc).__name__) from exc

        term = TerminalSession(id=str(uuid.uuid4()), channel=channel, owned_client=conn)
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
        if term.owned_client is not None:
            try:
                term.owned_client.close()
            except Exception:
                pass
        return True

    def close_session_terminals(self) -> None:
        with self._lock:
            session_ids = [tid for tid, term in self._terminals.items() if term.owned_client is None]
        for tid in session_ids:
            self.close(tid)

    def attach_websocket(self, ws, terminal_id: str) -> None:
        term = self.get(terminal_id)
        if term is None:
            ws.send(json.dumps({"type": "error", "data": "Terminal oturumu bulunamadı"}))
            return

        stop_event = threading.Event()
        # Çok baytlı UTF-8 karakter (ör. "ğ", emoji) iki okuma arasında bölünebilir; artımlı
        # çözücü yarım baytları bir sonraki parçaya saklar, ekranda "�" görünmez.
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

        def pump_output() -> None:
            try:
                while not stop_event.is_set() and not term.closed:
                    if term.channel.exit_status_ready() and not term.channel.recv_ready():
                        break
                    data = term.channel.recv(4096)
                    if not data:
                        break
                    text = decoder.decode(data)
                    if text:
                        ws.send(json.dumps({"type": "output", "data": text}))
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
                    try:
                        cols, rows = clamp_size(msg.get("cols"), msg.get("rows"))
                    except files.FileServiceError:
                        continue
                    term.channel.resize_pty(width=cols, height=rows)
        except Exception:
            pass
        finally:
            stop_event.set()
            self.close(terminal_id)
