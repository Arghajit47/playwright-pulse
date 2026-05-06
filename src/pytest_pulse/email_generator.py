#!/usr/bin/env python3
"""Python port of generate-email-report.mjs — lightweight email HTML summary."""

import asyncio
import base64
import glob
import json
import math
import os
import re
import sys
from datetime import datetime

# ── Logo ───────────────────────────────────────────────────────────────────────
LOGO = "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"

# ── Chalk-like colour helpers ──────────────────────────────────────────────────
class _Chalk:
    @staticmethod
    def green(t): return f"\033[32m{t}\033[0m"
    @staticmethod
    def red(t): return f"\033[31m{t}\033[0m"
    @staticmethod
    def yellow(t): return f"\033[33m{t}\033[0m"
    @staticmethod
    def blue(t): return f"\033[34m{t}\033[0m"
    @staticmethod
    def gray(t): return f"\033[90m{t}\033[0m"
    @staticmethod
    def bold(t): return f"\033[1m{t}\033[0m"

chalk = _Chalk()

# ── Constants ──────────────────────────────────────────────────────────────────
DEFAULT_OUTPUT_DIR = "pulse-report"
MINIFIED_HTML_FILE = "pulse-email-summary.html"

# ── Arg parsing ────────────────────────────────────────────────────────────────
_args = sys.argv[1:]
custom_output_dir = None
for _i in range(len(_args)):
    if _args[_i] in ("--outputDir", "-o") and _i + 1 < len(_args):
        custom_output_dir = _args[_i + 1]
        break


# ── Utility functions ──────────────────────────────────────────────────────────
def sanitize_html(s):
    if s is None:
        return ""
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#x27;"))


def capitalize(s):
    if not s:
        return ""
    return s[0].upper() + s[1:].lower()


def format_duration(ms, precision=1, invalid_input_return="N/A",
                    default_for_null_undefined_negative=None):
    valid_precision = max(0, int(precision))
    zero_with_precision = f"{0:.{valid_precision}f}s"
    resolved_null = (zero_with_precision
                     if default_for_null_undefined_negative is None
                     else default_for_null_undefined_negative)

    if ms is None:
        return resolved_null

    try:
        num_ms = float(ms)
    except (TypeError, ValueError):
        return invalid_input_return

    if math.isnan(num_ms) or not math.isfinite(num_ms):
        return invalid_input_return

    if num_ms < 0:
        return resolved_null

    if num_ms == 0:
        return zero_with_precision

    MS_PER_SECOND = 1000
    SECONDS_PER_MINUTE = 60
    MINUTES_PER_HOUR = 60
    SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR

    total_raw_seconds = num_ms / MS_PER_SECOND

    if (total_raw_seconds < SECONDS_PER_MINUTE
            and math.ceil(total_raw_seconds) < SECONDS_PER_MINUTE):
        return f"{total_raw_seconds:.{valid_precision}f}s"
    else:
        total_ms_rounded = math.ceil(num_ms / MS_PER_SECOND) * MS_PER_SECOND
        remaining = total_ms_rounded

        h = math.floor(remaining / (MS_PER_SECOND * SECONDS_PER_HOUR))
        remaining %= MS_PER_SECOND * SECONDS_PER_HOUR

        m = math.floor(remaining / (MS_PER_SECOND * SECONDS_PER_MINUTE))
        remaining %= MS_PER_SECOND * SECONDS_PER_MINUTE

        s = math.floor(remaining / MS_PER_SECOND)

        parts = []
        if h > 0:
            parts.append(f"{h}h")
        if h > 0 or m > 0 or num_ms >= MS_PER_SECOND * SECONDS_PER_MINUTE:
            parts.append(f"{m}m")
        parts.append(f"{s}s")
        return " ".join(parts)


def format_date(date_str_or_date):
    if not date_str_or_date:
        return "N/A"
    try:
        if isinstance(date_str_or_date, str):
            d = date_str_or_date.replace("Z", "+00:00")
            date = datetime.fromisoformat(d)
        else:
            date = date_str_or_date
        return date.strftime("%m/%d/%y %I:%M %p")
    except Exception:
        return "Invalid Date"


