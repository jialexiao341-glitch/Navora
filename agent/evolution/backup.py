"""File backup / rollback support for self-evolution.

Before the evolution agent edits MEMORY.md or a skill file, we snapshot the
current state into ``memory/.evolution_backups/<backup_id>/`` so a later "undo"
can restore it. File-level restore only — simple and reliable.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from common.log import logger

_BACKUP_DIRNAME = ".evolution_backups"
_MANIFEST_NAME = "manifest.json"
_BACKUP_ID_RE = re.compile(r"^\d{8}-\d{6}-\d+$")
# Keep only the most recent N backups to bound disk usage.
_MAX_BACKUPS = 10


def _backups_root(workspace_dir: Path) -> Path:
    return Path(workspace_dir) / "memory" / _BACKUP_DIRNAME


def _is_within_workspace(workspace: Path, candidate: Path) -> bool:
    """Whether ``candidate`` really lands inside ``workspace``."""
    root = os.path.realpath(workspace)
    try:
        return os.path.commonpath([root, os.path.realpath(candidate)]) == root
    except ValueError:
        return False


def _discard_incomplete(target: Path) -> None:
    """Drop a snapshot directory that never got a usable manifest. Never raises."""
    try:
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
    except OSError as e:  # pragma: no cover - rmtree already swallows most
        logger.debug(f"[Evolution] Could not remove incomplete backup: {e}")


def _parse_backup_timestamp(backup_id: str) -> str:
    """Format a backup_id like '20260607-155551-850' into '2026-06-07 15:55:51'."""
    try:
        dt = datetime.strptime(backup_id[:15], "%Y%m%d-%H%M%S")
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return backup_id


def _load_validated_entries(
    workspace_dir: Path, backup_id: str
) -> List[Tuple[str, Path, Path]]:
    """Validate ``backup_id`` and return ``(rel, bak_path, dst_path)`` tuples."""
    if not backup_id or not _BACKUP_ID_RE.match(backup_id):
        raise ValueError(f"invalid backup_id: {backup_id}")
    target = _backups_root(workspace_dir) / backup_id
    manifest_path = target / _MANIFEST_NAME
    if not manifest_path.is_file():
        raise FileNotFoundError(f"backup not found: {backup_id}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ws = Path(workspace_dir)
    # Validate the entire snapshot before reading/changing any workspace file.
    if not isinstance(manifest, list) or not manifest:
        raise ValueError("backup manifest must contain file entries")

    entries: List[Tuple[str, Path, Path]] = []
    for entry in manifest:
        if not isinstance(entry, dict) or not all(
            isinstance(entry.get(key), str) and entry[key]
            for key in ("bak", "rel")
        ):
            raise ValueError("invalid backup manifest entry")
        bak = target / entry["bak"]
        dst = ws / entry["rel"]
        # The manifest is a workspace file, so its paths are untrusted.
        if not _is_within_workspace(target, bak) or not _is_within_workspace(ws, dst):
            raise ValueError(f"backup entry escapes its directory: {entry}")
        if not bak.is_file():
            raise FileNotFoundError(f"missing backup payload: {entry['bak']}")
        entries.append((entry["rel"].replace("\\", "/"), bak, dst))
    return entries


def create_backup(workspace_dir: Path, files: List[Path]) -> Optional[str]:
    """Snapshot ``files`` (those that exist) under a new backup id.

    Returns the backup_id, or None when there is nothing to back up.
    """
    existing = [Path(f) for f in files if Path(f).exists()]
    if not existing:
        return None

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-") + f"{int(time.time() * 1000) % 1000:03d}"
    root = _backups_root(workspace_dir)
    target = None
    try:
        root.mkdir(parents=True, exist_ok=True)
        # Snapshots taken in the same millisecond must not share a directory,
        # or undoing one would restore the other's files.
        for attempt in range(100):
            backup_id = stamp + (f"{attempt:02d}" if attempt else "")
            try:
                (root / backup_id).mkdir()
            except FileExistsError:
                continue
            target = root / backup_id
            break
        else:
            raise FileExistsError(f"no free backup id for {stamp}")
        ws = Path(workspace_dir)
        manifest = []
        for idx, src in enumerate(existing):
            # Store under a flat index plus the relative path so restore knows
            # where it came from, even for nested skill files.
            try:
                rel = str(src.relative_to(ws))
            except ValueError:
                rel = src.name
            dst = target / f"{idx}.bak"
            shutil.copy2(src, dst)
            manifest.append({"rel": rel, "bak": f"{idx}.bak"})
        (target / _MANIFEST_NAME).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        _prune_old_backups(root)
        # Caller logs a combined backup+review line; keep this at debug.
        logger.debug(f"[Evolution] Created backup {backup_id} ({len(manifest)} file(s))")
        return backup_id
    except Exception as e:
        logger.warning(f"[Evolution] Failed to create backup: {e}")
        # A half-written snapshot must not take one of the _MAX_BACKUPS slots.
        if target is not None:
            _discard_incomplete(target)
        return None


def list_backups(workspace_dir: Path) -> List[Dict]:
    """List valid evolution backup snapshots (newest first) with change status."""
    root = _backups_root(workspace_dir)
    if not root.is_dir():
        return []

    dirs = sorted(
        [d for d in root.iterdir() if d.is_dir() and _BACKUP_ID_RE.match(d.name)],
        key=lambda p: p.name,
        reverse=True,
    )
    items: List[Dict] = []
    for d in dirs:
        backup_id = d.name
        try:
            entries = _load_validated_entries(workspace_dir, backup_id)
        except Exception:
            continue

        file_summaries: List[Dict] = []
        changed_count = 0
        for rel, bak, dst in entries:
            bak_bytes = bak.read_bytes()
            cur_exists = dst.is_file()
            cur_bytes = dst.read_bytes() if cur_exists else b""
            changed = (not cur_exists) or (cur_bytes != bak_bytes)
            if changed:
                changed_count += 1
            file_summaries.append({
                "rel": rel,
                "changed": changed,
                "current_exists": cur_exists,
                "backup_bytes": len(bak_bytes),
                "current_bytes": len(cur_bytes),
            })

        items.append({
            "backup_id": backup_id,
            "created_at": _parse_backup_timestamp(backup_id),
            "total_files": len(file_summaries),
            "changed_count": changed_count,
            "files": file_summaries,
        })
    return items


def diff_backup(
    workspace_dir: Path, backup_id: str, max_diff_chars: int = 120_000
) -> Optional[Dict]:
    """Build a unified diff between a snapshot (before) and current files."""
    try:
        entries = _load_validated_entries(workspace_dir, backup_id)
    except (ValueError, FileNotFoundError):
        return None
    except Exception as e:
        logger.warning(f"[Evolution] Failed to read backup {backup_id} for diff: {e}")
        return None

    files_diff: List[Dict] = []
    changed_count = 0
    remaining = max_diff_chars

    for rel, bak, dst in entries:
        bak_text = bak.read_text(encoding="utf-8", errors="replace")
        cur_exists = dst.is_file()
        cur_text = dst.read_text(encoding="utf-8", errors="replace") if cur_exists else ""
        changed = (not cur_exists) or (cur_text != bak_text)
        if changed:
            changed_count += 1

        diff_lines = list(
            difflib.unified_diff(
                bak_text.splitlines(),
                cur_text.splitlines(),
                fromfile=f"snapshot/{rel}",
                tofile=f"current/{rel}",
                lineterm="",
            )
        )
        added = 0
        removed = 0
        for line in diff_lines:
            if line.startswith("+++") or line.startswith("---"):
                continue
            if line.startswith("+"):
                added += 1
            elif line.startswith("-"):
                removed += 1

        diff_str = "\n".join(diff_lines)
        truncated = False
        if len(diff_str) > remaining:
            diff_str = diff_str[: max(0, remaining)]
            truncated = True
        remaining = max(0, remaining - len(diff_str))

        files_diff.append({
            "rel": rel,
            "changed": changed,
            "current_exists": cur_exists,
            "added_lines": added,
            "removed_lines": removed,
            "diff": diff_str,
            "truncated": truncated,
        })

    return {
        "backup_id": backup_id,
        "created_at": _parse_backup_timestamp(backup_id),
        "changed_count": changed_count,
        "files": files_diff,
    }


def restore_backup(workspace_dir: Path, backup_id: str) -> bool:
    """Restore all files captured under ``backup_id``. Returns success."""
    try:
        entries = _load_validated_entries(workspace_dir, backup_id)
        for _rel, bak, dst in entries:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(bak, dst)
        logger.info(f"[Evolution] Restored backup {backup_id} ({len(entries)} file(s))")
        return True
    except FileNotFoundError:
        logger.warning(f"[Evolution] Backup not found: {backup_id}")
        return False
    except Exception as e:
        logger.warning(f"[Evolution] Failed to restore backup {backup_id}: {e}")
        return False


def _prune_old_backups(root: Path) -> None:
    """Drop the oldest backups beyond _MAX_BACKUPS (sorted by name = chronological).

    Only restorable snapshots consume a slot. A directory without a manifest
    cannot be restored, so keeping it would evict a snapshot the user can still
    undo -- either crash debris or a failure from an older create_backup that
    predates _discard_incomplete.
    """
    try:
        dirs = sorted(
            [d for d in root.iterdir() if d.is_dir()],
            key=lambda p: p.name,
        )
        complete = [d for d in dirs if (d / _MANIFEST_NAME).is_file()]
        for debris in [d for d in dirs if d not in complete]:
            shutil.rmtree(debris, ignore_errors=True)
        for old in complete[:-_MAX_BACKUPS]:
            shutil.rmtree(old, ignore_errors=True)
    except Exception as e:
        logger.debug(f"[Evolution] Backup prune skipped: {e}")
