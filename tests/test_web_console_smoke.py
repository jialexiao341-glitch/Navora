"""End-to-end smoke tests for the Web Console WSGI app (pages, assets, and core APIs)."""

import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from channel.web.web_channel import build_app


class TestWebConsoleSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = build_app()

    def test_health_and_shell_pages_and_all_referenced_assets(self):
        health = self.app.request("/api/health", method="GET")
        self.assertEqual(health.status, "200 OK")
        self.assertEqual(json.loads(health.data.decode("utf-8")), {"status": "ok"})
        self.assertEqual(health.headers.get("Cache-Control"), "no-store")

        for route in ("/", "/pet", "/memory", "/memory/evolution", "/settings", "/skills", "/agents"):
            res = self.app.request(route, method="GET")
            self.assertEqual(res.status, "200 OK", route)
            html = res.data.decode("utf-8")
            self.assertNotIn("<!--#include", html, route)
            self.assertIn("text/html", res.headers.get("Content-Type", ""))

            if route == "/pet":
                self.assertIn("pet-window-mode", html)

            if route in ("/", "/pet"):
                asset_urls = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
                self.assertGreater(len(asset_urls), 0, route)
                for url in asset_urls:
                    asset_res = self.app.request(url, method="GET")
                    self.assertEqual(asset_res.status, "200 OK", f"{route} -> {url}")
                    self.assertGreater(len(asset_res.data), 0, url)
                    if ".js" in url:
                        self.assertIn("javascript", asset_res.headers.get("Content-Type", ""))

    def test_pet_manifests_served(self):
        for path in (
            "/assets/vendor/dsh-pet/manifest.json",
            "/assets/vendor/doro/manifest.json",
        ):
            res = self.app.request(path, method="GET")
            self.assertEqual(res.status, "200 OK", path)
            data = json.loads(res.data.decode("utf-8"))
            self.assertTrue(data, path)

    def test_core_read_apis_respond_cleanly_on_isolated_workspace(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            ws = str(Path(tmp))
            with patch("channel.web.api.memory._get_workspace_root", return_value=ws), \
                 patch("channel.web.core._common._require_auth", return_value=None), \
                 patch("channel.web.api.memory._require_auth", return_value=None), \
                 patch("channel.web.api.skills._require_auth", return_value=None), \
                 patch("config.conf", return_value={"agent_workspace": ws}):
                mem_res = self.app.request("/api/memory", method="GET")
                self.assertEqual(mem_res.status, "200 OK")
                mem_json = json.loads(mem_res.data.decode("utf-8"))
                self.assertEqual(mem_json["status"], "success")

                idx_res = self.app.request("/api/memory/index", method="GET")
                self.assertEqual(idx_res.status, "200 OK")
                idx_json = json.loads(idx_res.data.decode("utf-8"))
                self.assertEqual(idx_json["status"], "success")
                self.assertIn("search_mode", idx_json)
                self.assertIn("chunks", idx_json)

                evo_res = self.app.request("/api/memory/evolution/backups", method="GET")
                self.assertEqual(evo_res.status, "200 OK")
                evo_json = json.loads(evo_res.data.decode("utf-8"))
                self.assertEqual(evo_json["status"], "success")
                self.assertEqual(evo_json["backups"], [])

                ver_res = self.app.request("/api/version", method="GET")
                self.assertEqual(ver_res.status, "200 OK")
                ver_json = json.loads(ver_res.data.decode("utf-8"))
                self.assertTrue(ver_json.get("version") or ver_json.get("status") == "success")


if __name__ == "__main__":
    unittest.main()
