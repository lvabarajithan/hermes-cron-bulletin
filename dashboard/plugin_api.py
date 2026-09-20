from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import threading
from pathlib import Path
from typing import Iterable

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from hermes_constants import get_hermes_home

router = APIRouter()

_MEDIA_RE = re.compile(r"(?m)^MEDIA:\s*(\S+)\s*$")
# Profile names come from the query string; keep them to plain directory names.
_PROFILE_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
_TITLE_RE = re.compile(r"^# Cron Job:\s*(.+?)\s*$", re.MULTILINE)
_FIELD_RE = re.compile(r"^\*\*(?P<key>[^*]+):\*\*\s*(?P<value>.*)$", re.MULTILINE)
_RESPONSE_RE = re.compile(r"(?m)^## Response\s*$")
_ERROR_RE = re.compile(r"(?m)^## Error\s*$")
_IMAGE_EXTS = {".gif", ".jpeg", ".jpg", ".png", ".webp"}
_MAX_READ_BYTES = 4 * 1024 * 1024
_STATE_FILENAME = "bulletin-state.json"
_STATE_LOCK = threading.Lock()


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def safe_attachment(path: Path | str, allowed_roots: Iterable[Path | str]) -> Path | None:
    """Resolve a report attachment only when it is a regular file inside an approved root."""
    try:
        resolved = Path(path).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if not resolved.is_file():
        return None
    for raw_root in allowed_roots:
        try:
            root = Path(raw_root).expanduser().resolve(strict=True)
        except (OSError, RuntimeError):
            continue
        if _inside(resolved, root):
            return resolved
    return None


def _report_id(path: Path) -> str:
    return hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:24]


def _split_body(text: str, failed: bool) -> str:
    marker = _ERROR_RE.search(text) if failed else _RESPONSE_RE.search(text)
    if marker is None and not failed:
        marker = _ERROR_RE.search(text)
    if marker is None:
        return text.strip()
    heading = "## Error\n\n" if marker.re is _ERROR_RE else ""
    return f"{heading}{text[marker.end():].strip()}".strip()


def parse_report(
    source_path: Path | str,
    text: str,
    *,
    allowed_roots: Iterable[Path | str],
) -> dict:
    path = Path(source_path)
    title_match = _TITLE_RE.search(text)
    raw_title = title_match.group(1).strip() if title_match else path.parent.name
    failed = raw_title.endswith("(FAILED)")
    job_name = raw_title.removesuffix("(FAILED)").strip()
    fields = {match.group("key").strip().lower(): match.group("value").strip() for match in _FIELD_RE.finditer(text)}
    job_id = fields.get("job id") or path.parent.name
    markdown = _split_body(text, failed)
    attachments = []
    seen: set[Path] = set()
    for media_match in _MEDIA_RE.finditer(markdown):
        resolved = safe_attachment(media_match.group(1), allowed_roots)
        if resolved is None or resolved in seen:
            continue
        seen.add(resolved)
        mime = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        attachments.append(
            {
                "id": str(len(attachments)),
                "name": resolved.name,
                "mime": mime,
                "size": resolved.stat().st_size,
                "path": str(resolved),
                "kind": "image" if resolved.suffix.lower() in _IMAGE_EXTS else "file",
            }
        )
    stat = path.stat() if path.exists() else None
    return {
        "id": _report_id(path),
        "job_id": job_id,
        "job_name": job_name,
        "run_time": fields.get("run time") or "",
        "schedule": fields.get("schedule") or "",
        "status": "failed" if failed else "completed",
        "markdown": markdown,
        "attachments": attachments,
        "source_path": str(path),
        "modified_at": stat.st_mtime if stat else 0,
    }


