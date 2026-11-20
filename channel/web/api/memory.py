"""The memory view's endpoints: /api/memory/*.

Lists the Agent's memory files and serves one for the viewer, reports vector
index health and triggers background rebuilds, and exposes self-evolution
snapshot listing, diff preview, and one-click rollback.
"""

import json
import os
import threading
import time
from pathlib import Path

import web

from channel.web.core._common import (
    _get_workspace_root,
    _request_agent_id,
    _require_auth,
)
from common.log import logger

_rebuild_lock = threading.Lock()
_rebuild_states = {}


def _get_live_memory_manager(agent_id: str = ""):
    """Return the already-initialized MemoryManager for ``agent_id``, or None."""
    try:
        from bridge.bridge import Bridge

        agent = Bridge().get_agent_bridge().get_agent(agent_id=agent_id or None)
        return getattr(agent, "memory_manager", None) if agent else None
    except Exception:
        return None


def _rebuild_snapshot(workspace_root: str) -> dict:
    key = os.path.realpath(workspace_root)
    with _rebuild_lock:
        st = _rebuild_states.get(key) or {}
        return {
            "rebuilding": bool(st.get("rebuilding", False)),
            "last_rebuild": dict(st["last_rebuild"]) if st.get("last_rebuild") else None,
        }


def _mark_memory_dirty_best_effort(agent_id: str = "") -> None:
    try:
        mm = _get_live_memory_manager(agent_id)
        if mm:
            mm.mark_dirty()
    except Exception as e:
        logger.warning(f"[WebChannel] Failed to mark memory index dirty: {e}")


class MemoryHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.memory.service import MemoryService
            params = web.input(
                page='1', page_size='20', category='memory', agent_id=''
            )
            workspace_root = _get_workspace_root(agent_id=_request_agent_id(params))
            service = MemoryService(workspace_root)
            result = service.list_files(
                page=int(params.page), page_size=int(params.page_size),
                category=params.category,
            )
            return json.dumps({"status": "success", **result}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Memory API error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class MemoryContentHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.memory.service import MemoryService
            params = web.input(filename='', category='memory', agent_id='')
            if not params.filename:
                return json.dumps({"status": "error", "message": "filename required"})
            workspace_root = _get_workspace_root(agent_id=_request_agent_id(params))
            service = MemoryService(workspace_root)
            result = service.get_content(params.filename, category=params.category)
            return json.dumps({"status": "success", **result}, ensure_ascii=False)
        except ValueError:
            return json.dumps({"status": "error", "message": "invalid filename"})
        except FileNotFoundError:
            return json.dumps({"status": "error", "message": "file not found"})
        except Exception as e:
            logger.error(f"[WebChannel] Memory content API error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class MemorySearchHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.memory.service import MemoryService
            params = web.input(q='', category='all', limit='30', agent_id='')
            try:
                limit = max(1, min(100, int(params.limit)))
            except (TypeError, ValueError):
                limit = 30
            workspace_root = _get_workspace_root(agent_id=_request_agent_id(params))
            service = MemoryService(workspace_root)
            result = service.search(query=params.q, category=params.category, limit=limit)
            return json.dumps({"status": "success", **result}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Memory search API error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class MemoryIndexStatusHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.memory.service import MemoryService

            params = web.input(agent_id='')
            agent_id = _request_agent_id(params)
            workspace_root = _get_workspace_root(agent_id=agent_id)
            service = MemoryService(workspace_root)
            live_mm = _get_live_memory_manager(agent_id)
            status = service.get_index_status(memory_manager=live_mm)
            rebuild = _rebuild_snapshot(workspace_root)
            return json.dumps({"status": "success", **status, **rebuild}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Memory index status error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class MemoryIndexRebuildHandler:
    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.memory.config import MemoryConfig
            from agent.memory.embedding import (
                create_default_embedding_provider,
                rebuild_in_process,
            )
            from agent.memory.manager import MemoryManager

            body = json.loads(web.data() or b"{}")
            agent_id = _request_agent_id(body)
            workspace_root = _get_workspace_root(agent_id=agent_id)
            key = os.path.realpath(workspace_root)

            fresh_provider = create_default_embedding_provider()
            if fresh_provider is None:
                return json.dumps({
                    "status": "error",
                    "code": "no_embedding_provider",
                    "message": "No embedding provider configured",
                }, ensure_ascii=False)

            with _rebuild_lock:
                cur = _rebuild_states.get(key)
                if cur and cur.get("rebuilding"):
                    return json.dumps({
                        "status": "success",
                        "started": False,
                        "rebuilding": True,
                        "last_rebuild": cur.get("last_rebuild"),
                    }, ensure_ascii=False)
                _rebuild_states[key] = {
                    "rebuilding": True,
                    "last_rebuild": cur.get("last_rebuild") if cur else None,
                }

            def _run():
                temp_mm = None
                outcome = None
                try:
                    mm = _get_live_memory_manager(agent_id)
                    if mm is not None:
                        mm.embedding_provider = fresh_provider
                    else:
                        temp_mm = MemoryManager(
                            MemoryConfig(workspace_root=workspace_root),
                            embedding_provider=fresh_provider,
                        )
                        mm = temp_mm
                    res = rebuild_in_process(mm)
                    outcome = {
                        "ok": bool(res.ok),
                        "removed": int(res.removed),
                        "chunks": int(res.chunks),
                        "files": int(res.files),
                        "error": res.error or "",
                        "finished_at": int(time.time()),
                    }
                except Exception as exc:
                    logger.exception("[WebChannel] Memory index rebuild failed")
                    outcome = {
                        "ok": False,
                        "removed": 0,
                        "chunks": 0,
                        "files": 0,
                        "error": str(exc),
                        "finished_at": int(time.time()),
                    }
                finally:
                    if temp_mm is not None:
                        try:
                            temp_mm.close()
                        except Exception:
                            pass
                    with _rebuild_lock:
                        _rebuild_states[key] = {
                            "rebuilding": False,
                            "last_rebuild": outcome,
                        }

            threading.Thread(target=_run, daemon=True, name="memory-index-rebuild").start()
            return json.dumps({
                "status": "success",
                "started": True,
                "rebuilding": True,
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Memory index rebuild error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class EvolutionBackupsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.evolution.backup import list_backups

            params = web.input(agent_id='')
            workspace_root = _get_workspace_root(agent_id=_request_agent_id(params))
            backups = list_backups(Path(workspace_root))
            return json.dumps({"status": "success", "backups": backups}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Evolution backups error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class EvolutionBackupDiffHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.evolution.backup import diff_backup

            params = web.input(backup_id='', agent_id='')
            backup_id = (params.backup_id or '').strip()
            if not backup_id:
                return json.dumps({"status": "error", "message": "backup_id required"})
            workspace_root = _get_workspace_root(agent_id=_request_agent_id(params))
            diff = diff_backup(Path(workspace_root), backup_id)
            if diff is None:
                return json.dumps({"status": "error", "message": "backup not found"})
            return json.dumps({"status": "success", **diff}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Evolution backup diff error: {e}")
            return json.dumps({"status": "error", "message": str(e)})


class EvolutionBackupRestoreHandler:
    def POST(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')
        try:
            from agent.evolution.backup import restore_backup

            body = json.loads(web.data() or b"{}")
            backup_id = str(body.get("backup_id") or "").strip()
            if not backup_id:
                return json.dumps({"status": "error", "message": "backup_id required"})
            agent_id = _request_agent_id(body)
            workspace_root = _get_workspace_root(agent_id=agent_id)
            ok = restore_backup(Path(workspace_root), backup_id)
            if not ok:
                return json.dumps({"status": "error", "message": "backup restore failed"})
            _mark_memory_dirty_best_effort(agent_id)
            return json.dumps({"status": "success", "backup_id": backup_id}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"[WebChannel] Evolution backup restore error: {e}")
            return json.dumps({"status": "error", "message": str(e)})