def get_status_class(status):
    s = str(status).lower()
    return {
        "passed": "status-passed",
        "failed": "status-failed",
        "skipped": "status-skipped",
        "flaky": "status-flaky",
    }.get(s, "status-unknown")


def get_status_icon(status):
    s = str(status).lower()
    return {
        "passed": "✅",
        "failed": "❌",
        "skipped": "⏭️",
        "flaky": "⚠",
    }.get(s, "❓")


# ── Static HTML sections ───────────────────────────────────────────────────────
_STYLE_CSS = """    <style>
        :root {
            --primary-color: #2c3e50;
            --secondary-color: #3498db;
            --success-color: #2ecc71;
            --danger-color: #e74c3c;
            --warning-color: #f39c12;
            --light-gray-color: #ecf0f1;
            --medium-gray-color: #bdc3c7;
            --dark-gray-color: #7f8c8d;
            --flaky-color: #00ccd3;
            --text-color: #34495e;
            --background-color: #f8f9fa;
            --card-background-color: #ffffff;
            --border-color: #dfe6e9;
            --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            --border-radius: 6px;
            --box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        body {
            font-family: var(--font-family);
            margin: 0;
            background-color: var(--background-color);
            color: var(--text-color);
            line-height: 1.6;
            font-size: 16px;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background-color: var(--card-background-color);
            padding: 25px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
        }
        .report-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 25px;
            flex-wrap: wrap;
        }
        .report-header-title { display: flex; align-items: center; gap: 12px; }
        .report-header h1 { margin: 0; font-size: 1.75em; font-weight: 600; color: var(--primary-color); }
        #report-logo { height: 40px; width: 55px; }
        .run-info { font-size: 0.9em; text-align: right; color: var(--dark-gray-color); }
        .run-info strong { color: var(--text-color); }
        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background-color: var(--card-background-color);
            border: 1px solid var(--border-color);
            border-left-width: 5px;
            border-left-color: var(--primary-color);
            border-radius: var(--border-radius);
            padding: 18px;
            text-align: center;
        }
        .stat-card h3 { margin: 0 0 8px; font-size: 1em; font-weight: 500; color: var(--dark-gray-color); text-transform: uppercase; }
        .stat-card .value { font-size: 2em; font-weight: 700; color: var(--primary-color); }
        .stat-card.passed { border-left-color: var(--success-color); }
        .stat-card.passed .value { color: var(--success-color); }
        .stat-card.failed { border-left-color: var(--danger-color); }
        .stat-card.failed .value { color: var(--danger-color); }
        .stat-card.skipped { border-left-color: var(--warning-color); }
        .stat-card.skipped .value { color: var(--warning-color); }
        .stat-card.flaky { border-left-color: var(--flaky-color); }
        .stat-card.flaky .value { color: var(--flaky-color); }
        .section-title {
            font-size: 1.5em;
            color: var(--primary-color);
            margin-top: 30px;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--secondary-color);
        }
        .filters-section {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--light-gray-color);
            border-radius: var(--border-radius);
            border: 1px solid var(--border-color);
        }
        .filters-section input[type="text"],
        .filters-section select {
            padding: 8px 12px;
            border: 1px solid var(--medium-gray-color);
            border-radius: 4px;
            font-size: 0.95em;
            flex-grow: 1;
        }
        .filters-section select { min-width: 150px; }
        .filters-section button {
            padding: 8px 15px;
            font-size: 0.95em;
            background-color: var(--secondary-color);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s ease;
        }
        .filters-section button:hover { background-color: var(--primary-color); }
        .browser-section { margin-bottom: 25px; }
        .browser-title {
            font-size: 1.25em;
            color: var(--text-color);
            margin-bottom: 10px;
            padding: 8px 0;
            border-bottom: 1px dashed var(--medium-gray-color);
        }
        .test-list { list-style-type: none; padding-left: 0; }
        .test-item {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            margin-bottom: 8px;
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius);
            background-color: #fff;
            transition: background-color 0.2s ease, display 0.3s ease-out;
        }
        .test-item:hover { background-color: var(--light-gray-color); }
        .test-status-icon { font-size: 1.1em; margin-right: 10px; }
        .test-title-text { flex-grow: 1; font-size: 0.95em; }
        .test-status-label {
            font-size: 0.8em;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 4px;
            color: #fff;
            margin-left: 10px;
            min-width: 60px;
            text-align: center;
        }
        .test-item.status-passed .test-status-label { background-color: var(--success-color); }
        .test-item.status-failed .test-status-label { background-color: var(--danger-color); }
        .test-item.status-skipped .test-status-label { background-color: var(--warning-color); }
        .test-item.status-flaky .test-status-label { background-color: var(--flaky-color); }
        .test-item.status-unknown .test-status-label { background-color: var(--dark-gray-color); }
        .no-tests {
            padding: 20px;
            text-align: center;
            color: var(--dark-gray-color);
            background-color: var(--light-gray-color);
            border-radius: var(--border-radius);
            font-style: italic;
        }
        .report-footer {
            padding: 15px 0;
            margin-top: 30px;
            border-top: 1px solid var(--border-color);
            text-align: center;
            font-size: 0.85em;
            color: var(--dark-gray-color);
        }
        .report-footer a { color: var(--secondary-color); text-decoration: none; font-weight: 600; }
        .report-footer a:hover { text-decoration: underline; }
        @media (max-width: 768px) {
            body { padding: 10px; font-size: 15px; }
            .container { padding: 20px; }
            .report-header { flex-direction: column; align-items: flex-start; gap: 10px; }
            .report-header h1 { font-size: 1.5em; }
            .run-info { text-align: left; }
            .summary-stats { grid-template-columns: 1fr 1fr; }
            .filters-section { flex-direction: column; }
        }
        @media (max-width: 480px) { .summary-stats { grid-template-columns: 1fr; } }
    </style>"""

