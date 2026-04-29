"""HTML report generator for pytest-pulse-report.

Produces a self-contained, interactive HTML report that matches the look,
feel and feature-set of the JS playwright-pulse reporter:
  * Dark theme (identical CSS variables)
  * Tabs: Dashboard / Test Runs / Test History / AI Failure Analyzer
  * Highcharts charts: pie (status distribution), trend, duration, worker
  * Expandable test-case cards with steps, screenshots, videos, traces
  * Filters: name search, status, browser
  * Severity badges, retry history, annotations, env section
  * Load-more pagination for large result sets
  * AI Failure Analyzer tab (client-side Claude / OpenAI API call)
"""
from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

# ── Default logo (same base64 PNG used in the JS version) ─────────────────────
_DEFAULT_LOGO_B64 = (
    "data:image/svg+xml;base64,"
    + base64.b64encode(
        b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        b'<circle cx="50" cy="50" r="45" fill="#7737BF"/>'
        b'<text x="50" y="67" font-size="50" text-anchor="middle" fill="white" '
        b'font-family="Arial,sans-serif" font-weight="bold">P</text></svg>'
    ).decode()
)


# ── Public entry points ────────────────────────────────────────────────────────

def generate_static_html(report_json_path: str, output_html_path: str) -> None:
    """Read *report_json_path* and write a fully self-contained HTML to *output_html_path*."""
    with open(report_json_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    html = _build_html(data, report_dir=os.path.dirname(report_json_path), embed_assets=True)
    os.makedirs(os.path.dirname(output_html_path) or ".", exist_ok=True)
    with open(output_html_path, "w", encoding="utf-8") as fh:
        fh.write(html)


def generate_dynamic_html(report_json_path: str, output_html_path: str) -> None:
    """Like generate_static_html but references attachment files by path instead of
    embedding them as base64 — smaller file, requires the attachments dir to be present."""
    with open(report_json_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    html = _build_html(data, report_dir=os.path.dirname(report_json_path), embed_assets=False)
    os.makedirs(os.path.dirname(output_html_path) or ".", exist_ok=True)
    with open(output_html_path, "w", encoding="utf-8") as fh:
        fh.write(html)


def generate_email_html(report_json_path: str) -> str:
    """Return a lightweight email-friendly HTML summary string."""
    with open(report_json_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return _build_email_html(data)


# ── JSON safe serialisation ────────────────────────────────────────────────────

def _j(obj: Any) -> str:
    def default(o):
        if isinstance(o, datetime):
            return o.isoformat()
        raise TypeError(f"Object of type {type(o)} is not JSON serializable")
    return json.dumps(obj, default=default, ensure_ascii=False)


def _esc(text: Any) -> str:
    """HTML-escape a string."""
    if text is None:
        return ""
    s = str(text)
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&#39;")
    )


# ── Logo helpers ───────────────────────────────────────────────────────────────

def _resolve_logo(data: dict, report_dir: str) -> str:
    logo = (data.get("metadata") or {}).get("logo")
    if logo:
        if logo.startswith("data:"):
            return logo
        # Path relative to report dir
        full = os.path.join(report_dir, logo)
        if os.path.isfile(full):
            return _file_to_data_url(full)
    return _DEFAULT_LOGO_B64


def _file_to_data_url(path: str) -> str:
    import mimetypes
    mime, _ = mimetypes.guess_type(path)
    mime = mime or "image/png"
    with open(path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    return f"data:{mime};base64,{b64}"


# ── Main HTML builder ──────────────────────────────────────────────────────────

def _build_html(data: dict, report_dir: str, embed_assets: bool) -> str:
    logo = _resolve_logo(data, report_dir)
    # Embed screenshot/video data when embed_assets=True
    if embed_assets:
        data = _embed_attachment_data(data, report_dir)

    report_json = _j(data)
    description = (data.get("metadata") or {}).get("reportDescription") or ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pulse Report</title>
<link rel="icon" type="image/png" href="{logo}">
<link rel="apple-touch-icon" href="{logo}">
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap">
<script src="https://code.highcharts.com/highcharts.js"></script>
<style>
{_CSS}
</style>
</head>
<body>
<div class="container">
  <header class="header">
    <div class="header-title">
      <img id="report-logo" src="{logo}" alt="Pulse Report Logo">
      <h1>Pulse Report</h1>
    </div>
    <div class="run-info" id="run-info-bar"></div>
  </header>
  {('<div class="report-description">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#764ba2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
    '<div><h4 style="margin:0 0 6px;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;color:#764ba2;font-weight:700">Report Description</h4>' +
    f'<p style="margin:0;font-size:.95em;color:var(--text-color);line-height:1.6">{_esc(description[:130] + ("..." if len(description) > 130 else ""))}</p></div></div>')
   if description else ''}
  <div class="tabs">
    <button class="tab-button active" data-tab="dashboard">Dashboard</button>
    <button class="tab-button" data-tab="test-runs">Test Run Summary</button>
    <button class="tab-button" data-tab="test-history">Test History</button>
    <button class="tab-button" data-tab="ai-failure-analyzer">AI Failure Analyzer</button>
  </div>
  <div id="dashboard" class="tab-content active">
    <div class="dashboard-grid" id="summary-cards"></div>
    <div class="dashboard-bottom-row">
      <div style="display:grid;gap:20px">
        <div class="chart-card">
          <h3 class="chart-title-header">Status Distribution</h3>
          <div id="pie-chart" style="min-height:300px"></div>
        </div>
        <div id="env-section"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:28px">
        <div class="chart-card">
          <h3 class="chart-title-header">Suites Overview</h3>
          <div id="suites-widget"></div>
        </div>
        <div class="chart-card">
          <h3 class="chart-title-header">Severity Distribution</h3>
          <div id="severity-chart" style="min-height:220px"></div>
        </div>
      </div>
    </div>
  </div>
  <div id="test-runs" class="tab-content">
    <div class="filters">
      <input type="text" id="filter-name" placeholder="Filter by test name/path...">
      <select id="filter-status">
        <option value="">All Statuses</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
        <option value="flaky">Flaky</option>
        <option value="skipped">Skipped</option>
      </select>
      <select id="filter-browser"><option value="">All Browsers</option></select>
      <button id="clear-run-summary-filters" class="clear-filters-btn">Clear Filters</button>
    </div>
    <div class="test-cases-list" id="test-cases-list"></div>
    <div id="load-more-wrapper" style="display:none;text-align:center;padding:16px">
      <button id="load-more-tests" class="load-more-btn">Load more</button>
    </div>
  </div>
  <div id="test-history" class="tab-content">
    <div class="trend-charts-row">
      <div class="trend-chart">
        <h3 class="chart-title-header">Spec File Duration</h3>
        <div id="spec-duration-chart" style="min-height:260px"></div>
      </div>
      <div class="trend-chart">
        <h3 class="chart-title-header">Describe Block Duration</h3>
        <div id="describe-duration-chart" style="min-height:260px"></div>
      </div>
    </div>
    <div class="trend-charts-row">
      <div class="trend-chart">
        <h3 class="chart-title-header">Worker Distribution</h3>
        <div id="worker-chart" style="min-height:260px"></div>
      </div>
    </div>
  </div>
  <div id="ai-failure-analyzer" class="tab-content">
    <div id="ai-tab-content"></div>
  </div>
  <footer style="padding:.5rem;text-align:center;font-family:var(--font-family)">
    <div style="display:inline-flex;align-items:center;gap:.5rem;font-size:.9rem;font-weight:600">
      <span>Created by</span>
      <img src="{logo}" alt="Pulse" style="height:20px">
      <a href="https://www.npmjs.com/package/@arghajit/playwright-pulse-report"
         target="_blank" rel="noopener" style="color:#7737BF;font-weight:700;font-style:italic;text-decoration:none">
         Pulse Report</a>
    </div>
    <div style="margin-top:.5rem;font-size:.75rem;color:#666">Crafted with precision</div>
  </footer>
</div>

<!-- Modal -->
<div id="media-modal" class="modal" style="display:none">
  <div class="modal-backdrop" id="modal-backdrop"></div>
  <div class="modal-content">
    <button class="modal-close" id="modal-close">&times;</button>
    <div id="modal-body"></div>
  </div>
</div>

<script>
const PULSE_DATA = {report_json};
</script>
<script>
{_JS}
</script>
</body>
</html>"""


# ── Embed asset data URLs ──────────────────────────────────────────────────────

def _embed_attachment_data(data: dict, report_dir: str) -> dict:
    """Replace relative attachment paths with data: URLs in a deep copy of *data*."""
    import copy
    data = copy.deepcopy(data)
    for result in data.get("results") or []:
        result["screenshots"] = [_embed_file(p, report_dir) for p in (result.get("screenshots") or [])]
        result["videoPath"] = [_embed_file(p, report_dir) for p in (result.get("videoPath") or [])]
        if result.get("tracePath"):
            # Don't embed traces as data URLs — they're zip files; keep path
            pass
    return data


def _embed_file(rel_path: str, report_dir: str) -> str:
    if not rel_path or rel_path.startswith("data:"):
        return rel_path
    full = os.path.join(report_dir, rel_path)
    if not os.path.isfile(full):
        return rel_path
    try:
        return _file_to_data_url(full)
    except Exception:
        return rel_path


# ── Email HTML ─────────────────────────────────────────────────────────────────

def _build_email_html(data: dict) -> str:
    run = data.get("run") or {}
    total = run.get("totalTests", 0)
    passed = run.get("passed", 0)
    failed = run.get("failed", 0)
    skipped = run.get("skipped", 0)

    def pct(n):
        return f"{round(n / total * 100)}%" if total else "0%"

    ts = run.get("timestamp", "")
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        start_str = dt.strftime("%Y-%m-%d %H:%M:%S UTC")
    except Exception:
        start_str = ts

    dur_ms = run.get("duration", 0)
    duration_str = _fmt_dur(dur_ms)
    logo = _DEFAULT_LOGO_B64

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pulse Report Summary</title>
<style>
@keyframes slideUpFade{{0%{{opacity:0;transform:translateY(20px)}}100%{{opacity:1;transform:translateY(0)}}}}
@keyframes gentlePulse{{0%,100%{{transform:scale(1)}}50%{{transform:scale(1.05)}}}}
@keyframes popIn{{0%{{opacity:0;transform:scale(.5)}}80%{{transform:scale(1.1)}}100%{{opacity:1;transform:scale(1)}}}}
.anim-card{{animation:slideUpFade .8s ease-out forwards}}
.anim-logo{{animation:gentlePulse 3s infinite ease-in-out}}
.anim-row-1{{animation:slideUpFade .5s ease-out .2s backwards}}
.anim-row-2{{animation:slideUpFade .5s ease-out .3s backwards}}
.anim-row-3{{animation:slideUpFade .5s ease-out .4s backwards}}
.anim-row-4{{animation:slideUpFade .5s ease-out .5s backwards}}
.anim-badge{{animation:popIn .6s cubic-bezier(.68,-.55,.265,1.55) .6s backwards}}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6;padding:40px 0">
  <tr><td align="center">
    <table class="anim-card" role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"
           style="max-width:600px;background-color:#ffffff;border-radius:12px;box-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -2px rgba(0,0,0,.05);overflow:hidden">
      <tr><td height="6" style="background-color:#4f46e5"></td></tr>
      <tr>
        <td style="padding:32px 32px 20px 32px">
          <table border="0" cellspacing="0" cellpadding="0" width="100%">
            <tr>
              <td width="55" style="vertical-align:middle;padding-right:16px">
                <img class="anim-logo" src="{logo}" alt="Pulse" height="40"
                     style="display:block;border:0;border-radius:8px">
              </td>
              <td style="vertical-align:middle">
                <h1 style="margin:0;font-size:24px;font-weight:700;color:#111827">Pulse Report</h1>
                <p style="margin:4px 0 0;font-size:14px;color:#6b7280">Automated Execution Report</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 20px 32px">
          <table width="100%" border="0" cellspacing="0" cellpadding="0"
                 style="background-color:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
            <tr>
              <td style="padding:16px;border-right:1px solid #e5e7eb;width:50%">
                <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:600">Start Time</p>
                <p style="margin:0;font-size:14px;color:#374151;font-weight:500">{_esc(start_str)}</p>
              </td>
              <td style="padding:16px;width:50%">
                <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:600">Duration</p>
                <p style="margin:0;font-size:14px;color:#374151;font-weight:500">{_esc(duration_str)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 32px 32px">
          <table width="100%" border="0" cellspacing="0" cellpadding="0">
            <tr class="anim-row-1">
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#4b5563">Total Tests Executed</td>
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-size:14px;font-weight:600;color:#111827">{total}</td>
            </tr>
            <tr class="anim-row-2">
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#4b5563">Tests Passed</td>
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;text-align:right">
                <span class="anim-badge" style="background-color:#d1fae5;color:#065f46;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:600;display:inline-block;white-space:nowrap">
                  {passed} ({pct(passed)})
                </span>
              </td>
            </tr>
            <tr class="anim-row-3">
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#4b5563">Tests Failed</td>
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;text-align:right">
                <span class="anim-badge" style="background-color:#fee2e2;color:#991b1b;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:600;display:inline-block;white-space:nowrap">
                  {failed} ({pct(failed)})
                </span>
              </td>
            </tr>
            <tr class="anim-row-4">
              <td style="padding:12px 0;font-size:14px;color:#4b5563">Tests Skipped</td>
              <td style="padding:12px 0;text-align:right">
                <span class="anim-badge" style="background-color:#fef3c7;color:#92400e;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:600;display:inline-block;white-space:nowrap">
                  {skipped} ({pct(skipped)})
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background-color:#f9fafb;padding:20px;text-align:center;border-top:1px solid #e5e7eb">
          <p style="margin:0;font-size:12px;color:#9ca3af">Generated by Pulse Report (pytest-pulse-report)</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""


def _fmt_dur(ms: float) -> str:
    if ms < 1000:
        return f"{ms:.0f}ms"
    if ms < 60000:
        return f"{ms / 1000:.1f}s"
    mins = int(ms / 60000)
    secs = (ms % 60000) / 1000
    return f"{mins}m {secs:.0f}s"


# ── CSS ────────────────────────────────────────────────────────────────────────
_CSS = """
:root {
  --primary-color:#f9fafb;--primary-dark:#e5e7eb;--primary-light:#ffffff;
  --secondary-color:#d1d5db;--secondary-dark:#9ca3af;--secondary-light:#f3f4f6;
  --accent-color:#ffffff;--accent-alt:#a3a3a3;
  --success-color:#34d399;--success-dark:#10b981;--success-light:#6ee7b7;
  --danger-color:#f87171;--danger-dark:#ef4444;--danger-light:#fca5a5;
  --warning-color:#fbbf24;--warning-dark:#f59e0b;--warning-light:#fcd34d;
  --info-color:#9ca3af;--flaky-color:#00ccd3;
  --text-primary:#f9fafb;--text-secondary:#e5e7eb;--text-tertiary:#d1d5db;
  --bg-primary:#000000;--bg-secondary:#0a0a0a;--bg-tertiary:#050505;
  --bg-card:#0d0d0d;--bg-card-hover:#121212;
  --border-light:#1a1a1a;--border-medium:#262626;--border-dark:#333333;
  --light-gray-color:#262626;--medium-gray-color:#333333;--dark-gray-color:#a3a3a3;
  --text-color:#f9fafb;--text-color-secondary:#e5e7eb;--border-color:#262626;
  --card-background-color:#0d0d0d;
  --neutral-100:#171717;--neutral-200:#262626;--neutral-300:#404040;
  --bg-hover:#171717;
  --font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg-primary);color:var(--text-color);font-family:var(--font-family);font-size:14px;line-height:1.5}
.container{max-width:1600px;margin:0 auto;padding:24px}
.header{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;background:var(--bg-card);border-radius:12px;margin-bottom:20px;border:1px solid var(--border-medium)}
.header-title{display:flex;align-items:center;gap:12px}
.header-title h1{font-size:1.5rem;font-weight:700;color:var(--text-primary)}
#report-logo{height:40px;width:auto;border-radius:8px}
.run-info{display:flex;gap:24px}
.run-info-item{display:flex;flex-direction:column}
.run-info-item strong{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-color-secondary)}
.run-info-item span{font-size:.9rem;color:var(--text-primary)}
.report-description{margin:0 0 24px;padding:18px 24px;background:var(--bg-card);border:1px solid var(--border-color);border-left:4px solid #764ba2;border-radius:8px;display:flex;align-items:flex-start;gap:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1)}
.tabs{display:flex;gap:4px;margin-bottom:20px;background:var(--bg-card);padding:6px;border-radius:10px;border:1px solid var(--border-medium)}
.tab-button{flex:1;padding:10px 16px;background:transparent;color:var(--text-color-secondary);border:none;border-radius:8px;cursor:pointer;font-size:.875rem;font-weight:600;font-family:var(--font-family);transition:all .2s}
.tab-button:hover{background:var(--bg-hover);color:var(--text-primary)}
.tab-button.active{background:var(--border-medium);color:var(--text-primary)}
.tab-content{display:none}
.tab-content.active{display:block}
.dashboard-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.summary-card{background:var(--bg-card);border:1px solid var(--border-medium);border-radius:12px;padding:20px;transition:transform .2s,box-shadow .2s}
.summary-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.summary-card h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-color-secondary);margin-bottom:8px}
.summary-card .value{font-size:2rem;font-weight:700;color:var(--text-primary)}
.summary-card .trend-percentage{font-size:.8rem;color:var(--text-color-secondary);margin-top:4px}
.status-passed{border-left:3px solid var(--success-color)}
.status-failed{border-left:3px solid var(--danger-color)}
.status-skipped{border-left:3px solid var(--warning-color)}
.flaky-status{border-left:3px solid var(--flaky-color)}
.dashboard-bottom-row{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:1024px){.dashboard-bottom-row{grid-template-columns:1fr}}
.chart-card{background:var(--bg-card);border:1px solid var(--border-medium);border-radius:12px;padding:20px}
.chart-title-header{font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:16px}
.trend-charts-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
@media(max-width:768px){.trend-charts-row{grid-template-columns:1fr}}
.trend-chart{background:var(--bg-card);border:1px solid var(--border-medium);border-radius:12px;padding:20px}
.env-card{background:var(--bg-card);border:1px solid var(--border-medium);border-radius:12px;padding:20px}
.env-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.env-item label{font-size:.75rem;color:var(--text-color-secondary);display:block}
.env-item span{font-size:.875rem;color:var(--text-primary);font-family:monospace}
.filters{display:flex;gap:12px;flex-wrap:wrap;padding:16px;background:var(--bg-card);border-radius:10px;margin-bottom:16px;border:1px solid var(--border-medium)}
.filters input,.filters select{background:var(--bg-secondary);border:1px solid var(--border-dark);color:var(--text-primary);padding:8px 12px;border-radius:8px;font-size:.875rem;font-family:var(--font-family);flex:1;min-width:180px}
.filters input:focus,.filters select:focus{outline:none;border-color:#764ba2}
.clear-filters-btn{padding:8px 16px;background:var(--border-dark);color:var(--text-primary);border:none;border-radius:8px;cursor:pointer;font-size:.875rem;white-space:nowrap}
.clear-filters-btn:hover{background:var(--neutral-300)}
.test-case{background:var(--bg-card);border:1px solid var(--border-medium);border-radius:10px;margin-bottom:12px;overflow:hidden;transition:border-color .2s}
.test-case:hover{border-color:var(--border-dark)}
.test-case-header{display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;user-select:none}
.test-case-header:hover{background:var(--bg-hover)}
.status-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:9999px;font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.status-passed-badge{background:rgba(52,211,153,.15);color:#34d399}
.status-failed-badge{background:rgba(248,113,113,.15);color:#f87171}
.status-skipped-badge{background:rgba(251,191,36,.15);color:#fbbf24}
.status-flaky-badge{background:rgba(0,204,211,.15);color:#00ccd3}
.test-name{flex:1;font-weight:500;color:var(--text-primary);word-break:break-word}
.test-meta{display:flex;gap:12px;align-items:center;flex-shrink:0}
.test-duration{font-size:.8rem;color:var(--text-color-secondary)}
.test-browser{font-size:.8rem;color:var(--dark-gray-color);padding:2px 8px;background:var(--neutral-200);border-radius:4px}
.chevron{width:16px;height:16px;color:var(--text-color-secondary);flex-shrink:0;transition:transform .2s}
.test-case.expanded .chevron{transform:rotate(180deg)}
.test-case-body{display:none;padding:0 16px 16px;border-top:1px solid var(--border-light)}
.test-case.expanded .test-case-body{display:block}
.detail-section{margin-top:14px}
.detail-section h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-color-secondary);margin-bottom:8px}
.error-block{background:#1a0a0a;border:1px solid #3d1515;border-radius:8px;padding:12px;font-family:monospace;font-size:.8rem;color:#f87171;white-space:pre-wrap;overflow-x:auto;max-height:300px;overflow-y:auto}
.stack-block{background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:8px;padding:12px;font-family:monospace;font-size:.75rem;color:var(--text-color-secondary);white-space:pre-wrap;overflow-x:auto;max-height:250px;overflow-y:auto}
.steps-list{list-style:none;border:1px solid var(--border-light);border-radius:8px;overflow:hidden}
.step-item{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border-light);font-size:.8rem}
.step-item:last-child{border-bottom:none}
.step-item.step-hook{opacity:.7;font-style:italic}
.step-status{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px}
.step-status-passed{background:var(--success-color)}
.step-status-failed{background:var(--danger-color)}
.step-status-skipped{background:var(--warning-color)}
.step-content{flex:1}
.step-title{color:var(--text-primary)}
.step-duration{color:var(--text-color-secondary);font-size:.75rem;margin-left:auto;flex-shrink:0}
.step-location{font-size:.7rem;color:var(--dark-gray-color);font-family:monospace;margin-top:2px}
.nested-steps{padding-left:20px;margin-top:4px;border-left:2px solid var(--border-light)}
.screenshots-grid{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.screenshot-thumb{width:120px;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid var(--border-medium);transition:border-color .2s,transform .2s}
.screenshot-thumb:hover{border-color:#764ba2;transform:scale(1.04)}
.video-player{width:100%;max-width:480px;border-radius:8px;border:1px solid var(--border-medium)}
.trace-link{display:inline-flex;align-items:center;gap:6px;color:#764ba2;text-decoration:none;padding:6px 12px;border:1px solid #764ba2;border-radius:6px;font-size:.8rem}
.trace-link:hover{background:rgba(119,55,191,.1)}
.tags-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.tag-badge{padding:2px 8px;background:rgba(119,55,191,.15);color:#a855f7;border-radius:4px;font-size:.72rem}
.severity-badge{padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:600}
.sev-critical{background:rgba(239,68,68,.2);color:#ef4444}
.sev-high{background:rgba(245,101,16,.2);color:#f97316}
.sev-medium{background:rgba(234,179,8,.2);color:#eab308}
.sev-low{background:rgba(59,130,246,.2);color:#60a5fa}
.sev-minor{background:rgba(156,163,175,.2);color:#9ca3af}
.suite-item{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-light)}
.suite-item:last-child{border-bottom:none}
.suite-name{font-weight:500;color:var(--text-primary)}
.suite-stats{display:flex;gap:8px;font-size:.8rem}
.modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center}
.modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.8);cursor:pointer}
.modal-content{position:relative;z-index:1;max-width:90vw;max-height:90vh;background:var(--bg-card);border-radius:12px;overflow:auto;padding:24px}
.modal-close{position:absolute;top:12px;right:12px;background:var(--border-dark);border:none;color:var(--text-primary);width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
.ai-tab{padding:0}
.ai-section-header{font-size:1.2rem;font-weight:700;color:var(--text-primary);margin-bottom:16px}
.ai-test-card{background:var(--bg-card);border:1px solid var(--border-medium);border-radius:10px;padding:16px;margin-bottom:12px}
.ai-test-name{font-weight:600;color:var(--text-primary);margin-bottom:8px}
.ai-error-preview{font-family:monospace;font-size:.75rem;color:var(--danger-color);background:#1a0a0a;padding:8px;border-radius:6px;margin-bottom:10px;white-space:pre-wrap;max-height:100px;overflow-y:auto}
.ai-analyze-btn{padding:8px 16px;background:#764ba2;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.8rem;font-family:var(--font-family)}
.ai-analyze-btn:hover{background:#8b5cf6}
.ai-analyze-btn:disabled{opacity:.5;cursor:not-allowed}
.ai-result{margin-top:10px;padding:12px;background:var(--bg-secondary);border-radius:8px;font-size:.85rem;color:var(--text-primary);line-height:1.6;white-space:pre-wrap}
.ai-config{background:var(--bg-card);border:1px solid var(--border-medium);border-radius:10px;padding:20px;margin-bottom:20px}
.ai-config h3{color:var(--text-primary);margin-bottom:12px}
.ai-config input,.ai-config select{background:var(--bg-secondary);border:1px solid var(--border-dark);color:var(--text-primary);padding:8px 12px;border-radius:8px;font-size:.875rem;width:100%;margin-bottom:8px}
.no-failures{text-align:center;padding:40px;color:var(--text-color-secondary)}
.load-more-btn{padding:10px 24px;background:var(--border-dark);color:var(--text-primary);border:none;border-radius:8px;cursor:pointer;font-size:.875rem;font-family:var(--font-family)}
.load-more-btn:hover{background:var(--neutral-300)}
"""

# ── JavaScript ─────────────────────────────────────────────────────────────────
_JS = r"""
(function() {
  'use strict';

  const D = PULSE_DATA;
  const run = D.run || {};
  const results = D.results || [];
  const meta = D.metadata || {};

  // ── Utilities ──────────────────────────────────────────────────────────────
  function fmtDur(ms) {
    if (!ms || ms < 0) return '0.0s';
    if (ms < 1000) return ms.toFixed(0) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    var m = Math.floor(ms / 60000);
    var s = ((ms % 60000) / 1000).toFixed(0);
    return m + 'm ' + s + 's';
  }

  function fmtDate(isoStr) {
    if (!isoStr) return 'N/A';
    try { return new Date(isoStr).toLocaleString(); } catch(e) { return isoStr; }
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function statusBadge(status) {
    var map = {
      passed: ['status-passed-badge', '✓ Passed'],
      failed: ['status-failed-badge', '✗ Failed'],
      skipped: ['status-skipped-badge', '⊘ Skipped'],
      flaky:  ['status-flaky-badge', '⚡ Flaky'],
      'expected-failure':['status-skipped-badge','⊘ xfail'],
      'unexpected-success':['status-flaky-badge','! xpass'],
    };
    var pair = map[status] || ['status-skipped-badge', status];
    return '<span class="status-badge ' + pair[0] + '">' + pair[1] + '</span>';
  }

  function severityBadge(sev) {
    var map = {Critical:'sev-critical',High:'sev-high',Medium:'sev-medium',Low:'sev-low',Minor:'sev-minor'};
    var cls = map[sev] || 'sev-minor';
    return sev ? '<span class="severity-badge ' + cls + '">' + esc(sev) + '</span>' : '';
  }

  // ── Run info bar ───────────────────────────────────────────────────────────
  (function renderRunInfo() {
    var el = document.getElementById('run-info-bar');
    if (!el) return;
    el.innerHTML =
      '<div class="run-info-item"><strong>Run Date</strong><span>' + fmtDate(run.timestamp) + '</span></div>' +
      '<div class="run-info-item"><strong>Total Duration</strong><span>' + fmtDur(run.duration) + '</span></div>';
  })();

  // ── Summary cards ──────────────────────────────────────────────────────────
  (function renderCards() {
    var el = document.getElementById('summary-cards');
    if (!el) return;
    var total = run.totalTests || 0;
    var passed = run.passed || 0;
    var failed = run.failed || 0;
    var skipped = run.skipped || 0;
    var flaky = run.flaky || 0;
    function pct(n) { return total ? (n/total*100).toFixed(1)+'%' : '0%'; }
    var retried = results.filter(function(r){return r.retries > 0;}).length;
    var totalRetries = results.reduce(function(s,r){return s + (r.retries||0);}, 0);
    var avgDur = total ? fmtDur(run.duration / total) : '0s';

    // Browser breakdown
    var browsers = {};
    results.forEach(function(r){ var b = r.browser||'unknown'; browsers[b] = (browsers[b]||0)+1; });
    var bList = Object.entries(browsers).sort(function(a,b){return b[1]-a[1];});
    var bHtml = bList.slice(0,3).map(function(e){
      return '<div class="suite-item" style="padding:4px 0"><span class="suite-name" style="font-size:.82rem">' + esc(e[0]) + '</span>' +
             '<span class="suite-stats"><span>' + (total ? (e[1]/total*100).toFixed(0)+'%' : '0%') + ' (' + e[1] + ')</span></span></div>';
    }).join('');
    if (bList.length > 3) bHtml += '<div style="opacity:.6;font-size:.75rem;text-align:center;margin-top:4px">+' + (bList.length-3) + ' more</div>';

    el.innerHTML =
      '<div class="summary-card"><h3>Total Tests</h3><div class="value">' + total + '</div></div>' +
      '<div class="summary-card status-passed"><h3>Passed</h3><div class="value">' + passed + '</div><div class="trend-percentage">' + pct(passed) + '</div></div>' +
      '<div class="summary-card status-failed"><h3>Failed</h3><div class="value">' + failed + '</div><div class="trend-percentage">' + pct(failed) + '</div></div>' +
      '<div class="summary-card status-skipped"><h3>Skipped</h3><div class="value">' + skipped + '</div><div class="trend-percentage">' + pct(skipped) + '</div></div>' +
      '<div class="summary-card flaky-status"><h3>Flaky</h3><div class="value">' + flaky + '</div><div class="trend-percentage">' + pct(flaky) + '</div></div>' +
      '<div class="summary-card"><h3>Run Duration</h3><div class="value">' + fmtDur(run.duration) + '</div><div class="trend-percentage">Avg. ' + avgDur + ' / test</div></div>' +
      '<div class="summary-card"><h3>Total Retries</h3><div class="value">' + totalRetries + '</div><div class="trend-percentage">Tests retried: ' + retried + '</div></div>' +
      '<div class="summary-card"><h3>🌐 Browsers <span style="font-size:.7em;font-weight:400;color:var(--text-color-secondary)">(' + bList.length + ')</span></h3><div>' + bHtml + '</div></div>';
  })();

  // ── Environment section ────────────────────────────────────────────────────
  (function renderEnv() {
    var el = document.getElementById('env-section');
    if (!el) return;
    var env = run.environment;
    if (!env) { el.innerHTML = ''; return; }
    var envs = Array.isArray(env) ? env : [env];
    var html = envs.map(function(e) {
      if (!e) return '';
      var cpu = e.cpu ? (esc(e.cpu.model) + ' (' + (e.cpu.cores||'?') + ' cores)') : 'N/A';
      return '<div class="env-card" style="margin-bottom:12px">' +
        '<h3 class="chart-title-header" style="font-size:.9rem;margin-bottom:12px">🖥 Environment: ' + esc(e.host||'unknown') + '</h3>' +
        '<div class="env-grid">' +
          '<div class="env-item"><label>OS</label><span>' + esc(e.os) + '</span></div>' +
          '<div class="env-item"><label>CPU</label><span>' + cpu + '</span></div>' +
          '<div class="env-item"><label>Memory</label><span>' + esc(e.memory) + '</span></div>' +
          '<div class="env-item"><label>Runtime</label><span>' + esc(e.node) + '</span></div>' +
          '<div class="env-item"><label>CWD</label><span style="font-size:.7rem;word-break:break-all">' + esc(e.cwd) + '</span></div>' +
        '</div></div>';
    }).join('');
    el.innerHTML = html;
  })();

  // ── Pie chart ──────────────────────────────────────────────────────────────
  (function renderPie() {
    if (typeof Highcharts === 'undefined') return;
    var passed = run.passed||0, failed = run.failed||0, skipped = run.skipped||0, flaky = run.flaky||0;
    Highcharts.chart('pie-chart', {
      chart: { type: 'pie', backgroundColor: 'transparent', style:{fontFamily:"var(--font-family)"} },
      title: { text: null },
      tooltip: { pointFormat: '<b>{point.name}</b>: {point.y} ({point.percentage:.1f}%)' },
      plotOptions: { pie: { dataLabels: { enabled: true, color: '#e5e7eb',
        format: '<b>{point.name}</b>: {point.percentage:.1f}%' },
        borderWidth: 0, shadow: false } },
      series: [{ name: 'Tests', colorByPoint: true, data: [
        { name: 'Passed', y: passed, color: '#34d399' },
        { name: 'Failed', y: failed, color: '#f87171' },
        { name: 'Skipped', y: skipped, color: '#fbbf24' },
        { name: 'Flaky', y: flaky, color: '#00ccd3' },
      ].filter(function(d){return d.y > 0;}) }],
      credits: { enabled: false },
      legend: { itemStyle: { color: '#e5e7eb' } }
    });
  })();

  // ── Suites widget ──────────────────────────────────────────────────────────
  (function renderSuites() {
    var el = document.getElementById('suites-widget');
    if (!el) return;
    var suites = {};
    results.forEach(function(r) {
      var s = r.suiteName || 'Default';
      if (!suites[s]) suites[s] = {passed:0,failed:0,skipped:0,flaky:0,total:0};
      var st = r.final_status || r.status || 'skipped';
      suites[s][st] = (suites[s][st]||0) + 1;
      suites[s].total++;
    });
    var html = Object.entries(suites).map(function(e) {
      var n = e[0], s = e[1];
      return '<div class="suite-item">' +
        '<span class="suite-name">' + esc(n) + '</span>' +
        '<div class="suite-stats">' +
          (s.passed ? '<span style="color:var(--success-color)">✓ '+s.passed+'</span>' : '') +
          (s.failed ? '<span style="color:var(--danger-color)">✗ '+s.failed+'</span>' : '') +
          (s.flaky  ? '<span style="color:var(--flaky-color)">⚡ '+s.flaky+'</span>' : '') +
          (s.skipped ? '<span style="color:var(--warning-color)">⊘ '+s.skipped+'</span>' : '') +
        '</div></div>';
    }).join('');
    el.innerHTML = html || '<div style="color:var(--text-color-secondary)">No suite data</div>';
  })();

  // ── Severity chart ─────────────────────────────────────────────────────────
  (function renderSeverityChart() {
    if (typeof Highcharts === 'undefined') return;
    var sevs = {Critical:0,High:0,Medium:0,Low:0,Minor:0};
    results.forEach(function(r){ var s = r.severity||'Medium'; sevs[s] = (sevs[s]||0)+1; });
    var colors = {Critical:'#ef4444',High:'#f97316',Medium:'#eab308',Low:'#60a5fa',Minor:'#9ca3af'};
    var data = Object.entries(sevs).filter(function(e){return e[1]>0;})
      .map(function(e){ return {name:e[0], y:e[1], color:colors[e[0]]||'#9ca3af'}; });
    if (!data.length) return;
    Highcharts.chart('severity-chart', {
      chart:{type:'bar',backgroundColor:'transparent',style:{fontFamily:"var(--font-family)"}},
      title:{text:null},
      xAxis:{categories:data.map(function(d){return d.name;}),labels:{style:{color:'#e5e7eb'}}},
      yAxis:{title:{text:null},labels:{style:{color:'#e5e7eb'}},gridLineColor:'#262626'},
      plotOptions:{bar:{dataLabels:{enabled:true,color:'#e5e7eb'},colorByPoint:true,borderWidth:0}},
      series:[{name:'Tests',data:data,showInLegend:false}],
      credits:{enabled:false}
    });
  })();

  // ── Spec duration chart ────────────────────────────────────────────────────
  (function renderSpecDuration() {
    if (typeof Highcharts === 'undefined') return;
    var specs = {};
    results.forEach(function(r){
      var f = r.spec_file||'unknown';
      specs[f] = (specs[f]||0) + (r.duration||0);
    });
    var sorted = Object.entries(specs).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
    if (!sorted.length) return;
    Highcharts.chart('spec-duration-chart', {
      chart:{type:'bar',backgroundColor:'transparent',style:{fontFamily:"var(--font-family)"}},
      title:{text:null},
      xAxis:{categories:sorted.map(function(e){return e[0];}),labels:{style:{color:'#e5e7eb'},overflow:'justify'}},
      yAxis:{title:{text:'Duration (ms)'},labels:{style:{color:'#e5e7eb'},formatter:function(){return fmtDur(this.value);}},gridLineColor:'#262626'},
      tooltip:{formatter:function(){return '<b>'+this.x+'</b><br>'+fmtDur(this.y);}},
      plotOptions:{bar:{dataLabels:{enabled:true,formatter:function(){return fmtDur(this.y);},style:{color:'#e5e7eb'}},borderWidth:0,color:'#764ba2'}},
      series:[{name:'Duration',data:sorted.map(function(e){return e[1];})}],
      credits:{enabled:false}
    });
  })();

  // ── Describe duration chart ────────────────────────────────────────────────
  (function renderDescribeDuration() {
    if (typeof Highcharts === 'undefined') return;
    var desc = {};
    results.forEach(function(r){
      var d = r.describe||'n/a';
      desc[d] = (desc[d]||0) + (r.duration||0);
    });
    var sorted = Object.entries(desc).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
    if (!sorted.length) return;
    Highcharts.chart('describe-duration-chart', {
      chart:{type:'bar',backgroundColor:'transparent',style:{fontFamily:"var(--font-family)"}},
      title:{text:null},
      xAxis:{categories:sorted.map(function(e){return e[0];}),labels:{style:{color:'#e5e7eb'}}},
      yAxis:{title:{text:'Duration (ms)'},labels:{style:{color:'#e5e7eb'},formatter:function(){return fmtDur(this.value);}},gridLineColor:'#262626'},
      tooltip:{formatter:function(){return '<b>'+this.x+'</b><br>'+fmtDur(this.y);}},
      plotOptions:{bar:{dataLabels:{enabled:true,formatter:function(){return fmtDur(this.y);},style:{color:'#e5e7eb'}},borderWidth:0,color:'#00ccd3'}},
      series:[{name:'Duration',data:sorted.map(function(e){return e[1];})}],
      credits:{enabled:false}
    });
  })();

  // ── Worker distribution chart ──────────────────────────────────────────────
  (function renderWorkerChart() {
    if (typeof Highcharts === 'undefined') return;
    var workers = {};
    results.forEach(function(r){
      var w = 'Worker ' + (r.workerId||1);
      workers[w] = (workers[w]||0) + 1;
    });
    var sorted = Object.entries(workers).sort(function(a,b){return a[0].localeCompare(b[0]);});
    if (sorted.length <= 1) return;
    Highcharts.chart('worker-chart', {
      chart:{type:'column',backgroundColor:'transparent',style:{fontFamily:"var(--font-family)"}},
      title:{text:null},
      xAxis:{categories:sorted.map(function(e){return e[0];}),labels:{style:{color:'#e5e7eb'}}},
      yAxis:{title:{text:'Tests'},labels:{style:{color:'#e5e7eb'}},gridLineColor:'#262626'},
      plotOptions:{column:{dataLabels:{enabled:true,style:{color:'#e5e7eb'}},borderWidth:0,color:'#764ba2'}},
      series:[{name:'Tests',data:sorted.map(function(e){return e[1];})}],
      credits:{enabled:false}
    });
  })();

  // ── Test case list ─────────────────────────────────────────────────────────
  var allTests = results.slice();
  var filteredTests = allTests.slice();
  var renderedCount = 0;
  var PAGE_SIZE = 50;

  function buildBrowserOptions() {
    var sel = document.getElementById('filter-browser');
    if (!sel) return;
    var browsers = Array.from(new Set(results.map(function(r){return r.browser||'unknown';})));
    browsers.forEach(function(b) {
      var opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      sel.appendChild(opt);
    });
  }
  buildBrowserOptions();

  function renderTestCase(t, idx) {
    var st = t.final_status || t.status || 'skipped';
    var hasTags = t.tags && t.tags.length;
    var hasAnnotations = t.annotations && t.annotations.length;
    var tagsHtml = hasTags ? '<div class="tags-row">' + t.tags.map(function(tag){return '<span class="tag-badge">@'+esc(tag)+'</span>';}).join('') + '</div>' : '';
    var annHtml = hasAnnotations ? '<div class="tags-row">' + t.annotations.map(function(a){
      return '<span class="tag-badge" style="background:rgba(99,102,241,.15);color:#818cf8">' + esc(a.type) + (a.description ? ': '+esc(a.description) : '') + '</span>';
    }).join('') + '</div>' : '';

    // Steps
    var stepsHtml = '';
    if (t.steps && t.steps.length) {
      stepsHtml = '<div class="detail-section"><h4>Steps (' + t.steps.length + ')</h4><ul class="steps-list">' +
        t.steps.map(function(s){return renderStep(s, t.browser||'');}).join('') + '</ul></div>';
    }

    // Error
    var errHtml = '';
    if (t.errorMessage) {
      errHtml = '<div class="detail-section"><h4>Error</h4><div class="error-block">' + esc(t.errorMessage) + '</div></div>';
    }
    if (t.stackTrace) {
      errHtml += '<div class="detail-section"><h4>Stack Trace</h4><div class="stack-block">' + esc(t.stackTrace) + '</div></div>';
    }

    // Screenshots
    var screenshotsHtml = '';
    if (t.screenshots && t.screenshots.length) {
      screenshotsHtml = '<div class="detail-section"><h4>Screenshots (' + t.screenshots.length + ')</h4><div class="screenshots-grid">' +
        t.screenshots.map(function(src){
          return '<img class="screenshot-thumb" src="' + esc(src) + '" alt="screenshot" onclick="openModal(\'img\',\''+esc(src)+'\')">';
        }).join('') + '</div></div>';
    }

    // Videos
    var videosHtml = '';
    if (t.videoPath && t.videoPath.length) {
      videosHtml = '<div class="detail-section"><h4>Videos</h4>' +
        t.videoPath.map(function(src){
          return '<video class="video-player" controls src="' + esc(src) + '"></video>';
        }).join('') + '</div>';
    }

    // Trace
    var traceHtml = '';
    if (t.tracePath) {
      traceHtml = '<div class="detail-section"><h4>Trace</h4><a class="trace-link" href="' + esc(t.tracePath) + '" download>⬇ Download trace.zip</a></div>';
    }

    // Retry history
    var retryHtml = '';
    if (t.retryHistory && t.retryHistory.length) {
      retryHtml = '<div class="detail-section"><h4>Retry History (' + t.retryHistory.length + ' previous attempts)</h4>' +
        t.retryHistory.map(function(r, i){
          return '<div style="padding:8px;background:var(--bg-secondary);border-radius:6px;margin-top:6px;font-size:.8rem">' +
            '<span style="font-weight:600">Attempt ' + (i+1) + ':</span> ' + statusBadge(r.status) +
            ' &nbsp; <span style="color:var(--text-color-secondary)">' + fmtDur(r.duration) + '</span>' +
            (r.errorMessage ? '<div class="error-block" style="margin-top:6px;max-height:80px">' + esc(r.errorMessage) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>';
    }

    // stdout
    var stdoutHtml = '';
    if (t.stdout && t.stdout.length) {
      stdoutHtml = '<div class="detail-section"><h4>Stdout</h4><div class="stack-block">' + esc(t.stdout.join('\n')) + '</div></div>';
    }

    // Meta row
    var specHtml = t.spec_file ? '<span style="color:var(--dark-gray-color);font-family:monospace;font-size:.75rem">' + esc(t.spec_file) + '</span>' : '';

    return '<div class="test-case" id="tc-' + idx + '">' +
      '<div class="test-case-header" onclick="toggleCase(' + idx + ')">' +
        statusBadge(st) +
        '<div class="test-name">' + esc(t.name) + '</div>' +
        '<div class="test-meta">' +
          severityBadge(t.severity) + '&nbsp;' +
          specHtml + '&nbsp;' +
          '<span class="test-duration">' + fmtDur(t.duration) + '</span>' +
          '<span class="test-browser">' + esc(t.browser||'unknown') + '</span>' +
          '<svg class="chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>' +
        '</div>' +
      '</div>' +
      '<div class="test-case-body">' +
        tagsHtml + annHtml +
        errHtml + screenshotsHtml + videosHtml + traceHtml +
        stepsHtml + retryHtml + stdoutHtml +
      '</div>' +
    '</div>';
  }

  function renderStep(s, browser) {
    var st = s.status || 'passed';
    var cls = 'step-status-' + st;
    var hookCls = s.isHook ? ' step-hook' : '';
    var nested = (s.steps && s.steps.length) ?
      '<div class="nested-steps"><ul class="steps-list">' + s.steps.map(function(ns){return renderStep(ns,browser);}).join('') + '</ul></div>' : '';
    return '<li class="step-item' + hookCls + '">' +
      '<div class="step-status ' + cls + '"></div>' +
      '<div class="step-content">' +
        '<span class="step-title">' + esc(s.title) + '</span>' +
        (s.codeLocation ? '<div class="step-location">' + esc(s.codeLocation) + '</div>' : '') +
        (s.errorMessage ? '<div class="error-block" style="margin-top:4px;font-size:.72rem;max-height:60px">' + esc(s.errorMessage) + '</div>' : '') +
        nested +
      '</div>' +
      '<span class="step-duration">' + fmtDur(s.duration) + '</span>' +
    '</li>';
  }

  function renderBatch(tests, startIdx) {
    return tests.map(function(t, i){ return renderTestCase(t, startIdx + i); }).join('');
  }

  function applyFilters() {
    var nameVal = (document.getElementById('filter-name').value||'').toLowerCase();
    var stVal   = (document.getElementById('filter-status').value||'').toLowerCase();
    var brVal   = (document.getElementById('filter-browser').value||'').toLowerCase();
    filteredTests = allTests.filter(function(t) {
      var st = (t.final_status || t.status || '').toLowerCase();
      if (nameVal && t.name.toLowerCase().indexOf(nameVal) === -1) return false;
      if (stVal && st !== stVal) return false;
      if (brVal && (t.browser||'').toLowerCase() !== brVal) return false;
      return true;
    });
    renderedCount = 0;
    loadMore(true);
  }

  function loadMore(reset) {
    var container = document.getElementById('test-cases-list');
    if (!container) return;
    var batch = filteredTests.slice(renderedCount, renderedCount + PAGE_SIZE);
    var html = renderBatch(batch, renderedCount);
    if (reset) {
      container.innerHTML = html;
    } else {
      container.insertAdjacentHTML('beforeend', html);
    }
    renderedCount += batch.length;
    var lmw = document.getElementById('load-more-wrapper');
    if (lmw) lmw.style.display = (renderedCount < filteredTests.length) ? 'block' : 'none';
  }

  // Initial render
  loadMore(true);

  document.getElementById('filter-name').addEventListener('input', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-browser').addEventListener('change', applyFilters);
  document.getElementById('clear-run-summary-filters').addEventListener('click', function() {
    document.getElementById('filter-name').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-browser').value = '';
    applyFilters();
  });
  document.getElementById('load-more-tests').addEventListener('click', function() { loadMore(false); });

  // ── Expand/collapse ────────────────────────────────────────────────────────
  window.toggleCase = function(idx) {
    var el = document.getElementById('tc-' + idx);
    if (el) el.classList.toggle('expanded');
  };

  // ── Modal ──────────────────────────────────────────────────────────────────
  window.openModal = function(type, src) {
    var modal = document.getElementById('media-modal');
    var body  = document.getElementById('modal-body');
    if (!modal || !body) return;
    if (type === 'img') {
      body.innerHTML = '<img src="' + esc(src) + '" style="max-width:80vw;max-height:80vh;border-radius:8px">';
    }
    modal.style.display = 'flex';
  };
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('media-modal').style.display = 'none';
  });
  document.getElementById('modal-backdrop').addEventListener('click', function() {
    document.getElementById('media-modal').style.display = 'none';
  });

  // ── Tabs ───────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-button').forEach(function(b){b.classList.remove('active');});
      document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active');});
      btn.classList.add('active');
      var tab = document.getElementById(btn.getAttribute('data-tab'));
      if (tab) tab.classList.add('active');
    });
  });

  // ── AI Failure Analyzer ────────────────────────────────────────────────────
  (function renderAI() {
    var el = document.getElementById('ai-tab-content');
    if (!el) return;
    var failed = results.filter(function(r){ return (r.final_status||r.status) === 'failed'; });
    if (!failed.length) {
      el.innerHTML = '<div class="no-failures">🎉 No failed tests to analyze!</div>';
      return;
    }
    var configHtml = '<div class="ai-config">' +
      '<h3>AI Configuration</h3>' +
      '<select id="ai-provider"><option value="anthropic">Claude (Anthropic)</option><option value="openai">OpenAI</option></select>' +
      '<input type="password" id="ai-key" placeholder="Enter your API key..." autocomplete="off">' +
      '<input type="text" id="ai-model" placeholder="Model (e.g. claude-3-5-haiku-20241022 or gpt-4o-mini)">' +
      '</div>';

    var cardsHtml = failed.map(function(t, i) {
      var errPreview = (t.errorMessage || 'No error message').substring(0, 300);
      return '<div class="ai-test-card" id="ai-card-' + i + '">' +
        '<div class="ai-test-name">' + esc(t.name) + '</div>' +
        '<div class="ai-error-preview">' + esc(errPreview) + (t.errorMessage && t.errorMessage.length > 300 ? '...' : '') + '</div>' +
        '<button class="ai-analyze-btn" onclick="analyzeTest(' + i + ')">🤖 Analyze with AI</button>' +
        '<div id="ai-result-' + i + '" class="ai-result" style="display:none"></div>' +
      '</div>';
    }).join('');

    el.innerHTML = configHtml + '<h2 class="ai-section-header">Failed Tests (' + failed.length + ')</h2>' + cardsHtml;

    window._aiFailedTests = failed;
  })();

  window.analyzeTest = async function(idx) {
    var t = window._aiFailedTests[idx];
    if (!t) return;
    var provider = (document.getElementById('ai-provider')||{}).value || 'anthropic';
    var key = (document.getElementById('ai-key')||{}).value || '';
    var model = (document.getElementById('ai-model')||{}).value || '';
    if (!key) { alert('Please enter your API key'); return; }

    var btn = document.querySelector('#ai-card-' + idx + ' .ai-analyze-btn');
    var resEl = document.getElementById('ai-result-' + idx);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing...'; }
    if (resEl) { resEl.style.display = 'block'; resEl.textContent = 'Analyzing...'; }

    var prompt = 'Analyze this test failure and suggest how to fix it.\n\nTest: ' + t.name +
      '\nFile: ' + (t.spec_file||'unknown') +
      '\nBrowser: ' + (t.browser||'unknown') +
      '\nError: ' + (t.errorMessage||'No error') +
      '\nStack Trace: ' + (t.stackTrace||'No stack trace').substring(0, 1000);

    try {
      var text = '';
      if (provider === 'anthropic') {
        var mdl = model || 'claude-haiku-4-5-20251001';
        var resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
                     'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: mdl, max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }] })
        });
        var data = await resp.json();
        if (data.error) throw new Error(data.error.message);
        text = (data.content && data.content[0] && data.content[0].text) || JSON.stringify(data);
      } else {
        var mdl2 = model || 'gpt-4o-mini';
        var resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model: mdl2, max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }] })
        });
        var data2 = await resp2.json();
        if (data2.error) throw new Error(data2.error.message);
        text = (data2.choices && data2.choices[0] && data2.choices[0].message && data2.choices[0].message.content) || JSON.stringify(data2);
      }
      if (resEl) resEl.textContent = text;
    } catch(err) {
      if (resEl) resEl.textContent = '⚠ Error: ' + err.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Analyze with AI'; }
    }
  };
})();
"""
