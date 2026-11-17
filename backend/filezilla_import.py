"""FileZilla Site Yöneticisi (sitemanager.xml) içe aktarımı.

FileZilla'da: Dosya > Dışa aktar ya da `%APPDATA%\\FileZilla\\sitemanager.xml`. Klasörler
bağlantı grubu olur ("Müşteriler/ACME"). Parolalar FileZilla ana parolasıyla şifrelenmişse
aktarılmaz; bağlanırken sorulur.
"""
from __future__ import annotations

import base64
import binascii
import xml.etree.ElementTree as ET

import file_service as files

MAX_XML_BYTES = 5 * 1024 * 1024
MAX_SITES = 2000

# FileZilla Protocol değeri → CyberGoose türü (None: desteklenmiyor).
PROTOCOLS = {"0": "FTP", "1": "SFTP", "3": "FTPS", "4": "FTPS", "6": "FTP"}
DEFAULT_PORTS = {"FTP": 21, "FTPS": 21, "SFTP": 22}


def _text(node, tag: str) -> str:
    child = node.find(tag)
    return (child.text or "").strip() if child is not None and child.text else ""


def _password(server, name: str, warnings: list[str]) -> str | None:
    node = server.find("Pass")
    if node is None or not (node.text or "").strip():
        return None
    encoding = (node.get("encoding") or "").lower()
    if encoding == "base64":
        try:
            return base64.b64decode(node.text.strip(), validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            warnings.append(f"{name}: parola okunamadı, bağlanırken sorulacak.")
            return None
    if encoding == "crypt":
        warnings.append(f"{name}: parola FileZilla ana parolasıyla şifreli, bağlanırken sorulacak.")
        return None
    return node.text.strip()


def parse_sitemanager(xml_text: str) -> tuple[list[dict], list[str]]:
    if len(xml_text.encode("utf-8")) > MAX_XML_BYTES:
        raise files.FileServiceError("Dosya çok büyük (en fazla 5 MB)", 400)
    if "<!ENTITY" in xml_text or "<!DOCTYPE" in xml_text:
        # Varlık genişletme saldırılarına karşı: FileZilla dosyalarında DOCTYPE yoktur.
        raise files.FileServiceError("Desteklenmeyen XML (DOCTYPE içeriyor)", 400)
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise files.FileServiceError(f"FileZilla dosyası okunamadı: {exc}", 400) from exc
    servers_root = root.find("Servers") if root.tag == "FileZilla3" else None
    if servers_root is None:
        raise files.FileServiceError("Bu bir FileZilla Site Yöneticisi dosyası değil (FileZilla3/Servers bulunamadı)", 400)

    sites: list[dict] = []
    warnings: list[str] = []

    def walk(node, group: list[str]) -> None:
        for child in node:
            if len(sites) >= MAX_SITES:
                return
            if child.tag == "Folder":
                folder_name = (child.text or "").strip() or "Klasör"
                walk(child, [*group, folder_name])
            elif child.tag == "Server":
                name = _text(child, "Name") or _text(child, "Host") or "FileZilla sunucusu"
                protocol = PROTOCOLS.get(_text(child, "Protocol") or "0")
                if protocol is None:
                    warnings.append(f"{name}: bu protokol desteklenmiyor, atlandı.")
                    continue
                host = _text(child, "Host")
                if not host:
                    warnings.append(f"{name}: sunucu adresi yok, atlandı.")
                    continue
                if _text(child, "Protocol") == "3":
                    warnings.append(f"{name}: örtük (implicit) FTPS desteklenmiyor; açık FTPS olarak eklendi.")
                port_text = _text(child, "Port")
                port = int(port_text) if port_text.isdigit() and 1 <= int(port_text) <= 65535 else DEFAULT_PORTS[protocol]
                username = _text(child, "User") or "anonymous"
                logon = _text(child, "Logontype")
                password = None if logon in ("2", "3") else _password(child, name, warnings)  # 2: sor, 3: etkileşimli
                key_path = _text(child, "Keyfile") if protocol == "SFTP" else ""
                sites.append({
                    "name": name[:120],
                    "type": protocol,
                    "host": host,
                    "port": port,
                    "username": username,
                    "password": password,
                    "keyPath": key_path or None,
                    "group": "/".join(group)[:60] or None,
                })

    walk(servers_root, [])
    if not sites and not warnings:
        warnings.append("Dosyada sunucu bulunamadı.")
    return sites, warnings