_CLIENT_SCRIPT = """    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const nameFilterMin = document.getElementById('filter-min-name');
            const statusFilterMin = document.getElementById('filter-min-status');
            const browserFilterMin = document.getElementById('filter-min-browser');
            const clearMinFiltersBtn = document.getElementById('clear-min-filters');
            const testItemsMin = document.querySelectorAll('.test-results-section .test-item');
            const browserSections = document.querySelectorAll('.test-results-section .browser-section');

            function filterMinifiedTests() {
                const nameValue = nameFilterMin.value.toLowerCase();
                const statusValue = statusFilterMin.value;
                const browserValue = browserFilterMin.value;
                let anyBrowserSectionVisible = false;

                browserSections.forEach(section => {
                    let sectionHasVisibleTests = false;
                    const testsInThisSection = section.querySelectorAll('.test-item');
                    testsInThisSection.forEach(testItem => {
                        const testName = testItem.getAttribute('data-test-name-min');
                        const testStatus = testItem.getAttribute('data-status-min');
                        const testBrowser = testItem.getAttribute('data-browser-min');
                        const nameMatch = testName.includes(nameValue);
                        const statusMatch = !statusValue || testStatus === statusValue;
                        const browserMatch = !browserValue || testBrowser === browserValue;
                        if (nameMatch && statusMatch && browserMatch) {
                            testItem.style.display = 'flex';
                            sectionHasVisibleTests = true;
                            anyBrowserSectionVisible = true;
                        } else {
                            testItem.style.display = 'none';
                        }
                    });
                    if (!sectionHasVisibleTests || (browserValue && section.getAttribute('data-browser-group') !== browserValue)) {
                        section.style.display = 'none';
                    } else {
                        section.style.display = '';
                    }
                });
                const noTestsMessage = document.querySelector('.test-results-section .no-tests');
                if (noTestsMessage) {
                    noTestsMessage.style.display = anyBrowserSectionVisible ? 'none' : 'block';
                }
            }

            if (nameFilterMin) nameFilterMin.addEventListener('input', filterMinifiedTests);
            if (statusFilterMin) statusFilterMin.addEventListener('change', filterMinifiedTests);
            if (browserFilterMin) browserFilterMin.addEventListener('change', filterMinifiedTests);
            if (clearMinFiltersBtn) {
                clearMinFiltersBtn.addEventListener('click', () => {
                    nameFilterMin.value = '';
                    statusFilterMin.value = '';
                    browserFilterMin.value = '';
                    filterMinifiedTests();
                });
            }
            if (testItemsMin.length > 0) { filterMinifiedTests(); }
        });
    </script>"""


