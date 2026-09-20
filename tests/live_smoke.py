from __future__ import annotations

import importlib.util
import json
import os
import socket
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from fastapi import FastAPI
import uvicorn


PLUGIN = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"


def main() -> None:
    with tempfile.TemporaryDirectory() as raw_home:
        home = Path(raw_home)
        report_dir = home / "cron" / "output" / "smoke-job"
        report_dir.mkdir(parents=True)
        (report_dir / "2026-09-20_09-00-00.md").write_text(
            "# Cron Job: Smoke Report\n\n"
            "**Job ID:** smoke-job\n"
            "**Run Time:** 2026-09-20 09:00:00\n\n"
            "## Response\n\n"
            "Live API smoke test.\n",
            encoding="utf-8",
        )
        os.environ["HERMES_HOME"] = str(home)

        spec = importlib.util.spec_from_file_location("cron_bulletin_live_smoke", PLUGIN)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        app = FastAPI()
        app.include_router(module.router, prefix="/api/plugins/cron-bulletin")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        )
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 5
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started, "smoke server did not start"
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/plugins/cron-bulletin/reports",
                timeout=3,
            ) as response:
                payload = json.load(response)
            assert response.status == 200
            assert payload["count"] == 1
            assert payload["reports"][0]["job_name"] == "Smoke Report"
            assert "source_path" not in payload["reports"][0]
            print(json.dumps({"status": response.status, "count": payload["count"]}))
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            assert not thread.is_alive(), "smoke server did not stop"


if __name__ == "__main__":
    main()
