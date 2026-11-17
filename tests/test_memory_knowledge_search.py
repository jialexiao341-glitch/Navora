import os
import tempfile
import unittest
from pathlib import Path

from agent.knowledge.service import KnowledgeService
from agent.memory.service import MemoryService
from channel.web import web_channel
from common.text_search import score_markdown_file, split_search_terms


class TestMemoryKnowledgeSearch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = self.tmp.name
        Path(self.ws, "memory", "dreams").mkdir(parents=True)
        Path(self.ws, "memory", "evolution").mkdir(parents=True)
        Path(self.ws, "knowledge", "architecture").mkdir(parents=True)

        Path(self.ws, "MEMORY.md").write_text(
            "# Core Preferences\nUser prefers Python and TypeScript for backend services.\n",
            encoding="utf-8",
        )
        Path(self.ws, "memory", "2026-11-15.md").write_text(
            "# Daily Notes\nInvestigated Electron transparent overlay window.\n",
            encoding="utf-8",
        )
        Path(self.ws, "memory", "dreams", "2026-11-16.md").write_text(
            "# Deep Dream\nConsolidated Python retrieval patterns and vector cache notes.\n",
            encoding="utf-8",
        )
        Path(self.ws, "memory", "evolution", "2026-11-16.md").write_text(
            "# Self Evolution\nImproved Electron packaging script reliability.\n",
            encoding="utf-8",
        )

        Path(self.ws, "knowledge", "index.md").write_text("# Index\n", encoding="utf-8")
        Path(self.ws, "knowledge", "architecture", "memory-rag.md").write_text(
            "# Hybrid Memory RAG\n\nCombines BM25 keyword search with vector retrieval for fast recall.\n",
            encoding="utf-8",
        )
        Path(self.ws, "knowledge", "architecture", "desktop-shell.md").write_text(
            "# Electron Desktop Shell\n\nLoads the Navora web console and manages the Python backend.\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_split_search_terms_deduplicates_and_lowercases(self):
        self.assertEqual(split_search_terms("  Python  python  RAG "), ["python", "rag"])
        self.assertEqual(split_search_terms(""), [])

    def test_memory_service_search_and_category_filter(self):
        svc = MemoryService(self.ws)

        all_python = svc.search("Python", category="all")
        self.assertEqual(all_python["total"], 2)
        names = {item["filename"] for item in all_python["results"]}
        self.assertEqual(names, {"MEMORY.md", "2026-11-16.md"})
        self.assertTrue(all(item["snippets"] for item in all_python["results"]))

        evo_only = svc.search("Python", category="evolution")
        self.assertEqual(evo_only["total"], 1)
        self.assertEqual(evo_only["results"][0]["type"], "dream")
        self.assertEqual(evo_only["results"][0]["rel_path"], "memory/dreams/2026-11-16.md")

        empty = svc.search("", category="all")
        self.assertEqual(empty["total"], 4)
        self.assertEqual(empty["results"][0]["match_count"], 0)

        dispatched = svc.dispatch("search", {"query": "transparent overlay", "category": "memory"})
        self.assertEqual(dispatched["code"], 200)
        self.assertEqual(dispatched["payload"]["total"], 1)
        self.assertEqual(dispatched["payload"]["results"][0]["filename"], "2026-11-15.md")

    def test_knowledge_service_search_documents(self):
        svc = KnowledgeService(self.ws)

        res = svc.search_documents("BM25 retrieval")
        self.assertEqual(res["total"], 1)
        doc = res["results"][0]
        self.assertEqual(doc["path"], "architecture/memory-rag.md")
        self.assertEqual(doc["title"], "Hybrid Memory RAG")
        self.assertGreaterEqual(doc["match_count"], 2)
        self.assertTrue(any("BM25" in s["text"] for s in doc["snippets"]))

        empty = svc.search_documents("")
        self.assertEqual(empty["total"], 2)
        self.assertNotIn("index.md", {r["path"] for r in empty["results"]})

        dispatched = svc.dispatch("search", {"query": "Electron backend"})
        self.assertEqual(dispatched["code"], 200)
        self.assertEqual(dispatched["payload"]["results"][0]["path"], "architecture/desktop-shell.md")

    def test_search_routes_and_citation_prompt_markers(self):
        urls = list(web_channel.URLS)
        pairs = dict(zip(urls[0::2], urls[1::2]))
        self.assertEqual(pairs.get("/api/memory/search"), "MemorySearchHandler")
        self.assertEqual(pairs.get("/api/knowledge/search"), "KnowledgeSearchHandler")

        channel_src = Path(__file__).resolve().parent.parent / "channel" / "web" / "core" / "channel.py"
        text = channel_src.read_text(encoding="utf-8")
        self.assertIn('elif ftype == "knowledge_ref":', text)
        self.assertIn('elif ftype == "memory_ref":', text)

    def test_score_markdown_file_ignores_missing(self):
        self.assertIsNone(score_markdown_file(os.path.join(self.ws, "missing.md"), ["test"]))


if __name__ == "__main__":
    unittest.main()
