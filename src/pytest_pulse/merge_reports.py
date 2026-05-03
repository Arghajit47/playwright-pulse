"""Merge multiple pulse JSON reports — mirrors merge-pulse-report.mjs logic.

Handles two scenarios:
  1. Sharded runs  → merge parallel output directories (each with its own JSON).
  2. Sequential runs (resetOnEachRun=False) → merge individual timestamped JSONs
     from the ``pulse-results/`` sub-directory into a single report.
"""
from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Optional


DEFAULT_OUTPUT_FILE = "playwright-pulse-report.json"
ATTACHMENTS_SUBDIR = "attachments"
INDIVIDUAL_SUBDIR = "pulse-results"


# ── Sequential-run merge (resetOnEachRun=False) ────────────────────────────────

def merge_sequential_reports(output_dir: str, individual_sub: str = INDIVIDUAL_SUBDIR) -> Optional[str]:
    """
    Scan *output_dir*/*individual_sub* for timestamped JSON files and combine
    them into *output_dir*/*DEFAULT_OUTPUT_FILE*.

    Returns the path of the merged file, or None if nothing was found.
    """
    sub_dir = os.path.join(output_dir, individual_sub)
    if not os.path.isdir(sub_dir):
        print(f"PulseReport: No individual reports directory found at {sub_dir}")
        return None

    json_files = sorted(
        [f for f in os.listdir(sub_dir) if f.endswith(".json")],
        key=lambda f: os.path.getmtime(os.path.join(sub_dir, f)),
    )

    if not json_files:
        print(f"PulseReport: No individual report files found in {sub_dir}")
        return None

    reports = []
    for fname in json_files:
        fpath = os.path.join(sub_dir, fname)
        try:
            with open(fpath, "r", encoding="utf-8") as fh:
                reports.append(json.load(fh))
        except Exception as exc:
            print(f"PulseReport: Failed to read {fpath}: {exc}")

    if not reports:
        return None

    merged = _merge_report_list(reports)
    out_path = os.path.join(output_dir, DEFAULT_OUTPUT_FILE)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2, ensure_ascii=False)
    print(f"PulseReport: Sequential reports merged → {out_path}")
    return out_path


# ── Sharded-run merge ──────────────────────────────────────────────────────────

def merge_shard_directories(
    output_dir: str,
    output_file: str = DEFAULT_OUTPUT_FILE,
    individual_sub: str = INDIVIDUAL_SUBDIR,
    cleanup: bool = True,
) -> Optional[str]:
    """
    Scan *output_dir* for shard sub-directories (folders that contain their own
    JSON report or individual-sub directory), merge them, and write the merged
    JSON plus consolidate attachments.

    Returns the path of the merged file, or None if nothing was found.
    """
    shard_dirs = _get_shard_dirs(output_dir, output_file, individual_sub)

    if not shard_dirs:
        print(f"PulseReport: No shard directories found in {output_dir}")
        return None

    print(f"PulseReport: Found {len(shard_dirs)} shard(s):")
    for d in shard_dirs:
        print(f"  - {os.path.basename(d)}")

    # Pre-merge sequential reports within each shard if needed
    for shard_dir in shard_dirs:
        if os.path.isdir(os.path.join(shard_dir, individual_sub)):
            print(f"  Merging sequential reports in shard {os.path.basename(shard_dir)} …")
            merge_sequential_reports(shard_dir, individual_sub)

    reports = []
    for shard_dir in shard_dirs:
        json_path = os.path.join(shard_dir, output_file)
        if not os.path.exists(json_path):
            print(f"  Warning: {json_path} not found, skipping")
            continue
        try:
            with open(json_path, "r", encoding="utf-8") as fh:
                reports.append(json.load(fh))
        except Exception as exc:
            print(f"  Warning: failed to read {json_path}: {exc}")

    if not reports:
        return None

    merged = _merge_report_list(reports)

    # Consolidate attachments
    global_attachments = os.path.join(output_dir, ATTACHMENTS_SUBDIR)
    for shard_dir in shard_dirs:
        shard_att = os.path.join(shard_dir, ATTACHMENTS_SUBDIR)
        if os.path.isdir(shard_att):
            os.makedirs(global_attachments, exist_ok=True)
            shutil.copytree(shard_att, global_attachments, dirs_exist_ok=True)

    out_path = os.path.join(output_dir, output_file)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, indent=2, ensure_ascii=False)
    print(f"\nPulseReport: Merged report → {out_path}")
    _print_stats(merged)

    if cleanup:
        print("\nPulseReport: Cleaning up shard directories…")
        for shard_dir in shard_dirs:
            shutil.rmtree(shard_dir, ignore_errors=True)
        print("PulseReport: Cleanup complete.")

    return out_path


