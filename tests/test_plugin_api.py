from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PLUGIN_ROOT / "dashboard" / "plugin_api.py"


def load_module():
    spec = importlib.util.spec_from_file_location("cron_bulletin_plugin_api", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_report(home: Path, job_id: str, filename: str, text: str, mtime: float) -> Path:
    path = home / "cron" / "output" / job_id / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    os.utime(path, (mtime, mtime))
    return path


def test_parse_success_report_extracts_response_and_media(tmp_path: Path):
    api = load_module()
    image = tmp_path / "artifacts" / "chart.png"
    image.parent.mkdir()
    image.write_bytes(b"png")
    source = tmp_path / "cron" / "output" / "job-1" / "2026-09-20_09-00-00.md"
    text = (
        "# Cron Job: Morning Brief\n\n"
        "**Job ID:** job-1\n"
        "**Run Time:** 2026-09-20 09:00:00\n"
        "**Schedule:** 0 9 * * *\n\n"
        "## Prompt\n\nCollect news.\n\n"
        "## Response\n\n# Headlines\n\nEverything is **good**.\n\n"
        f"MEDIA:{image}\n"
    )

    report = api.parse_report(source, text, allowed_roots=[tmp_path])

    assert report["job_id"] == "job-1"
    assert report["job_name"] == "Morning Brief"
    assert report["status"] == "completed"
    assert report["markdown"].startswith("# Headlines")
    assert "Collect news" not in report["markdown"]
    assert report["attachments"] == [
        {
            "id": "0",
            "name": "chart.png",
            "mime": "image/png",
            "size": 3,
            "path": str(image.resolve()),
            "kind": "image",
        }
    ]


def test_parse_failed_report_marks_failure(tmp_path: Path):
    api = load_module()
    source = tmp_path / "cron" / "output" / "job-2" / "2026-09-20_10-00-00.md"
    text = (
        "# Cron Job: Deploy Check (FAILED)\n\n"
        "**Job ID:** job-2\n"
        "**Run Time:** 2026-09-20 10:00:00\n\n"
        "## Prompt\n\nCheck deploy.\n\n"
        "## Error\n\nConnection refused.\n"
    )

    report = api.parse_report(source, text, allowed_roots=[tmp_path])

    assert report["job_name"] == "Deploy Check"
    assert report["status"] == "failed"
    assert report["markdown"] == "## Error\n\nConnection refused."


def test_attachment_path_rejects_traversal_and_symlink_escape(tmp_path: Path):
    api = load_module()
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside.txt"
    allowed.mkdir()
    outside.write_text("secret", encoding="utf-8")
    link = allowed / "escape.txt"
    link.symlink_to(outside)

    assert api.safe_attachment(outside, [allowed]) is None
    assert api.safe_attachment(link, [allowed]) is None


def test_list_reports_is_newest_first_bounded_and_searchable(tmp_path: Path):
    api = load_module()
    old = write_report(
        tmp_path,
        "job-old",
        "2026-09-19_09-00-00.md",
        "# Cron Job: Weather\n\n**Job ID:** job-old\n\n## Response\n\nSunny day.\n",
        100,
    )
    new = write_report(
        tmp_path,
        "job-new",
        "2026-09-20_09-00-00.md",
        "# Cron Job: Security (FAILED)\n\n**Job ID:** job-new\n\n## Error\n\nTLS audit failed.\n",
        200,
    )

    reports = api.list_reports(tmp_path, limit=10)
    assert [row["source_path"] for row in reports] == [str(new), str(old)]
    assert [row["status"] for row in api.list_reports(tmp_path, status="failed")] == ["failed"]
    assert [row["job_id"] for row in api.list_reports(tmp_path, query="sunny")] == ["job-old"]
    assert len(api.list_reports(tmp_path, limit=1)) == 1


def test_report_id_cannot_open_unindexed_path(tmp_path: Path):
    api = load_module()
    write_report(
        tmp_path,
        "job-1",
        "2026-09-20_09-00-00.md",
        "# Cron Job: Brief\n\n**Job ID:** job-1\n\n## Response\n\nDone.\n",
        100,
    )

    reports = api.list_reports(tmp_path)
    assert api.get_report(tmp_path, reports[0]["id"])["job_id"] == "job-1"
    with pytest.raises(KeyError):
        api.get_report(tmp_path, "../../outside")


def test_archived_reports_are_hidden_by_default_and_recoverable(tmp_path: Path):
    api = load_module()
    write_report(
        tmp_path,
        "job-archive",
        "2026-09-20_11-00-00.md",
        "# Cron Job: Archive Me\n\n**Job ID:** job-archive\n\n## Response\n\nDone.\n",
        300,
    )
    report_id = api.list_reports(tmp_path)[0]["id"]
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(api, "get_hermes_home", lambda: str(tmp_path))
    try:
        api.archive_endpoint(report_id)
    finally:
        monkeypatch.undo()

    assert api.list_reports(tmp_path) == []
    assert api.list_reports(tmp_path, archived="only")[0]["archived"] is True
    assert api.list_reports(tmp_path, archived="all")[0]["job_id"] == "job-archive"


def test_delete_hides_record_but_preserves_cron_output(tmp_path: Path):
    api = load_module()
    source = write_report(
        tmp_path,
        "job-delete",
        "2026-09-20_12-00-00.md",
        "# Cron Job: Delete Me\n\n**Job ID:** job-delete\n\n## Response\n\nDone.\n",
        400,
    )
    report_id = api.list_reports(tmp_path)[0]["id"]
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(api, "get_hermes_home", lambda: str(tmp_path))
    try:
        api.delete_endpoint(report_id)
    finally:
        monkeypatch.undo()

    assert api.list_reports(tmp_path) == []
    assert source.exists()


def test_profile_home_resolves_default_and_named_profile(tmp_path: Path):
    api = load_module()
    (tmp_path / "profiles" / "alpha").mkdir(parents=True)

    assert api.profile_home(tmp_path, "default") == tmp_path
    assert api.profile_home(tmp_path, "alpha") == tmp_path / "profiles" / "alpha"
    assert [row["id"] for row in api.profile_options(tmp_path)] == ["all", "default", "alpha"]


@pytest.mark.parametrize("requested", ["..", "../..", "../../victim", "alpha/../../victim", ".hidden", "a b"])
def test_profile_home_rejects_unsafe_names(tmp_path: Path, requested: str):
    api = load_module()
    (tmp_path / "profiles" / "alpha").mkdir(parents=True)

    with pytest.raises(KeyError):
        api.profile_home(tmp_path, requested)


def test_media_outside_job_output_is_not_attached(tmp_path: Path):
    api = load_module()
    secret = tmp_path / ".env"
    secret.write_text("TOKEN=x", encoding="utf-8")
    allowed = tmp_path / "cron" / "output" / "job-1" / "chart.png"
    allowed.parent.mkdir(parents=True)
    allowed.write_bytes(b"png")
    shared = tmp_path / "images" / "shared.png"
    shared.parent.mkdir()
    shared.write_bytes(b"png")
    text = (
        "# Cron Job: Leak\n\n**Job ID:** job-1\n\n## Response\n\nDone.\n\n"
        f"MEDIA:{secret}\nMEDIA:{allowed}\nMEDIA:{shared}\n"
    )
    write_report(tmp_path, "job-1", "2026-09-20_09-00-00.md", text, 1_700_000_000)

    names = [row["name"] for row in api.list_reports(tmp_path)[0]["attachments"]]

    assert names == ["chart.png", "shared.png"]