# ── HTML generator ─────────────────────────────────────────────────────────────
def generate_minified_html(report_data, logo=None):
    if logo is None:
        logo = LOGO

    run = report_data.get("run") or {}
    rs = {
        "totalTests": run.get("totalTests", 0),
        "passed": run.get("passed", 0),
        "failed": run.get("failed", 0),
        "skipped": run.get("skipped", 0),
        "flaky": run.get("flaky", 0),
        "duration": run.get("duration", 0),
        "timestamp": run.get("timestamp", datetime.now().isoformat()),
    }

    tests_by_browser: dict = {}
    all_browsers: list = []
    for test in (report_data.get("results") or []):
        browser = test.get("browser") or "unknown"
        if browser not in tests_by_browser:
            tests_by_browser[browser] = []
            all_browsers.append(browser)
        tests_by_browser[browser].append(test)

    def _severity_color(level):
        return {
            "Minor": "#006064", "Low": "#FFA07A", "Medium": "#577A11",
            "High": "#B71C1C", "Critical": "#64158A",
        }.get(level, "#577A11")

    def generate_test_list_html():
        if not tests_by_browser:
            return '<p class="no-tests">No test results found in this run.</p>'
        html = ""
        for browser, tests in tests_by_browser.items():
            html += (
                '\n        <div class="browser-section" data-browser-group="' +
                sanitize_html(browser.lower()) +
                '">\n          <h2 class="browser-title">' +
                sanitize_html(capitalize(browser)) +
                '</h2>\n          <ul class="test-list">\n      '
            )
            for test in tests:
                parts = (test.get("name") or "").split(" > ")
                test_title = parts[-1] if parts else "Unnamed Test"
                severity = test.get("severity") or "Medium"
                sev_badge = (
                    '<span style="background-color: ' + _severity_color(severity) +
                    '; font-size: 0.8em; font-weight: 600; padding: 3px 8px;' +
                    ' border-radius: 4px; color: #fff; margin-left: 10px; white-space: nowrap;">' +
                    severity + '</span>'
                )
                unsuccessful = [a for a in (test.get("retryHistory") or [])
                                if a.get("status") in ("failed", "timedout", "flaky")]
                if unsuccessful:
                    retry_badge = (
                        '<span style="background-color: #f59e0b; border: 1px solid #d97706;' +
                        ' font-size: 0.8em; font-weight: 700; padding: 4px 10px; border-radius: 50px;' +
                        ' color: #fff; margin-left: 10px; white-space: nowrap; display: inline-flex;' +
                        ' align-items: center; gap: 4px;">' +
                        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"' +
                        ' stroke="currentColor" stroke-width="2" style="vertical-align: middle;">' +
                        '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>' +
                        '</svg>Retry Count: ' + str(len(unsuccessful)) + '</span>'
                    )
                else:
                    retry_badge = ""
                tags = "".join(
                    '<span style="background-color: #7f8c8d; font-size: 0.8em; font-weight: 600;' +
                    ' padding: 3px 8px; border-radius: 4px; color: #fff; margin-left: 5px; white-space: nowrap;">' +
                    sanitize_html(tag) + '</span>'
                    for tag in (test.get("tags") or [])
                )
                html += (
                    '\n            <li class="test-item ' +
                    get_status_class(test.get("status", "")) +
                    '"' +
                    '\n                data-test-name-min="' + sanitize_html(test_title.lower()) + '"' +
                    '\n                data-status-min="' + sanitize_html(str(test.get("status", "")).lower()) + '"' +
                    '\n                data-browser-min="' + sanitize_html(browser.lower()) + '">' +
                    '\n              <span class="test-status-icon">' + get_status_icon(test.get("status", "")) + '</span>' +
                    '\n              <span class="test-title-text" title="' + sanitize_html(test.get("name", "")) + '">' +
                    sanitize_html(test_title) + '</span>' +
                    '\n              ' + retry_badge +
                    '\n              ' + sev_badge +
                    '\n              ' + tags +
                    '\n            </li>\n        '
                )
            html += "\n          </ul>\n        </div>\n      "
        return html

    browser_options = "".join(
        '<option value="' + sanitize_html(b.lower()) + '">' + sanitize_html(capitalize(b)) + '</option>'
        for b in all_browsers
    )

    metadata = report_data.get("metadata") or {}
    desc = metadata.get("reportDescription")
    if desc:
        truncated = desc[:130] + "..." if len(desc) > 130 else desc
        description_section = (
            '<div class="report-description" title="' + sanitize_html(desc) +
            '" style="margin: 0 0 24px 0; padding: 18px 24px;' +
            ' background-color: var(--bg-card, var(--card-bg, #ffffff));' +
            ' border: 1px solid var(--border-color, var(--border-medium, #e5e7eb));' +
            ' border-left: 4px solid #764ba2; border-radius: 8px; display: flex;' +
            ' align-items: flex-start; gap: 16px;' +
            ' box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"' +
            ' fill="none" stroke="#764ba2" stroke-width="2" stroke-linecap="round"' +
            ' stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px;">' +
            '<circle cx="12" cy="12" r="10"></circle>' +
            '<line x1="12" y1="16" x2="12" y2="12"></line>' +
            '<line x1="12" y1="8" x2="12.01" y2="8"></line></svg>' +
            '<div style="flex: 1; min-width: 0;">' +
            '<h4 style="margin: 0 0 6px 0; font-size: 0.85em; text-transform: uppercase;' +
            ' letter-spacing: 0.5px; color: #764ba2; font-weight: 700;">Report Description</h4>' +
            '<p style="margin: 0; font-size: 0.95em; color: var(--text-color, #1f2937);' +
            ' line-height: 1.6; font-weight: 400; overflow-wrap: break-word;">' +
            sanitize_html(truncated) + '</p></div></div>'
        )
    else:
        description_section = ""

    legend_html = (
        '<div style="display: flex; justify-content: space-between; align-items: center;' +
        ' flex-wrap: wrap; gap: 15px; margin-top: 30px; margin-bottom: 15px; padding-bottom: 10px;' +
        ' border-bottom: 2px solid var(--secondary-color);">' +
        '<h1 style="margin: 0; font-size: 1.5em; color: var(--primary-color);">Test Case Summary</h1>' +
        '<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.75em;">' +
        '<span style="font-weight: 600; color: var(--dark-gray-color);">Legend:</span>' +
        '<span style="margin-left: 4px; font-weight: 600; color: var(--text-color);">Severity:</span>' +
        '<span style="background-color: #006064; color: #fff; padding: 2px 6px; border-radius: 3px;">Minor</span>' +
        '<span style="background-color: #FFA07A; color: #fff; padding: 2px 6px; border-radius: 3px;">Low</span>' +
        '<span style="background-color: #577A11; color: #fff; padding: 2px 6px; border-radius: 3px;">Medium</span>' +
        '<span style="background-color: #B71C1C; color: #fff; padding: 2px 6px; border-radius: 3px;">High</span>' +
        '<span style="background-color: #64158A; color: #fff; padding: 2px 6px; border-radius: 3px;">Critical</span>' +
        '<span style="border-left: 1px solid #ccc; height: 14px; margin: 0 4px;"></span>' +
        '<span style="background-color: #7f8c8d; color: #fff; padding: 2px 6px; border-radius: 3px;">Tags</span>' +
        '</div></div>'
    )

    filter_html = (
        '<div class="filters-section">' +
        '<input type="text" id="filter-min-name" placeholder="Search by test name...">' +
        '<select id="filter-min-status">' +
        '<option value="">All Status</option>' +
        '<option value="passed">✅ Passed</option>' +
        '<option value="failed">❌ Failed</option>' +
        '<option value="skipped">⏭️ Skipped</option>' +
        '<option value="flaky">⚠ Flaky</option>' +
        '</select>' +
        '<select id="filter-min-browser">' +
        '<option value="">All Browsers</option>' +
        browser_options +
        '</select>' +
        '<button id="clear-min-filters">Clear Filters</button>' +
        '</div>'
    )

    return (
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"' +
        ' "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n' +
        '<html lang="en" xmlns="http://www.w3.org/1999/xhtml">\n' +
        '<head>\n' +
        '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />\n' +
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '    <link rel="icon" type="image/png" href=' + logo + '>\n' +
        '    <link rel="apple-touch-icon" href=' + logo + '>\n' +
        '    <title>Pulse Summary Report</title>\n' +
        _STYLE_CSS + '\n' +
        '</head>\n<body>\n' +
        '    <div class="container">\n' +
        '        <header class="report-header">\n' +
        '            <div class="report-header-title">\n' +
        '                <img id="report-logo" src=' + logo + ' alt="Report Logo">\n' +
        '                <h1>Pulse Summary Report</h1>\n' +
        '            </div>\n' +
        '            <div class="run-info">\n' +
        '                <strong>Run Date:</strong> ' + format_date(rs.get("timestamp")) + '<br>\n' +
        '                <strong>Total Duration:</strong> ' + format_duration(rs.get("duration")) + '\n' +
        '            </div>\n' +
        '        </header>\n' +
        description_section +
        '        <section class="summary-section">\n' +
        '            <div class="summary-stats">\n' +
        '                <div class="stat-card"><h3>Total Tests</h3><div class="value">' + str(rs.get("totalTests", 0)) + '</div></div>\n' +
        '                <div class="stat-card passed"><h3>Passed</h3><div class="value">' + str(rs.get("passed", 0)) + '</div></div>\n' +
        '                <div class="stat-card failed"><h3>Failed</h3><div class="value">' + str(rs.get("failed", 0)) + '</div></div>\n' +
        '                <div class="stat-card skipped"><h3>Skipped</h3><div class="value">' + str(rs.get("skipped") or 0) + '</div></div>\n' +
        '                <div class="stat-card flaky"><h3>Flaky</h3><div class="value">' + str(rs.get("flaky") or 0) + '</div></div>\n' +
        '            </div>\n' +
        '        </section>\n' +
        '\n' +
        '        <section class="test-results-section">\n' +
        legend_html +
        '\n' +
        filter_html +
        '\n' +
        generate_test_list_html() +
        '\n        </section>\n' +
        '\n' +
        '        <footer class="report-footer">\n' +
        '            <div style="display: inline-flex; align-items: center; gap: 0.5rem;">' +
        '<span>Created for</span>' +
        '<a href="https://arghajit47.github.io/playwright-pulse/" target="_blank" rel="noopener noreferrer">Pulse Email Report</a>' +
        '</div>\n' +
        '            <div style="margin-top: 0.3rem; font-size: 0.7rem;">Crafted with precision</div>\n' +
        '        </footer>\n' +
        '    </div>\n' +
        _CLIENT_SCRIPT + '\n' +
        '</body>\n</html>\n'
    )


