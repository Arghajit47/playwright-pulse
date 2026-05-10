# pytest-pulse-report

> **Python port of [playwright-pulse](https://github.com/Arghajit47/playwright-pulse)** — the same rich interactive dashboard, now for **pytest-playwright** (and plain pytest).

[![PyPI version](https://badge.fury.io/py/pytest-pulse-report.svg)](https://pypi.org/project/pytest-pulse-report/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

| Feature | Description |
| :--- | :--- |
| **Same JSON format** | 100 % compatible with the JS reporter's output format |
| **Interactive HTML report** | Dark-themed dashboard with Highcharts charts |
| **Self-contained static report** | All assets embedded — share a single `.html` file |
| **Email summary** | Lightweight HTML email + optional full-report attachment |
| **Step recording** | `@step` decorator and `pulse_step` context manager |
| **Severity & tags** | `@pytest.mark.pulse_severity` / `@pytest.mark.pulse_tag` |
| **Artifact collection** | Auto-discovers screenshots / videos / traces from pytest-playwright |
| **pytest-xdist** | Each worker writes a shard; master merges them |
| **Sequential runs** | Accumulate reports across runs with `--pulse-no-reset` |
| **AI Failure Analyzer** | Client-side Claude / OpenAI analysis in the report |
| **Trend history** | Archive runs for historical charts |

---

## Installation

```bash
pip install pytest-pulse-report
# Optional: image compression
pip install pytest-pulse-report[compression]
```

The plugin is auto-registered via the `pytest11` entry point — no `conftest.py` changes needed.

---

## Quick start

```bash
# Run your tests
pytest tests/ --pulse-output-dir=pulse-report

# Generate the interactive HTML report
generate-pulse-report

# Open pulse-report/playwright-pulse-static-report.html
```

---

## Configuration

### Command-line options

| Option | Default | Description |
| :--- | :--- | :--- |
| `--pulse-output-dir` | `pulse-report` | Output directory |
| `--pulse-output-file` | `playwright-pulse-report.json` | JSON filename |
| `--pulse-no-reset` | — | Accumulate reports across runs |
| `--pulse-individual-subdir` | `pulse-results` | Sub-dir for individual run JSONs |
| `--pulse-description` | — | Custom text in report header |
| `--pulse-logo` | — | Path to a custom logo image |

### pytest.ini / pyproject.toml

```ini
[pytest]
addopts = --pulse-output-dir=pulse-report --pulse-description="My CI Suite"
```

---

## Step Recording

### ⚡ Super Easy Mode: The `@step` Decorator

The most efficient way to record steps, especially within Page Object Models (POM). No fixtures needed.

```python
from pytest_pulse import step

class LoginPage:
    def __init__(self, page):
        self.page = page

    @step("Login to Application")
    def login(self, username, password):
        self.enter_credentials(username, password)
        self.submit_form()

    @step("Enter Credentials")
    def enter_credentials(self, username, password):
        self.page.fill("#user", username)
        self.page.fill("#pass", password)

    @step("Submit Login Form")
    def submit_form(self):
        self.page.click("#login-button")
```

### The `pulse_step` Context Manager

Ideal for wrapping specific blocks of code directly inside your test functions.

```python
from pytest_pulse import pulse_step

def test_example(page):
    with pulse_step("Navigate to Home Page"):
        page.goto("https://example.com")
        
    with pulse_step("Perform Search"):
        page.fill("#search", "Playwright Pulse")
        page.press("#search", "Enter")
        
    with pulse_step("Verify Results"):
        assert page.is_visible(".results-count")
```

### Attaching Files with `pulse_attach`

You can manually attach any file (logs, CSVs, custom screenshots) to the test result using the `pulse_attach` fixture.

```python
def test_export(page, pulse_attach):
    page.click("#export-csv")
    pulse_attach("/tmp/export.csv")
```

---

## Markers

```python
import pytest

@pytest.mark.pulse_severity("Critical")   # Minor / Low / Medium / High / Critical
@pytest.mark.pulse_tag("smoke")
@pytest.mark.pulse_tag("regression")
@pytest.mark.pulse_annotation("jira", "PROJ-123")
def test_checkout(page, pulse_step):
    with pulse_step("Go to checkout"):
        page.goto("/checkout")
    with pulse_step("Fill in payment"):
        page.fill("#card", "4242424242424242")
    with pulse_step("Submit order"):
        page.click("#pay")
        page.wait_for_url("**/confirmation")
```

---

## CLI commands

| Command | Description |
| :--- | :--- |
| `generate-pulse-report` | Self-contained static HTML (all assets embedded) |
| `generate-report` | Dynamic HTML (references `attachments/` dir) |
| `merge-pulse-report` | Merge sharded or sequential reports |
| `send-email` | Send report via SMTP |
| `generate-email-report` | Lightweight email summary HTML |
| `generate-trend` | Archive current run for trend history |

All commands accept `--outputDir / -o` flag.

---

## Email sending

Set environment variables (supports `.env` files via `python-dotenv`):

```bash
PULSE_MAIL_HOST=gmail          # gmail | outlook | smtp
PULSE_MAIL_USERNAME=you@gmail.com
PULSE_MAIL_PASSWORD=app_password
RECIPIENT_EMAIL_1=team@example.com
RECIPIENT_EMAIL_2=boss@example.com
```

```bash
send-email --attach-html
```

---

## pytest-playwright integration

When **pytest-playwright** is installed, the plugin automatically:

1. Detects the browser name from the `browser_name` fixture / callspec params
2. Scans pytest-playwright's `--output` directory (default: `test-results`) for screenshots, videos and traces after each test
3. Copies and optionally compresses those artefacts into `pulse-report/attachments/`

```bash
pytest tests/ --browser chromium --video on --screenshot on \
  --pulse-output-dir=pulse-report
generate-pulse-report
```

---

## pytest-xdist (parallel runs)

```bash
pytest tests/ -n 4 --pulse-output-dir=pulse-report
generate-pulse-report
```

Each worker writes a temporary shard file. The master process merges all shards at session end.

---

## Sequential runs (`--pulse-no-reset`)

```bash
pytest tests/smoke/ --pulse-no-reset
pytest tests/regression/ --pulse-no-reset
merge-pulse-report   # combines both into one report
generate-pulse-report
```

---

## JSON report format

The output JSON is **identical** to the JS playwright-pulse format, so existing tooling (CI dashboards, the JS `generate-pulse-report` script, etc.) works without changes.

---

## Author

**Arghajit Singha** — [playwright-pulse](https://github.com/Arghajit47/playwright-pulse)
