import json
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

    def test_desktop_renderer_stays_lightweight_boot_shell(self):
        pkg = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        all_deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        for legacy_dep in ("react-router-dom", "zustand", "lucide-react", "markdown-it", "highlight.js"):
            self.assertNotIn(legacy_dep, all_deps, f"Legacy desktop UI dependency re-introduced: {legacy_dep}")

        renderer_src = ROOT / "desktop" / "src" / "renderer" / "src"
        self.assertTrue((renderer_src / "BootShell.tsx").is_file())
        self.assertTrue((renderer_src / "components" / "StatusScreen.tsx").is_file())
        self.assertTrue((renderer_src / "hooks" / "useBackend.ts").is_file())
        for legacy_path in ("App.tsx", "pages", "store", "layout", "api"):
            self.assertFalse(
                (renderer_src / legacy_path).exists(),
                f"Legacy dual-track renderer path should stay removed: {legacy_path}",
            )

    def test_pyinstaller_spec_bundles_web_assets_and_strips_local_secrets(self):
        spec_src = (ROOT / "desktop" / "build" / "cowagent-backend.spec").read_text(encoding="utf-8")
        for expected in (
            "(rp('channel', 'web', 'templates'), 'channel/web/templates')",
            "(rp('channel', 'web', 'static'), 'channel/web/static')",
            "name='cowagent-backend'",
            "def _is_local_sensitive_data(",
        ):
            self.assertIn(expected, spec_src)

    def test_electron_builder_layout_matches_pyinstaller_and_tsconfig(self):
        pkg = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        tsconfig_main = json.loads((ROOT / "desktop" / "tsconfig.main.json").read_text(encoding="utf-8"))

        self.assertEqual(pkg["main"], "dist/main/index.js")
        self.assertEqual(tsconfig_main["compilerOptions"]["outDir"], "dist/main")
        self.assertTrue((ROOT / "desktop" / "src" / "main" / "index.ts").is_file())

        extra = pkg["build"]["extraResources"]
        backend_copy = [item for item in extra if item.get("from") == "build/dist/cowagent-backend"]
        self.assertEqual(len(backend_copy), 1)
        self.assertEqual(backend_copy[0]["to"], "backend/cowagent-backend")

        for icon_rel in (
            pkg["build"]["mac"]["icon"],
            pkg["build"]["win"]["icon"],
            "resources/icon.png",
        ):
            self.assertTrue((ROOT / "desktop" / icon_rel).is_file(), f"Missing icon: {icon_rel}")

        # Arch must be passed via CI CLI flags (--arm64 / --x64), not hardcoded in mac.target.
        for target in pkg["build"]["mac"]["target"]:
            self.assertIsInstance(target, str)

        mac_cfg = (ROOT / "desktop" / "electron-builder.js").read_text(encoding="utf-8")
        self.assertIn("path.join(__dirname, 'build', 'dist', 'cowagent-backend')", mac_cfg)
        self.assertIn("notarize: false", mac_cfg)

        win_cfg = (ROOT / "desktop" / "electron-builder.win.js").read_text(encoding="utf-8")
        for env_key in ("SIGNTOOL_PATH", "SIGNTOOL_ACCESS_KEY", "SIGNTOOL_ACCESS_SECRET", "SIGNTOOL_CERT_CODE"):
            self.assertIn(env_key, win_cfg)

    def test_vite_boot_assets_exist_under_web_static(self):
        vite_src = (ROOT / "desktop" / "vite.config.ts").read_text(encoding="utf-8")
        block_match = re.search(r"const bootAssets\s*=\s*\[(.*?)\]", vite_src, re.S)
        self.assertIsNotNone(block_match)
        srcs = re.findall(r"src:\s*'([^']+)'", block_match.group(1))
        self.assertEqual(srcs, ["logo.jpg", "vendor/fonts/inter", "vendor/fontawesome"])
        static_dir = ROOT / "channel" / "web" / "static"
        for rel in srcs:
            self.assertTrue((static_dir / rel).exists(), f"Missing boot asset in static/: {rel}")


if __name__ == "__main__":
    unittest.main()