def _job_workdirs(home: Path) -> dict[str, Path]:
    jobs_file = home / "cron" / "jobs.json"
    try:
        payload = json.loads(jobs_file.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    rows = payload.get("jobs", []) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return {}
    result: dict[str, Path] = {}
    for row in rows:
        if not isinstance(row, dict) or not row.get("id") or not row.get("workdir"):
            continue
        result[str(row["id"])] = Path(str(row["workdir"]))
    return result


def _allowed_roots(home: Path, job_id: str, workdirs: dict[str, Path]) -> list[Path]:
    # Only the job's own output dir, the plugin's own artifact dir, the shared
    # images dir and the job workdir: a MEDIA: line is model-written, so the
    # whole home (`.env`, keys) must stay out.
    roots = [home / "cron" / "output" / job_id, home / "cron" / "bulletin-assets", home / "images"]
    if job_id in workdirs:
        roots.append(workdirs[job_id])
    return roots


def _state_path(home: Path) -> Path:
    return home / "cron" / _STATE_FILENAME


def _read_state(home: Path) -> dict:
    try:
        raw = json.loads(_state_path(home).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"archived": {}, "deleted": {}}
    return raw if isinstance(raw, dict) else {"archived": {}, "deleted": {}}


def _write_state(home: Path, state: dict) -> None:
    target = _state_path(home)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(target)


def _home_context(home: Path) -> tuple[Path, str]:
    """Return the Hermes root and the active profile name, if profile-scoped."""
    if home.parent.name == "profiles":
        return home.parent.parent, home.name
    return home, "default"


def profile_options(active_home: Path | str) -> list[dict]:
    home = Path(active_home).resolve()
    root, active_name = _home_context(home)
    options = [
        {"id": "all", "label": "All profiles", "active": False},
        {"id": "default", "label": "Default", "active": active_name == "default"},
    ]
    profiles_dir = root / "profiles"
    try:
        names = sorted(path.name for path in profiles_dir.iterdir() if path.is_dir())
    except OSError:
        names = []
    for name in names:
        if name == "default" or name.startswith("."):
            continue
        options.append({"id": name, "label": name, "active": name == active_name})
    return options


def profile_home(active_home: Path | str, profile: str) -> Path:
    home = Path(active_home).resolve()
    root, active_name = _home_context(home)
    requested = profile.strip()
    if requested == "all":
        raise KeyError(requested)
    if not requested or requested == "active":
        return home
    if requested == "default":
        return root
    if _PROFILE_NAME_RE.fullmatch(requested) is None:
        raise KeyError(requested)
    candidate = root / "profiles" / requested
    if candidate.is_dir():
        return candidate
    # A remote/default gateway can expose a friendly profile name while its
    # files live at the launch home. Unknown names must not read another profile.
    if requested == active_name:
        return home
    raise KeyError(requested)


def list_reports(
    home: Path | str,
    *,
    limit: int = 100,
    query: str = "",
    status: str = "all",
    archived: str = "exclude",
) -> list[dict]:
    home_path = Path(home)
    output_root = home_path / "cron" / "output"
    workdirs = _job_workdirs(home_path)
    state = _read_state(home_path)
    archived_ids = set(state.get("archived", {}))
    deleted_ids = set(state.get("deleted", {}))
    try:
        candidates = [path for path in output_root.glob("*/*.md") if path.is_file()]
    except OSError:
        return []
    candidates.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    needle = query.strip().casefold()
    selected_status = status.strip().lower()
    rows = []
    for path in candidates:
        if len(rows) >= max(1, min(int(limit), 500)):
            break
        try:
            if path.stat().st_size > _MAX_READ_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        job_id = path.parent.name
        report = parse_report(path, text, allowed_roots=_allowed_roots(home_path, job_id, workdirs))
        if report["id"] in deleted_ids:
            continue
        is_archived = report["id"] in archived_ids
        if archived == "exclude" and is_archived:
            continue
        if archived == "only" and not is_archived:
            continue
        report["archived"] = is_archived
        if selected_status in {"completed", "failed"} and report["status"] != selected_status:
            continue
        if needle and needle not in "\n".join(
            (report["job_name"], report["job_id"], report["markdown"])
        ).casefold():
            continue
        rows.append(report)
    return rows


def get_report(home: Path | str, report_id: str, *, archived: str = "all") -> dict:
    for report in list_reports(home, limit=500, archived=archived):
        if report["id"] == report_id:
            return report
    raise KeyError(report_id)


def _public_report(report: dict, profile: str = "active") -> dict:
    public = dict(report)
    public["attachments"] = [
        {
            **{key: value for key, value in attachment.items() if key != "path"},
            "url": f"/api/plugins/cron-bulletin/assets/{report['id']}/{attachment['id']}?profile={profile}",
        }
        for attachment in report["attachments"]
    ]
    public.pop("source_path", None)
    return public


@router.get("/reports")
def reports_endpoint(
    limit: int = Query(100, ge=1, le=500),
    query: str = Query("", max_length=500),
    status: str = Query("all", pattern="^(all|completed|failed)$"),
    archived: str = Query("exclude", pattern="^(exclude|only|all)$"),
    profile: str = Query("active", max_length=100),
):
    active_home = Path(get_hermes_home())
    if profile == "all":
        rows = []
        seen_profiles = set()
        for option in profile_options(active_home):
            profile_id = option["id"]
            if profile_id == "all" or profile_id in seen_profiles:
                continue
            seen_profiles.add(profile_id)
            try:
                profile_rows = list_reports(
                    profile_home(active_home, profile_id),
                    limit=limit,
                    query=query,
                    status=status,
                    archived=archived,
                )
            except KeyError:
                continue
            for row in profile_rows:
                row["profile"] = profile_id
            rows.extend(profile_rows)
        rows.sort(key=lambda row: row.get("created_at", ""), reverse=True)
        rows = rows[:limit]
    else:
        try:
            home = profile_home(active_home, profile)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Profile not found") from exc
        rows = list_reports(home, limit=limit, query=query, status=status, archived=archived)
        for row in rows:
            row["profile"] = profile
    return {
        "reports": [_public_report(row, row.get("profile", profile)) for row in rows],
        "count": len(rows),
        "profile": profile,
        "profiles": profile_options(Path(get_hermes_home())),
    }


@router.get("/profiles")
def profiles_endpoint():
    return {"profiles": profile_options(Path(get_hermes_home()))}


@router.get("/reports/{report_id}")
def report_endpoint(report_id: str, profile: str = "active"):
    try:
        home = profile_home(Path(get_hermes_home()), profile)
        return {"report": _public_report(get_report(home, report_id), profile)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Report not found") from exc


def _set_report_flag(report_id: str, key: str, value: bool, profile: str) -> dict:
    try:
        home = profile_home(Path(get_hermes_home()), profile)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Profile not found") from exc
    try:
        get_report(home, report_id, archived="all")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Report not found") from exc
    with _STATE_LOCK:
        state = _read_state(home)
        bucket = state.setdefault(key, {})
        if value:
            bucket[report_id] = True
        else:
            bucket.pop(report_id, None)
        _write_state(home, state)
    return {"ok": True, "report_id": report_id, key: value}


@router.post("/reports/{report_id}/archive")
def archive_endpoint(report_id: str, archived: bool = True, profile: str = "active"):
    return _set_report_flag(report_id, "archived", archived, profile)


@router.delete("/reports/{report_id}")
def delete_endpoint(report_id: str, profile: str = "active"):
    # Delete the bulletin record only; the original cron output remains intact.
    return _set_report_flag(report_id, "deleted", True, profile)


@router.get("/assets/{report_id}/{asset_id}")
def asset_endpoint(report_id: str, asset_id: str, profile: str = "active"):
    try:
        report = get_report(profile_home(Path(get_hermes_home()), profile), report_id)
        index = int(asset_id)
        attachment = report["attachments"][index]
    except (KeyError, ValueError, IndexError) as exc:
        raise HTTPException(status_code=404, detail="Attachment not found") from exc
    if attachment["id"] != asset_id:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(
        attachment["path"],
        filename=attachment["name"],
        media_type=attachment["mime"],
    )
