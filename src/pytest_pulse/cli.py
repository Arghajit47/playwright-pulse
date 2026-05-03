"""CLI entry points — mirrors the npm bin scripts in the JS version.

Commands (registered in pyproject.toml):
  generate-pulse-report   → self-contained static HTML (all assets embedded)
  generate-report         → dynamic HTML (references attachment files)
  merge-pulse-report      → merge sharded / sequential reports
  send-email              → send report via email
  generate-email-report   → generate lightweight email HTML summary
  generate-trend          → archive current run for trend history
"""
from __future__ import annotations

import argparse
import os
import sys


# ── Shared helpers ──────────────────────────────────────────────────────────────

def _find_report_json(output_dir: str, output_file: str) -> str:
    path = os.path.join(output_dir, output_file)
    if not os.path.isfile(path):
        sys.exit(
            f"✗ Report JSON not found at: {path}\n"
            f"  Run your tests first with the pulse-report plugin enabled."
        )
    return path


def _resolve_dirs(args) -> tuple[str, str]:
    """Return (output_dir, output_file)."""
    output_dir = getattr(args, "output_dir", None) or _cfg_output_dir()
    output_file = getattr(args, "output_file", None) or "playwright-pulse-report.json"
    return os.path.abspath(output_dir), output_file


def _cfg_output_dir() -> str:
    """Try to read outputDir from a conftest or pytest.ini; fall back to 'pulse-report'."""
    # Check pytest.ini / setup.cfg for pulse_output_dir option
    for ini_name in ("pytest.ini", "setup.cfg", "pyproject.toml"):
        if os.path.isfile(ini_name):
            try:
                with open(ini_name, "r", encoding="utf-8") as fh:
                    content = fh.read()
                import re
                m = re.search(r"pulse[_-]output[_-]dir\s*=\s*(.+)", content)
                if m:
                    return m.group(1).strip().strip('"').strip("'")
            except Exception:
                pass
    return "pulse-report"


# ── generate-pulse-report ───────────────────────────────────────────────────────

def generate_static_report(argv=None) -> None:
    """generate-pulse-report — static, fully self-contained HTML report."""
    p = argparse.ArgumentParser(
        prog="generate-pulse-report",
        description="Generate a self-contained static HTML pulse report",
    )
    p.add_argument("--outputDir", "-o", dest="output_dir", default=None,
                   help="Report output directory (default: pulse-report)")
    args = p.parse_args(argv)
    output_dir, output_file = _resolve_dirs(args)

    from .merge_reports import merge_sequential_reports
    merge_sequential_reports(output_dir)  # no-op if nothing to merge

    json_path = _find_report_json(output_dir, output_file)
    html_path = os.path.join(output_dir, "playwright-pulse-static-report.html")

    print(f"\n⚡ Pulse Report — Generating Static HTML\n")
    print(f"  Source : {json_path}")
    print(f"  Output : {html_path}\n")

    from .static_generator import generate_static_html
    generate_static_html(json_path, html_path)

    print(f"✓ Static report generated → {html_path}")
    _print_stats(json_path)


# ── generate-report ─────────────────────────────────────────────────────────────

def generate_report(argv=None) -> None:
    """generate-report — dynamic HTML that references attachment files."""
    p = argparse.ArgumentParser(
        prog="generate-report",
        description="Generate a dynamic HTML pulse report (references attachments)",
    )
    p.add_argument("--outputDir", "-o", dest="output_dir", default=None)
    args = p.parse_args(argv)
    output_dir, output_file = _resolve_dirs(args)

    from .merge_reports import merge_sequential_reports
    merge_sequential_reports(output_dir)

    json_path = _find_report_json(output_dir, output_file)
    html_path = os.path.join(output_dir, "playwright-pulse-report.html")

    print(f"\n⚡ Pulse Report — Generating Dynamic HTML\n")
    from .dynamic_generator import generate_dynamic_html
    generate_dynamic_html(json_path, html_path)

    print(f"✓ Dynamic report generated → {html_path}")
    _print_stats(json_path)


# ── merge-pulse-report ──────────────────────────────────────────────────────────

