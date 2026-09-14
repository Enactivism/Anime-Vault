"""
备份服务器面板的接口和页面契约测试。

页面上的“测试连接 / 上传备份 / 一键刷新数据”按钮、连接状态徽标和提示区域
由后端模板渲染，前端 static/app.js 通过 data-backup-* 属性绑定行为。
这里保证这些钩子不会被误删，并覆盖本机导出 / 导入接口。
"""
from __future__ import annotations

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from anime_vault.repository import ensure_database, load_catalog
from anime_vault.server import create_server


class BackupPanelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "anime.db"
        self.db_patch = patch("anime_vault.repository.DB_PATH", self.db_path)
        self.db_patch.start()
        ensure_database()
        self.server = create_server("127.0.0.1", 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        load_catalog.cache_clear()
        self.db_patch.stop()
        self.temp_dir.cleanup()

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=5
        )
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        result = (response.status, dict(response.getheaders()), payload)
        connection.close()
        return result

    def test_home_page_renders_connection_state_and_test_button(self) -> None:
        status, _, body = self.request("GET", "/")
        page = body.decode("utf-8")

        self.assertEqual(status, 200)
        # 连接状态徽标：收起面板时也能看到是否连上。
        self.assertIn('data-backup-state', page)
        self.assertIn('data-state="idle"', page)
        # 三个操作按钮和提示区域。
        self.assertIn("data-backup-test", page)
        self.assertIn("data-backup-upload", page)
        self.assertIn("data-backup-refresh", page)
        self.assertIn("data-backup-message", page)
        self.assertIn('aria-live="polite"', page)
        # 测试连接排在数据操作之前，先确认连通性再改数据。
        self.assertLess(page.index("测试连接"), page.index("上传备份"))

    def test_backup_client_script_is_loadable_without_unlocking(self) -> None:
        status, headers, body = self.request("GET", "/static/backup-client.js")

        self.assertEqual(status, 200)
        content_type = next(
            (value for name, value in headers.items() if name.lower() == "content-type"), ""
        )
        self.assertIn("javascript", content_type)
        self.assertIn("AnimeVaultBackup", body.decode("utf-8"))

    def test_home_page_loads_the_backup_client_script(self) -> None:
        _, _, body = self.request("GET", "/")
        page = body.decode("utf-8")

        self.assertIn("/static/backup-client.js", page)
        self.assertLess(
            page.index("backup-client.js"),
            page.index("app.js"),
            "backup-client.js 必须在 app.js 之前加载",
        )

    def test_export_and_import_round_trip_through_http(self) -> None:
        payload = {
            "format": "anime-vault-backup",
            "version": 1,
            "exported_at": 1757850000,
            "anime": [
                {"slug": "cloud-a", "title": "云端番剧 A", "episode_count": 12},
                {"slug": "cloud-b", "title": "云端番剧 B"},
            ],
            "episode_progress": [
                {"slug": "cloud-a", "episode_number": 3, "position_seconds": 120.0}
            ],
            "playback_activity": [{"slug": "cloud-a", "qualified_played_at": 1757840000}],
            "media_library_paths": ["/media/anime"],
        }
        status, _, body = self.request(
            "POST",
            "/api/backup/import",
            body=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body.decode("utf-8")), {"ok": True, "anime_count": 2})

        status, _, body = self.request("GET", "/api/backup/export")
        exported = json.loads(body.decode("utf-8"))

        self.assertEqual(status, 200)
        self.assertEqual(exported["format"], "anime-vault-backup")
        self.assertEqual(
            sorted(anime["slug"] for anime in exported["anime"]), ["cloud-a", "cloud-b"]
        )
        self.assertEqual(
            [(item["slug"], item["episode_number"]) for item in exported["episode_progress"]],
            [("cloud-a", 3)],
        )
        self.assertEqual(exported["media_library_paths"], ["/media/anime"])
        self.assertNotIn("password_hash", json.dumps(exported))

    def test_import_replaces_catalog_and_reports_count(self) -> None:
        payload = {
            "format": "anime-vault-backup",
            "version": 1,
            "exported_at": 1757850000,
            "anime": [{"slug": "cloud-a", "title": "云端番剧 A"}],
            "episode_progress": [],
            "playback_activity": [],
            "media_library_paths": [],
        }
        status, _, body = self.request(
            "POST",
            "/api/backup/import",
            body=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        result = json.loads(body.decode("utf-8"))

        self.assertEqual(status, 200)
        self.assertEqual(result, {"ok": True, "anime_count": 1})
        self.assertEqual([anime["slug"] for anime in load_catalog()], ["cloud-a"])
        self.assertEqual(load_catalog()[0]["title"], "云端番剧 A")

    def test_import_failure_returns_readable_error_instead_of_dropping_connection(self) -> None:
        """导入异常必须变成可读的 JSON 错误，否则前端只能看到“没有反馈”。"""
        with patch(
            "anime_vault.server.import_user_data",
            side_effect=RuntimeError("boom"),
        ):
            status, _, body = self.request(
                "POST",
                "/api/backup/import",
                body=json.dumps({"format": "anime-vault-backup"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )

        self.assertEqual(status, 500)
        self.assertIn("boom", json.loads(body.decode("utf-8"))["error"])

    def test_import_rejects_invalid_payload_with_reason(self) -> None:
        status, _, body = self.request(
            "POST",
            "/api/backup/import",
            body=b'{"format": "something-else"}',
            headers={"Content-Type": "application/json"},
        )
        result = json.loads(body.decode("utf-8"))

        self.assertEqual(status, 400)
        self.assertIn("error", result)
        self.assertTrue(result["error"])

    def test_import_requires_json_content_type(self) -> None:
        status, _, body = self.request(
            "POST",
            "/api/backup/import",
            body=b"not json",
            headers={"Content-Type": "text/plain"},
        )
        result = json.loads(body.decode("utf-8"))

        self.assertEqual(status, 400)
        self.assertIn("application/json", result["error"])


if __name__ == "__main__":
    unittest.main()
