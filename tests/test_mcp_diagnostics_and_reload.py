import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agent.tools.mcp.mcp_tool import McpTool
from agent.tools.mcp.service import (
    McpConfigError,
    list_servers_with_status,
    reload_server,
)
from agent.tools.tool_manager import ToolManager


ROOT = Path(__file__).resolve().parents[1]


class TestMcpDiagnosticsAndReload(unittest.TestCase):
    def tearDown(self):
        ToolManager.reset_instances()

    def test_tool_manager_list_mcp_details_groups_tools_and_errors(self):
        tm = ToolManager.__new__(ToolManager)
        tm._mcp_status = {"fetch": "ready", "broken": "failed"}
        tm._mcp_errors = {"broken": "spawn uvx ENOENT"}
        tm._mcp_tool_instances = {
            "fetch_url": McpTool(
                None,
                {"name": "url", "description": "Fetch a web page", "inputSchema": {}},
                "fetch",
                name_prefix="fetch_",
            ),
            "fetch_html": McpTool(
                None,
                {"name": "html", "description": "Read HTML", "inputSchema": {}},
                "fetch",
                name_prefix="fetch_",
            ),
        }

        details = tm.list_mcp_details()
        self.assertEqual(details["fetch"]["status"], "ready")
        self.assertIsNone(details["fetch"]["error"])
        self.assertEqual(
            [t["name"] for t in details["fetch"]["tools"]],
            ["fetch_html", "fetch_url"],
        )
        self.assertEqual(details["fetch"]["tools"][0]["remote_name"], "html")
        self.assertEqual(details["broken"]["status"], "failed")
        self.assertEqual(details["broken"]["error"], "spawn uvx ENOENT")
        self.assertEqual(details["broken"]["tools"], [])

    def test_list_servers_with_status_merges_tools_and_errors(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            mcp_path = os.path.join(tmpdir, "mcp.json")
            with open(mcp_path, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "mcpServers": {
                            "fetch": {"command": "uvx", "args": ["mcp-server-fetch"]},
                            "broken": {"command": "bad-cmd"},
                            "muted": {"command": "uvx", "disabled": True},
                        }
                    },
                    fh,
                )

            tm = ToolManager.__new__(ToolManager)
            tm.workspace_root = os.path.realpath(tmpdir)
            tm._mcp_status = {"fetch": "ready", "broken": "failed", "muted": "failed"}
            tm._mcp_errors = {"broken": "process exited 127", "muted": "ignored"}
            tm._mcp_tool_instances = {
                "fetch": McpTool(
                    None,
                    {"name": "fetch", "description": "Fetch URL", "inputSchema": {}},
                    "fetch",
                )
            }

            with patch("agent.tools.mcp.service.mcp_config_path", return_value=mcp_path), patch.object(
                ToolManager, "instances", return_value=[tm]
            ):
                result = list_servers_with_status(tmpdir)

        by_name = {item["name"]: item for item in result["servers"]}
        self.assertEqual(by_name["fetch"]["status"], "ready")
        self.assertEqual(len(by_name["fetch"]["tools"]), 1)
        self.assertEqual(by_name["fetch"]["tools"][0]["name"], "fetch")
        self.assertEqual(by_name["broken"]["status"], "failed")
        self.assertEqual(by_name["broken"]["error"], "process exited 127")
        self.assertEqual(by_name["muted"]["status"], "disabled")
        self.assertEqual(by_name["muted"]["tools"], [])
        self.assertIsNone(by_name["muted"]["error"])

    def test_reload_server_validates_and_triggers_matching_manager(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            mcp_path = os.path.join(tmpdir, "mcp.json")
            with open(mcp_path, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "mcpServers": {
                            "fetch": {"command": "uvx", "args": ["mcp-server-fetch"]},
                            "muted": {"command": "uvx", "disabled": True},
                        }
                    },
                    fh,
                )

            reloaded_calls = []

            class FakeManager:
                workspace_root = os.path.realpath(tmpdir)

                def refresh_mcp_if_changed(self):
                    reloaded_calls.append("refresh")

                def reload_mcp_server(self, name):
                    reloaded_calls.append(name)
                    return True

                def list_mcp_details(self):
                    return {"fetch": {"status": "pending", "error": None, "tools": []}}

            with patch("agent.tools.mcp.service.mcp_config_path", return_value=mcp_path), patch.object(
                ToolManager, "instances", return_value=[FakeManager()]
            ):
                with self.assertRaises(McpConfigError):
                    reload_server(tmpdir, "")
                with self.assertRaises(McpConfigError):
                    reload_server(tmpdir, "missing")
                with self.assertRaises(McpConfigError):
                    reload_server(tmpdir, "muted")

                res = reload_server(tmpdir, "fetch")
                self.assertEqual(reloaded_calls, ["refresh", "fetch"])
                by_name = {s["name"]: s for s in res["servers"]}
                self.assertEqual(by_name["fetch"]["status"], "pending")

    def test_web_routes_register_mcp_reload_handler(self):
        web_channel = (ROOT / "channel/web/web_channel.py").read_text(encoding="utf-8")
        skills_api = (ROOT / "channel/web/api/skills.py").read_text(encoding="utf-8")
        self.assertIn("'/api/mcp/servers/reload'", web_channel)
        self.assertIn("class McpServerReloadHandler:", skills_api)


if __name__ == "__main__":
    unittest.main()
