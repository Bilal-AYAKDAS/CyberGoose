"""Klasör karşılaştırma (eşitleme planı) ve alt klasörlerde arama.

Karşılaştırma iki tarafın dosya listesini (`plan_local_folder` / `plan_remote_folder`)
göreli yola göre eşler. Dosyalar boyuta göre "aynı" ya da "farklı" sayılır; değiştirilme
zamanı yalnızca hangi tarafın daha yeni olduğunu söylemek için kullanılır (sunucu saat
dilimleri farklı olabileceğinden tek başına fark ölçütü değildir).
"""
from __future__ import annotations

import os
import posixpath
from datetime import datetime
from pathlib import Path

import file_service as files

# Saat farkı/yuvarlama (FAT, FTP dakika hassasiyeti) için tolerans.
MTIME_TOLERANCE_SECONDS = 2
MAX_SEARCH_RESULTS = 1000
MAX_SEARCH_SCANNED = 50_000


def _key(item: dict) -> str:
    return f"{item['relativeDir']}/{item['name']}" if item["relativeDir"] else item["name"]


def _newer(local_mod: str | None, remote_mod: str | None) -> str | None:
    if not local_mod or not remote_mod:
        return None
    try:
        delta = (datetime.fromisoformat(local_mod) - datetime.fromisoformat(remote_mod)).total_seconds()
    except ValueError:
        return None
    if abs(delta) <= MTIME_TOLERANCE_SECONDS:
        return None
    return "local" if delta > 0 else "remote"


def compare_plans(local_plan: dict, remote_plan: dict) -> dict:
    """İki dosya listesini karşılaştırır.

    Dönen her öğe: {relativeDir, name, status, localSize, remoteSize, localModified,
    remoteModified, newer}. status: onlyLocal | onlyRemote | different | same.
    """
    local_items = {_key(item): item for item in local_plan["files"]}
    remote_items = {_key(item): item for item in remote_plan["files"]}
    rows = []
    for key in sorted(set(local_items) | set(remote_items), key=str.lower):
        local, remote = local_items.get(key), remote_items.get(key)
        base = local or remote
        if local and not remote:
            status = "onlyLocal"
        elif remote and not local:
            status = "onlyRemote"
        elif local["size"] is not None and remote["size"] is not None and local["size"] != remote["size"]:
            status = "different"
        else:
            status = "same"
        rows.append({
            "relativeDir": base["relativeDir"],
            "name": base["name"],
            "status": status,
            "localSize": local["size"] if local else None,
            "remoteSize": remote["size"] if remote else None,
            "localModified": local.get("modified") if local else None,
            "remoteModified": remote.get("modified") if remote else None,
            "newer": _newer(local.get("modified"), remote.get("modified")) if local and remote else None,
        })
    summary = {name: sum(1 for row in rows if row["status"] == name) for name in ("onlyLocal", "onlyRemote", "different", "same")}
    return {"items": rows, "summary": summary}


def compare_folders(local_path: str, remote_plan_fn) -> dict:
    """`remote_plan_fn()` uzak listeyi aktarım bağlantısıyla getirir (panel kilitlenmez)."""
    local_plan = files.plan_local_folder(local_path)
    remote_plan = remote_plan_fn()
    result = compare_plans(local_plan, remote_plan)
    result.update({"localPath": str(Path(local_path)), "remotePath": remote_plan.get("path")})
    return result


# ---------------------------------------------------------------- arama

def _matcher(query: str):
    needle = query.strip().casefold()
    if not needle:
        raise files.FileServiceError("Aranacak metin gerekli", 400)
    return lambda name: needle in name.casefold()


def search_local(root: str, query: str) -> dict:
    matches = _matcher(query)
    base = Path(root)
    if not base.is_dir():
        raise files.FileServiceError("Klasör bulunamadı", 404)
    results, scanned, truncated = [], 0, False
    for current, dirs, filenames in os.walk(base):
        dirs.sort(key=str.lower)
        for kind, names in (("folder", dirs), ("file", sorted(filenames, key=str.lower))):
            for name in names:
                scanned += 1
                if matches(name):
                    path = Path(current) / name
                    size = None
                    modified = None
                    if kind == "file":
                        try:
                            info = path.stat()
                            size, modified = info.st_size, files._iso(info.st_mtime)
                        except OSError:
                            pass
                    results.append({"name": name, "kind": kind, "path": str(path), "parent": current, "size": size, "modified": modified})
                if len(results) >= MAX_SEARCH_RESULTS or scanned >= MAX_SEARCH_SCANNED:
                    truncated = True
                    break
            if truncated:
                break
        if truncated:
            break
    return {"results": results, "truncated": truncated, "scanned": scanned}


def search_remote(conn, root: str, query: str) -> dict:
    matches = _matcher(query)
    pending = [files.normalize_remote(root)]
    results, scanned, truncated = [], 0, False
    while pending and not truncated:
        current = pending.pop(0)
        try:
            listing = files.list_remote(conn, current)
        except files.FileServiceError as exc:
            # Başlangıç klasörü ya da oturum hatası gerçek hatadır; okunamayan alt klasör atlanır.
            if scanned == 0 or exc.status == 401:
                raise
            continue  # Okunamayan alt klasör aramayı durdurmaz.
        for entry in sorted(listing["entries"], key=lambda item: item["name"].lower()):
            scanned += 1
            if entry["kind"] == "folder":
                pending.append(entry["path"])
            if matches(entry["name"]):
                results.append({
                    "name": entry["name"], "kind": entry["kind"], "path": entry["path"],
                    "parent": posixpath.dirname(entry["path"]) or "/", "size": entry["size"], "modified": entry.get("modified"),
                })
            if len(results) >= MAX_SEARCH_RESULTS or scanned >= MAX_SEARCH_SCANNED:
                truncated = True
                break
    return {"results": results, "truncated": truncated, "scanned": scanned}
