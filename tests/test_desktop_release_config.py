import json
import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TestDesktopReleaseConfig(unittest.TestCase):
    def test_desktop_identity_and_publish_target(self):
        pkg = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        cli_ver = (ROOT / "cli" / "VERSION").read_text(encoding="utf-8").strip()

        self.assertEqual(pkg["name"], "navora-desktop")
        self.assertEqual(pkg["version"], cli_ver)
        self.assertEqual(pkg["build"]["appId"], "com.navora.desktop")
        self.assertEqual(pkg["build"]["productName"], "Navora")
        self.assertEqual(
            pkg["build"]["publish"],
            {
                "provider": "github",
                "owner": "jialexiao341-glitch",
                "repo": "Navora",
            },
        )

    def test_no_upstream_cowagent_update_endpoints(self):
        targets = [
            ROOT / "desktop" / "package.json",
            ROOT / "desktop" / "src" / "main" / "index.ts",
            ROOT / "desktop" / "src" / "main" / "updater.ts",
            ROOT / ".github" / "workflows" / "release.yml",
        ]
        forbidden = ("cowagent.ai/update", "cowagent.cn", "com.cowagent.desktop", "r2://cow-skills")
        for path in targets:
            text = path.read_text(encoding="utf-8")
            for token in forbidden:
                self.assertNotIn(token, text, f"Unexpected '{token}' found in {path}")

    def test_source_and_web_update_pointers(self):
        py_src = (ROOT / "cli" / "update_service.py").read_text(encoding="utf-8")
        js_src = (ROOT / "channel" / "web" / "static" / "js" / "core" / "version.js").read_text(encoding="utf-8")

        self.assertIn("jialexiao341-glitch/Navora", py_src)
        self.assertNotIn('GITHUB_REPO = "zhayujie/CowAgent"', py_src)
        self.assertRegex(
            js_src,
            re.compile(r"GITHUB_RELEASES_URL\s*=\s*'https://github\.com/jialexiao341-glitch/Navora/releases'"),
        )

    def test_pyinstaller_spec_bundles_all_web_shell_html_files(self):
        spec_src = (ROOT / "desktop" / "build" / "cowagent-backend.spec").read_text(encoding="utf-8")
        html_files = sorted(p.name for p in (ROOT / "channel" / "web").glob("*.html"))
        self.assertIn("chat.html", html_files)
        self.assertIn("pet.html", html_files)
        for name in html_files:
            self.assertIn(f"'{name}'", spec_src, f"Missing channel/web/{name} in cowagent-backend.spec")


if __name__ == "__main__":
    unittest.main()
