"""Tests for memory vector index status/rebuild and evolution backup diff/restore APIs."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agent.evolution.backup import (
    create_backup,
    diff_backup,
    list_backups,
    restore_backup,
)
from agent.memory.chunker import TextChunker
from agent.memory.config import MemoryConfig
from agent.memory.service import MemoryService
from agent.memory.storage import MemoryChunk, MemoryStorage


class TestMemoryIndexAndEvolutionUiApi(unittest.TestCase):
    def test_evolution_list_diff_and_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            memory = tmp_path / "MEMORY.md"
            daily = tmp_path / "memory" / "2026-11-20.md"
            daily.parent.mkdir(parents=True)
            memory.write_text("line 1\nline 2\n", encoding="utf-8")
            daily.write_text("daily note\n", encoding="utf-8")

            backup_id = create_backup(tmp_path, [memory, daily])
            self.assertIsNotNone(backup_id)

            initial = list_backups(tmp_path)
            self.assertEqual(len(initial), 1)
            self.assertEqual(initial[0]["backup_id"], backup_id)
            self.assertEqual(initial[0]["changed_count"], 0)
            self.assertEqual(initial[0]["total_files"], 2)

            memory.write_text("line 1\nline 2 edited\nline 3\n", encoding="utf-8")
            after_edit = list_backups(tmp_path)
            self.assertEqual(after_edit[0]["changed_count"], 1)

            diff = diff_backup(tmp_path, backup_id)
            self.assertIsNotNone(diff)
            self.assertEqual(diff["changed_count"], 1)
            mem_diff = next(f for f in diff["files"] if f["rel"] == "MEMORY.md")
            self.assertTrue(mem_diff["changed"])
            self.assertGreaterEqual(mem_diff["added_lines"], 1)
            self.assertGreaterEqual(mem_diff["removed_lines"], 1)
            self.assertIn("+line 2 edited", mem_diff["diff"])
            self.assertIn("-line 2", mem_diff["diff"])

            self.assertIsNone(diff_backup(tmp_path, "../escape"))
            self.assertIsNone(diff_backup(tmp_path, "20260101-000000-000"))

            self.assertTrue(restore_backup(tmp_path, backup_id))
            self.assertEqual(memory.read_text(encoding="utf-8"), "line 1\nline 2\n")
            self.assertEqual(list_backups(tmp_path)[0]["changed_count"], 0)

    def test_memory_index_status_reports_health_and_warnings(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            tmp_path = Path(tmp)
            svc = MemoryService(str(tmp_path))

            with patch(
                "agent.memory.embedding.describe_configured_embedding",
                return_value={
                    "explicit": False,
                    "configured": False,
                    "provider": "",
                    "model": "",
                    "dimensions": None,
                },
            ), patch("config.conf", return_value={}):
                empty_status = svc.get_index_status()
                self.assertFalse(empty_status["index_exists"])
                self.assertEqual(empty_status["chunks"], 0)
                self.assertEqual(empty_status["search_mode"], "keyword_only")
                self.assertIn("no_provider", empty_status["warnings"])

            db_path = MemoryConfig(workspace_root=str(tmp_path)).get_db_path()
            storage = MemoryStorage(db_path)
            try:
                storage.update_file_metadata("MEMORY.md", "memory", "hash1", 1, 10)
                storage.save_chunk(
                    MemoryChunk(
                        id="c1",
                        user_id="default",
                        scope="global",
                        source="memory",
                        path="MEMORY.md",
                        start_line=1,
                        end_line=2,
                        text="hello",
                        hash="h1",
                        embedding=[0.1, 0.2, 0.3],
                    )
                )
                storage.save_chunk(
                    MemoryChunk(
                        id="c2",
                        user_id="default",
                        scope="global",
                        source="memory",
                        path="MEMORY.md",
                        start_line=3,
                        end_line=4,
                        text="world",
                        hash="h2",
                        embedding=None,
                    )
                )
                storage.set_meta("chunker_version", str(TextChunker.CHUNKER_VERSION - 1))
            finally:
                storage.close()

            with patch(
                "agent.memory.embedding.describe_configured_embedding",
                return_value={
                    "explicit": True,
                    "configured": True,
                    "provider": "openai",
                    "model": "text-embedding-3-small",
                    "dimensions": 1536,
                },
            ), patch("config.conf", return_value={"rerank_provider": "jina"}):
                status = svc.get_index_status()
                self.assertTrue(status["index_exists"])
                self.assertEqual(status["files"], 1)
                self.assertEqual(status["chunks"], 2)
                self.assertEqual(status["embedded"], 1)
                self.assertEqual(status["missing_chunks"], 1)
                self.assertEqual(status["index_dim"], 3)
                self.assertEqual(status["embedding_dim"], 1536)
                self.assertTrue(status["rerank_enabled"])
                self.assertEqual(status["search_mode"], "hybrid")
                self.assertEqual(
                    set(status["warnings"]),
                    {"missing_vectors", "dim_mismatch", "chunker_outdated"},
                )

    def test_web_channel_wires_memory_index_and_evolution_routes(self):
        web_channel_src = (
            Path(__file__).resolve().parents[1] / "channel" / "web" / "web_channel.py"
        )
        text = web_channel_src.read_text(encoding="utf-8")
        for route in (
            "'/api/memory/index'",
            "'/api/memory/index/rebuild'",
            "'/api/memory/evolution/backups'",
            "'/api/memory/evolution/diff'",
            "'/api/memory/evolution/restore'",
        ):
            self.assertIn(route, text)


if __name__ == "__main__":
    unittest.main()
