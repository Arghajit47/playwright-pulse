"""JSON serialisation helpers — mirrors the JS Date-aware replacer/reviver."""
from __future__ import annotations
import json
import os
import re
from dataclasses import asdict, fields, is_dataclass
from datetime import datetime
from typing import Any

_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


def _to_dict(obj: Any) -> Any:
    """Recursively convert dataclasses → dicts; datetime → ISO string."""
    if isinstance(obj, datetime):
        return obj.strftime("%Y-%m-%dT%H:%M:%S.") + f"{obj.microsecond // 1000:03d}Z"
    if is_dataclass(obj):
        result = {}
        for f in fields(obj):
            val = getattr(obj, f.name)
            if val is None:
                continue  # omit None fields (matches JS behaviour of omitting undefined)
            result[f.name] = _to_dict(val)
        return result
    if isinstance(obj, list):
        return [_to_dict(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _to_dict(v) for k, v in obj.items()}
    return obj


def write_report(report_obj: Any, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    data = _to_dict(report_obj)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)


def read_report(json_path: str) -> dict:
    with open(json_path, "r", encoding="utf-8") as fh:
        return json.load(fh, object_hook=_revive_dates)


def _revive_dates(dct: dict) -> dict:
    """Convert ISO date strings back to datetime objects in JSON objects."""
    for key, val in dct.items():
        if isinstance(val, str) and _ISO_RE.match(val):
            try:
                dct[key] = datetime.fromisoformat(val.replace("Z", "+00:00"))
            except ValueError:
                pass
    return dct


def merge_raw_reports(reports: list[dict]) -> dict:
    """Combine a list of raw report dicts into one — used by merge scripts."""
    combined_run: dict = {
        "totalTests": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "flaky": 0,
        "duration": 0,
    }
    all_results: list = []
    latest_ts = ""
    latest_gen = ""
    environments: list = []

    for rep in reports:
        run = rep.get("run") or {}
        combined_run["totalTests"] += run.get("totalTests", 0)
        combined_run["passed"] += run.get("passed", 0)
        combined_run["failed"] += run.get("failed", 0)
        combined_run["skipped"] += run.get("skipped", 0)
        combined_run["flaky"] += run.get("flaky", 0)
        combined_run["duration"] += run.get("duration", 0)

        env = run.get("environment")
        if env:
            environments.append(env)

        all_results.extend(rep.get("results") or [])

        ts = run.get("timestamp", "")
        if ts > latest_ts:
            latest_ts = ts

        gen = (rep.get("metadata") or {}).get("generatedAt", "")
        if gen > latest_gen:
            latest_gen = gen

    import time, uuid
    run_id = f"merged-{int(time.time() * 1000)}-{uuid.uuid4()}"
    combined_run["id"] = run_id
    combined_run["timestamp"] = latest_ts
    if environments:
        combined_run["environment"] = environments

    return {
        "run": combined_run,
        "results": all_results,
        "metadata": {"generatedAt": latest_gen},
    }