# ── Trend archiving ────────────────────────────────────────────────────────────

def archive_trend(output_dir: str, output_file: str = DEFAULT_OUTPUT_FILE, max_history: int = 15) -> None:
    """Copy the current run JSON into a *history/* sub-directory for trend analysis."""
    src = os.path.join(output_dir, output_file)
    if not os.path.isfile(src):
        print(f"PulseReport: {src} not found, cannot archive trend.")
        return

    history_dir = os.path.join(output_dir, "history")
    os.makedirs(history_dir, exist_ok=True)

    try:
        with open(src, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        ts = (data.get("run") or {}).get("timestamp", "")
        ts_ms = int(time.time() * 1000)
        if ts:
            from datetime import datetime
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                ts_ms = int(dt.timestamp() * 1000)
            except Exception:
                pass
    except Exception as exc:
        print(f"PulseReport: Cannot read {src}: {exc}")
        return

    dest = os.path.join(history_dir, f"trend-{ts_ms}.json")
    shutil.copy2(src, dest)
    print(f"PulseReport: Archived trend → {dest}")

    # Prune old history files
    history_files = sorted(
        [f for f in os.listdir(history_dir) if f.startswith("trend-") and f.endswith(".json")],
        key=lambda f: _trend_ts(f),
    )
    if len(history_files) > max_history:
        to_delete = history_files[: len(history_files) - max_history]
        for fname in to_delete:
            try:
                os.unlink(os.path.join(history_dir, fname))
            except OSError:
                pass
        print(f"PulseReport: Pruned {len(to_delete)} old history files.")


def _trend_ts(fname: str) -> int:
    try:
        return int(fname.replace("trend-", "").replace(".json", ""))
    except Exception:
        return 0


# ── Internal helpers ───────────────────────────────────────────────────────────

def _merge_report_list(reports: list) -> dict:
    combined = {"totalTests": 0, "passed": 0, "failed": 0, "skipped": 0, "flaky": 0, "duration": 0}
    all_results: list = []
    latest_ts = ""
    latest_gen = ""
    environments: list = []

    for rep in reports:
        run = rep.get("run") or {}
        for key in ("totalTests", "passed", "failed", "skipped", "flaky", "duration"):
            combined[key] = combined.get(key, 0) + (run.get(key) or 0)

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

    run_id = f"merged-{int(time.time()*1000)}-{uuid.uuid4()}"
    combined["id"] = run_id
    combined["timestamp"] = latest_ts
    if environments:
        combined["environment"] = environments

    return {
        "run": combined,
        "results": all_results,
        "metadata": {"generatedAt": latest_gen},
    }


def _get_shard_dirs(output_dir: str, output_file: str, individual_sub: str) -> list:
    if not os.path.isdir(output_dir):
        return []

    dirs = []
    for entry in os.scandir(output_dir):
        if not entry.is_dir():
            continue
        if entry.name in (ATTACHMENTS_SUBDIR, individual_sub):
            continue
        has_report = os.path.isfile(os.path.join(entry.path, output_file))
        has_individual = os.path.isdir(os.path.join(entry.path, individual_sub))
        if has_report or has_individual:
            dirs.append(entry.path)
    return dirs


def _print_stats(merged: dict) -> None:
    run = merged.get("run") or {}
    print(f"  Total: {run.get('totalTests', 0)}  "
          f"Passed: {run.get('passed', 0)}  "
          f"Failed: {run.get('failed', 0)}  "
          f"Skipped: {run.get('skipped', 0)}  "
          f"Flaky: {run.get('flaky', 0)}")