def merge_reports_cli(argv=None) -> None:
    """merge-pulse-report — merge sharded or sequential reports."""
    p = argparse.ArgumentParser(
        prog="merge-pulse-report",
        description="Merge pulse reports (sharded or sequential runs)",
    )
    p.add_argument("--outputDir", "-o", dest="output_dir", default=None)
    p.add_argument("--no-cleanup", dest="cleanup", action="store_false", default=True,
                   help="Keep shard directories after merging")
    args = p.parse_args(argv)
    output_dir, output_file = _resolve_dirs(args)

    print(f"\n⚡ Pulse Report — Merge Reports\n")
    print(f"  Directory : {output_dir}")

    from .merge_reports import merge_shard_directories, merge_sequential_reports

    # First try shard merge
    result = merge_shard_directories(
        output_dir, output_file, cleanup=args.cleanup
    )
    if result is None:
        # Fall back to sequential merge
        result = merge_sequential_reports(output_dir)
    if result is None:
        print("✗ Nothing to merge.")
        return

    print(f"\n✓ Merged report → {result}")
    _print_stats(result)


# ── generate-email-report ───────────────────────────────────────────────────────

def generate_email_report_cli(argv=None) -> None:
    """generate-email-report — lightweight email-friendly HTML summary."""
    p = argparse.ArgumentParser(
        prog="generate-email-report",
        description="Generate a lightweight email summary HTML",
    )
    p.add_argument("--outputDir", "-o", dest="output_dir", default=None)
    args = p.parse_args(argv)
    output_dir, output_file = _resolve_dirs(args)

    json_path = _find_report_json(output_dir, output_file)
    email_path = os.path.join(output_dir, "pulse-email-summary.html")

    from .email_generator import generate_email_html
    html = generate_email_html(json_path)
    with open(email_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"✓ Email summary generated → {email_path}")


# ── send-email ──────────────────────────────────────────────────────────────────

def send_email_cli(argv=None) -> None:
    """send-email — send the report via SMTP."""
    p = argparse.ArgumentParser(
        prog="send-email",
        description="Send the pulse report via email (reads credentials from env)",
    )
    p.add_argument("--outputDir", "-o", dest="output_dir", default=None)
    p.add_argument("--attach-html", dest="attach_html", action="store_true", default=False,
                   help="Attach the static HTML report file")
    args = p.parse_args(argv)
    output_dir, output_file = _resolve_dirs(args)

    json_path = _find_report_json(output_dir, output_file)
    attachment = None
    if args.attach_html:
        html_path = os.path.join(output_dir, "playwright-pulse-static-report.html")
        if not os.path.isfile(html_path):
            print("  Static HTML not found, generating it first …")
            from .static_generator import generate_static_html
            generate_static_html(json_path, html_path)
        attachment = html_path

    from .email_sender import send_report
    try:
        send_report(json_path, attachment_path=attachment)
    except Exception as exc:
        print(f"✗ Email sending failed: {exc}")
        sys.exit(1)


# ── generate-trend ──────────────────────────────────────────────────────────────

def generate_trend_cli(argv=None) -> None:
    """generate-trend — archive current run JSON for historical trend analysis."""
    p = argparse.ArgumentParser(
        prog="generate-trend",
        description="Archive the current run JSON for trend history",
    )
    p.add_argument("--outputDir", "-o", dest="output_dir", default=None)
    p.add_argument("--max-history", dest="max_history", type=int, default=15)
    args = p.parse_args(argv)
    output_dir, output_file = _resolve_dirs(args)

    from .merge_reports import archive_trend
    archive_trend(output_dir, output_file, max_history=args.max_history)


# ── Shared stat printer ─────────────────────────────────────────────────────────

def _print_stats(json_path: str) -> None:
    try:
        import json
        with open(json_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        run = data.get("run") or {}
        print(f"\n  Total: {run.get('totalTests',0)}  "
              f"✓ Passed: {run.get('passed',0)}  "
              f"✗ Failed: {run.get('failed',0)}  "
              f"⊘ Skipped: {run.get('skipped',0)}  "
              f"⚡ Flaky: {run.get('flaky',0)}")
    except Exception:
        pass
