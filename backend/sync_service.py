"""Klasör karşılaştırma (eşitleme planı) ve alt klasörlerde arama.

Karşılaştırma iki tarafın dosya listesini (`plan_local_folder` / `plan_remote_folder`)
göreli yola göre eşler. Dosyalar boyuta göre "aynı" ya da "farklı" sayılır; değiştirilme
zamanı yalnızca hangi tarafın daha yeni olduğunu söylemek için kullanılır (sunucu saat
dilimleri farklı olabileceğinden tek başına fark ölçütü değildir).

Saat dilimi: FTP `LIST` yanıtındaki tarih sunucunun yerel saatidir ve uygulama bunu bilemez.
Bu yüzden karşılaştırma sunucu ile bilgisayar arasındaki saat farkını (`timeOffsetMinutes`)
alır. Verilmezse aynı boyuttaki dosyaların tarih farklarından tahmin edilir: dosyaların
çoğunluğu aynı tam çeyrek saatlik farkla kaymışsa bu bir saat dilimi farkıdır.
"""
from __future__ import annotations

import os
import posixpath
from collections import Counter
from datetime import datetime
from pathlib import Path

import file_service as files

# Saat farkı/yuvarlama (FAT, FTP dakika hassasiyeti) için tolerans.
MTIME_TOLERANCE_SECONDS = 2
MAX_SEARCH_RESULTS = 1000
MAX_SEARCH_SCANNED = 50_000


def _key(item: dict) -> str:
    return f"{item['relativeDir']}/{item['name']}" if item["relativeDir"] else item["name"]


# Otomatik tahmin için en az bu kadar eşleşen dosya ve bu oranda çoğunluk gerekir.
MIN_OFFSET_SAMPLES = 3
MIN_OFFSET_SHARE = 0.6
MAX_OFFSET_MINUTES = 14 * 60


def _delta(local_mod: str | None, remote_mod: str | None) -> float | None:
    """Yerel - uzak tarih farkı (saniye); tarihlerden biri yoksa None."""
    if not local_mod or not remote_mod:
        return None
    try:
        return (datetime.fromisoformat(local_mod) - datetime.fromisoformat(remote_mod)).total_seconds()
    except ValueError:
        return None


def _newer(local_mod: str | None, remote_mod: str | None, offset_minutes: int = 0, tolerance: float = MTIME_TOLERANCE_SECONDS) -> str | None:
    """Hangi taraf daha yeni? `offset_minutes`: sunucu saatinin bilgisayardan ne kadar ileride olduğu."""
    delta = _delta(local_mod, remote_mod)
    if delta is None:
        return None
    delta += offset_minutes * 60
    if abs(delta) <= tolerance:
        return None
    return "local" if delta > 0 else "remote"


def _tolerance(local: dict, remote: dict) -> float:
    """Tarih karşılaştırma toleransı: FTP LIST tarihleri yalnız dakika/gün hassasiyetindedir."""
    return max(MTIME_TOLERANCE_SECONDS, local.get("mtimePrecision") or 0, remote.get("mtimePrecision") or 0)


def detect_offset(pairs: list[tuple[dict, dict]]) -> int:
    """Aynı boyuttaki dosya çiftlerinden sunucu saat farkını (dakika) tahmin eder; bulunamazsa 0.

    Gerçekten değişmiş dosyalar rastgele farklar verir; saat dilimi kayması ise hepsinde aynı
    tam çeyrek saattir. Çoğunluk aynı farkı göstermiyorsa tahmin yapılmaz.
    """
    buckets = Counter()
    samples = 0
    for local, remote in pairs:
        delta = _delta(local.get("modified"), remote.get("modified"))
        if delta is None:
            continue
        samples += 1
        quarters = round(-delta / 900)
        tolerance = _tolerance(local, remote)
        if tolerance < 900 and abs(-delta - quarters * 900) <= max(tolerance, 60):
            buckets[quarters * 15] += 1
    if samples < MIN_OFFSET_SAMPLES or not buckets:
        return 0
    minutes, count = buckets.most_common(1)[0]
    if minutes == 0 or abs(minutes) > MAX_OFFSET_MINUTES or count < samples * MIN_OFFSET_SHARE:
        return 0
    return minutes


def compare_plans(local_plan: dict, remote_plan: dict, time_offset_minutes: int | None = None) -> dict:
    """İki dosya listesini karşılaştırır.

    Dönen her öğe: {relativeDir, name, status, localSize, remoteSize, localModified,
    remoteModified, newer}. status: onlyLocal | onlyRemote | different | same.

    `time_offset_minutes` None ise saat farkı tahmin edilir; sonuçta `timeOffsetMinutes` ve
    `timeOffsetDetected` döner.
    """
    local_items = {_key(item): item for item in local_plan["files"]}
    remote_items = {_key(item): item for item in remote_plan["files"]}
    detected = time_offset_minutes is None
    if detected:
        same_size = [
            (local_items[key], remote_items[key]) for key in set(local_items) & set(remote_items)
            if local_items[key]["size"] is not None and local_items[key]["size"] == remote_items[key]["size"]
        ]
        time_offset_minutes = detect_offset(same_size)
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
            "newer": _newer(
                local.get("modified"), remote.get("modified"), time_offset_minutes,
                _tolerance(local, remote),
            ) if local and remote else None,
        })
    summary = {name: sum(1 for row in rows if row["status"] == name) for name in ("onlyLocal", "onlyRemote", "different", "same")}
    return {"items": rows, "summary": summary, "timeOffsetMinutes": time_offset_minutes, "timeOffsetDetected": detected and time_offset_minutes != 0}


def parse_offset(value) -> int | None:
    """API'den gelen saat farkı: boş/"auto" → None (tahmin et), aksi halde ±14 saat içinde dakika."""
    if value is None or value == "" or value == "auto":
        return None
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise files.FileServiceError("Saat farkı dakika cinsinden bir sayı olmalı", 400)
    if abs(minutes) > MAX_OFFSET_MINUTES:
        raise files.FileServiceError("Saat farkı en fazla ±14 saat olabilir", 400)
    return minutes


def compare_folders(local_path: str, remote_plan_fn, time_offset_minutes: int | None = None, left_plan_fn=None) -> dict:
    """`remote_plan_fn()` uzak listeyi aktarım bağlantısıyla getirir (panel kilitlenmez).

    `left_plan_fn` verilirse sol taraf da uzak bir oturumdur (yerel disk okunmaz).
    """
    local_plan = left_plan_fn() if left_plan_fn else files.plan_local_folder(local_path)
    remote_plan = remote_plan_fn()
    result = compare_plans(local_plan, remote_plan, time_offset_minutes)
    left = local_plan.get("path") if left_plan_fn else str(Path(local_path))
    result.update({"localPath": left, "remotePath": remote_plan.get("path")})
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