# ── Config reader ──────────────────────────────────────────────────────────────
def get_reporter_config(custom_dir=None):
    output_dir = custom_dir or DEFAULT_OUTPUT_DIR
    output_file = "playwright-pulse-report.json"
    for ini in ("pytest.ini", "setup.cfg", "pyproject.toml"):
        if os.path.isfile(ini):
            try:
                content = open(ini).read()
                m = re.search(r"pulse[_-]output[_-]dir\s*=\s*(.+)", content)
                if m and not custom_dir:
                    output_dir = m.group(1).strip().strip('"').strip("'")
                m2 = re.search(r"pulse[_-]output[_-]file\s*=\s*(.+)", content)
                if m2:
                    output_file = m2.group(1).strip().strip('"').strip("'")
            except Exception:
                pass
    return {"outputDir": output_dir, "outputFile": output_file}


def merge_sequential_reports_if_needed(output_dir):
    partial_files = sorted(
        glob.glob(os.path.join(output_dir, "playwright-pulse-report-*.json"))
    )
    if not partial_files:
        return


async def animate():
    print("\033[35m♦ Playwright Pulse Reporter\033[0m")


# ── Main ───────────────────────────────────────────────────────────────────────
async def main():
    logo = LOGO

    if os.environ.get("SKIP_LOGO") != "true":
        await animate()

    config = get_reporter_config(custom_output_dir)
    output_dir = config["outputDir"]
    output_file = config["outputFile"]

    merge_sequential_reports_if_needed(output_dir)

    report_json_path = os.path.abspath(os.path.join(output_dir, output_file))
    minified_html_path = os.path.abspath(os.path.join(output_dir, MINIFIED_HTML_FILE))

    print(chalk.blue("Generating email report..."))
    print(chalk.blue(f"Output directory set to: {output_dir}"))
    if custom_output_dir:
        print(chalk.gray("  (from CLI argument)"))
    else:
        print(chalk.gray("  (auto-detected from config or using default)"))

    try:
        with open(report_json_path, "r", encoding="utf-8") as fh:
            current_run_report_data = json.load(fh)
    except Exception as e:
        print(
            chalk.red(f"Critical Error: Could not read or parse main report JSON"
                      f" at {report_json_path}: {e}"),
            file=sys.stderr,
        )
        sys.exit(1)

    metadata = current_run_report_data.get("metadata") or {}
    if metadata.get("logo"):
        logo_path = os.path.join(os.getcwd(), metadata["logo"])
        try:
            ext = os.path.splitext(logo_path)[1].lower()
            mime_map = {
                ".svg": "image/svg+xml",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
            }
            mime_type = mime_map.get(ext, "image/png")
            with open(logo_path, "rb") as fh:
                logo_data = base64.b64encode(fh.read()).decode()
            logo = f"data:{mime_type};base64,{logo_data}"
        except Exception as e:
            print(
                chalk.yellow(f"Warning: Could not read custom logo file at"
                             f" {logo_path}. Falling back to default logo. Error: {e}")
            )

    if not isinstance(current_run_report_data, dict) or "results" not in current_run_report_data:
        print(
            chalk.red("Invalid report JSON structure. 'results' field is missing or invalid."),
            file=sys.stderr,
        )
        sys.exit(1)

    if not isinstance(current_run_report_data.get("results"), list):
        current_run_report_data["results"] = []
        print(chalk.yellow("Warning: 'results' field was not an array. Treated as empty."))

    try:
        html_content = generate_minified_html(current_run_report_data, logo)
        os.makedirs(os.path.dirname(minified_html_path) or ".", exist_ok=True)
        with open(minified_html_path, "w", encoding="utf-8") as fh:
            fh.write(html_content)
        print(chalk.green(chalk.bold(
            f"Minified Pulse summary report generated successfully at: {minified_html_path}"
        )))
        print(chalk.gray("(This HTML file is designed to be lightweight)"))
    except Exception as e:
        print(chalk.red(f"Error generating minified HTML report: {e}"), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as err:
        print(chalk.red(chalk.bold(f"Unhandled error during script execution: {err}")),
              file=sys.stderr)
        sys.exit(1)

def generate_email_html(json_path):
    """Bridge for cli.py: Generate lightweight email HTML."""
    import json
    with open(json_path, "r", encoding="utf-8") as f:
        report_data = json.load(f)
    # The logo logic in email_generator.py is inside main, 
    # but generate_minified_html takes it as an argument.
    # We'll use the default LOGO constant from the module.
    return generate_minified_html(report_data, logo=LOGO)
