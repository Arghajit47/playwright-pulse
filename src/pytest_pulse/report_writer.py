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


def calculate_summary(results: list[dict]) -> dict:
    """Re-calculate total run statistics (passed, failed, flaky, etc) from a list of results."""
    # First, dedupe results to correctly handle retries/flaky tests
    final_results = dedupe_results(results)
    
    passed = sum(1 for r in final_results if get_final_status(r) == "passed")
    failed = sum(1 for r in final_results if get_final_status(r) == "failed")
    skipped = sum(1 for r in final_results if get_final_status(r) == "skipped")
    flaky = sum(1 for r in final_results if get_final_status(r) == "flaky")
    total_duration = sum(r.get("duration", 0) for r in results) # Sum of all attempts
    
    return {
        "totalTests": len(final_results),
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "flaky": flaky,
        "duration": float(total_duration),
    }


def get_final_status(r: dict) -> str:
    """Return the final visual status of a test (handles flaky status)."""
    if r.get("status") == "flaky":
        return "flaky"
    return r.get("final_status") or r.get("status") or "unknown"


def dedupe_results(results: list[dict]) -> list[dict]:
    """Group results by ID and determine flaky status."""
    from collections import defaultdict
    grouped = defaultdict(list)
    for r in results:
        rid = r.get("id")
        if rid:
            grouped[rid].append(r)
    
    final = []
    for attempts in grouped.values():
        # Sort by retries (asc) then startTime (asc)
        attempts.sort(key=lambda x: (x.get("retries", 0), x.get("startTime", "")))
        
        if len(attempts) > 1:
            # The latest attempt (last one in sorted list) should be the primary result
            # so that users see the most recent execution (e.g. the one that passed) by default.
            primary = attempts[-1]
            previous = attempts[:-1]
            
            # Identify if it's flaky: any previous attempt failed and current is passed/flaky
            was_failed = any(a.get("status") in ["failed", "timedout", "interrupted"] for a in previous)
            # Support both 'passed' and 'flaky' as successful retry indicators
            is_successful = primary.get("status") in ["passed", "flaky"]
            
            if was_failed and is_successful:
                primary["status"] = "flaky"
                primary["outcome"] = "flaky"
            elif was_failed:
                # Still failed after retries
                primary["outcome"] = "failed"
            else:
                # Normal pass or other status
                primary["outcome"] = primary.get("status")
            
            # Ensure final_status reflects the actual last attempt's status
            primary["final_status"] = primary.get("status")
            primary["retryHistory"] = previous
            final.append(primary)
        else:
            # Single attempt
            test = attempts[0]
            test["retryHistory"] = []
            test["final_status"] = test.get("status")
            final.append(test)
    return final


def merge_raw_reports(reports: list[dict]) -> dict:
    """Combine a list of raw report dicts into one — used by merge scripts."""
    all_results: list = []
    latest_ts = ""
    latest_gen = ""
    environments: list = []

    for rep in reports:
        run = rep.get("run") or {}
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

    # Re-calculate summary from all combined results
    combined_run = calculate_summary(all_results)
    
    import time, uuid
    run_id = f"merged-{int(time.time() * 1000)}-581d5ad8-ce75-4ca5-94a6-ed29c466c815"
    combined_run["id"] = run_id
    combined_run["timestamp"] = latest_ts
    if environments:
        combined_run["environment"] = environments

    return {
        "run": combined_run,
        "results": dedupe_results(all_results),
        "metadata": {"generatedAt": latest_gen},
    }
