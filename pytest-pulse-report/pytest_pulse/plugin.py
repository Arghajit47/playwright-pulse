"""pytest-pulse-report: pytest plugin — collects test results and writes
the same JSON format as the JS playwright-pulse reporter.

Supported features:
  * All test phases (setup / call / teardown)
  * Retry detection (compatible with pytest-rerunfailures)
  * Step recording via ``pulse_step`` fixture (context manager)
  * Severity / tag markers: @pytest.mark.pulse_severity, @pytest.mark.pulse_tag
  * Custom annotations: @pytest.mark.pulse_annotation
  * Browser detection when pytest-playwright is installed
  * Artifact discovery (screenshots / videos / traces) from pytest-playwright
    output directory
  * pytest-xdist: each worker writes a shard file; master merges them
  * resetOnEachRun=False: individual run files written to a sub-directory
    for later manual merging
"""
from __future__ import annotations

import hashlib
import os
import re
import time
import traceback
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

import pytest

from .attachment_utils import copy_attachment, find_playwright_artifacts
from .env_utils import get_env_details
from .report_writer import write_report
from .types import (
    Annotation,
    PulseReport,
    ReportMetadata,
    TestResult,
    TestRun,
    TestStep,
)

# ── Constants ──────────────────────────────────────────────────────────────────
TEMP_SHARD_PREFIX = ".pulse-shard-results-"
ATTACHMENTS_SUBDIR = "attachments"
DEFAULT_OUTPUT_DIR = "pulse-report"
DEFAULT_OUTPUT_FILE = "playwright-pulse-report.json"
DEFAULT_INDIVIDUAL_SUBDIR = "pulse-results"


# ── Step recorder (per-test) ───────────────────────────────────────────────────
@dataclass
class _StepRecorder:
    test_id: str
    browser: str
    steps: List[TestStep] = field(default_factory=list)

    def reset_steps(self) -> None:
        self.steps = []

    @contextmanager
    def step(self, title: str) -> Generator[None, None, None]:
        start = datetime.now(tz=timezone.utc)
        step_status = "passed"
        error_msg: Optional[str] = None
        stack: Optional[str] = None
        try:
            yield
        except Exception as exc:
            step_status = "failed"
            error_msg = str(exc)
            stack = traceback.format_exc()
            raise
        finally:
            end = datetime.now(tz=timezone.utc)
            duration_ms = (end - start).total_seconds() * 1000
            sid = f"{self.test_id}_step_{start.isoformat()}-{int(duration_ms)}-{uuid.uuid4().hex[:8]}"
            self.steps.append(
                TestStep(
                    id=sid,
                    title=title,
                    status=step_status,
                    duration=duration_ms,
                    startTime=start,
                    endTime=end,
                    browser=self.browser,
                    errorMessage=error_msg,
                    stackTrace=stack,
                )
            )


# ── Per-test accumulated state ─────────────────────────────────────────────────
@dataclass
class _TestState:
    node_id: str
    start_time: datetime
    phases: Dict[str, Any] = field(default_factory=dict)   # phase → (outcome, longrepr)
    recorder: Optional[_StepRecorder] = None
    pw_artifacts: Optional[dict] = None   # discovered after test


# ── Reporter singleton attached to pytest config ───────────────────────────────
class PulseReporter:
    def __init__(self, config: pytest.Config) -> None:
        self.config = config
        opts = config.option

        self.output_dir: str = os.path.abspath(
            getattr(opts, "pulse_output_dir", None) or DEFAULT_OUTPUT_DIR
        )
        self.output_file: str = (
            getattr(opts, "pulse_output_file", None) or DEFAULT_OUTPUT_FILE
        )
        self.reset_on_each_run: bool = getattr(opts, "pulse_reset_on_each_run", True)
        self.individual_sub: str = (
            getattr(opts, "pulse_individual_subdir", None) or DEFAULT_INDIVIDUAL_SUBDIR
        )
        self.report_description: Optional[str] = getattr(opts, "pulse_description", None)
        self.logo: Optional[str] = getattr(opts, "pulse_logo", None)

        self.attachments_dir = os.path.join(self.output_dir, ATTACHMENTS_SUBDIR)
        os.makedirs(self.output_dir, exist_ok=True)

        self.run_start_ms = int(time.time() * 1000)
        self.run_id = f"run-{self.run_start_ms}-{uuid.uuid4()}"

        self._states: Dict[str, _TestState] = {}   # nodeid → state
        self._results: List[TestResult] = []

        # xdist: is this a worker or master process?
        self._worker_id: Optional[str] = self._detect_worker_id()
        self._total_workers: int = self._detect_total_workers()

        # Clean up stale shard files at startup (master only)
        if not self._is_worker():
            self._cleanup_shard_files()

    # ── xdist helpers ──────────────────────────────────────────────────────────
    def _detect_worker_id(self) -> Optional[str]:
        wi = getattr(self.config, "workerinput", None)
        if wi:
            return wi.get("workerid")
        return None

    def _detect_total_workers(self) -> int:
        try:
            n = self.config.option.numprocesses
            return int(n) if n not in (None, "auto") else 1
        except AttributeError:
            return 1

    def _is_worker(self) -> bool:
        return self._worker_id is not None

    def _worker_index(self) -> int:
        if not self._worker_id:
            return 0
        m = re.search(r"\d+", self._worker_id)
        return int(m.group()) if m else 0

    # ── Cleanup ────────────────────────────────────────────────────────────────
    def _cleanup_shard_files(self) -> None:
        if not os.path.isdir(self.output_dir):
            return
        for fname in os.listdir(self.output_dir):
            if fname.startswith(TEMP_SHARD_PREFIX):
                try:
                    os.unlink(os.path.join(self.output_dir, fname))
                except OSError:
                    pass

    # ── Test lifecycle ─────────────────────────────────────────────────────────
    def on_test_start(self, item: pytest.Item) -> None:
        nid = item.nodeid
        browser = _detect_browser(item)
        state = _TestState(
            node_id=nid,
            start_time=datetime.now(tz=timezone.utc),
        )
        state.recorder = _StepRecorder(test_id=_make_test_id(item), browser=browser)
        # Attach recorder to item so the fixture can access it
        item._pulse_recorder = state.recorder  # type: ignore[attr-defined]
        self._states[nid] = state

    def on_test_report(self, item: pytest.Item, report: pytest.TestReport) -> None:
        nid = item.nodeid
        state = self._states.get(nid)
        if state is None:
            return

        # Detect start of a new rerun attempt: a fresh 'setup' phase when phases
        # already has data means pytest-rerunfailures is starting another attempt.
        if report.when == "setup" and state.phases:
            retry_index = getattr(item, "execution_count", 2) - 2
            self._save_attempt_result(item, state, retry_index=retry_index)
            state.phases.clear()
            state.start_time = datetime.now(tz=timezone.utc)
            if state.recorder:
                state.recorder.reset_steps()

        state.phases[report.when] = report

    def _save_attempt_result(
        self,
        item: pytest.Item,
        state: "_TestState",
        retry_index: int,
    ) -> None:
        """Build and store a TestResult for one completed attempt (used for reruns)."""
        setup_rep = state.phases.get("setup")
        call_rep  = state.phases.get("call")
        teardown_rep = state.phases.get("teardown")
        status, error_msg, stack_trace = _determine_status(setup_rep, call_rep, teardown_rep)
        end_time     = datetime.now(tz=timezone.utc)
        duration_ms  = (end_time - state.start_time).total_seconds() * 1000
        browser      = _detect_browser(item)
        test_id      = _make_test_id(item)
        steps        = list(state.recorder.steps) if state.recorder else []
        result = TestResult(
            id=test_id,
            runId=self.run_id,
            name=_get_title_path(item, _get_suite_name(item)),
            describe=_get_describe(item),
            spec_file=_get_spec_file(item),
            status=status,
            duration=duration_ms,
            startTime=state.start_time,
            endTime=end_time,
            retries=retry_index,
            steps=steps,
            errorMessage=error_msg or None,
            stackTrace=stack_trace or None,
            tags=_get_tags(item),
            severity=_get_severity(item),
            suiteName=_get_suite_name(item),
            browser=browser,
            screenshots=[],
            videoPath=[],
            tracePath=None,
            attachments=[],
            stdout=None,
            stderr=None,
            workerId=self._worker_index() + 1 if self._is_worker() else 1,
            totalWorkers=self._total_workers,
            configFile=str(self.config.inipath) if self.config.inipath else None,
            annotations=_get_annotations(item) or None,
        )
        self._results.append(result)

    def on_test_finish(self, item: pytest.Item) -> None:
        nid = item.nodeid
        state = self._states.pop(nid, None)
        if state is None:
            return

        setup_rep = state.phases.get("setup")
        call_rep = state.phases.get("call")
        teardown_rep = state.phases.get("teardown")

        # Determine overall status
        status, error_msg, stack_trace = _determine_status(
            setup_rep, call_rep, teardown_rep
        )

        end_time = datetime.now(tz=timezone.utc)
        duration_ms = (end_time - state.start_time).total_seconds() * 1000

        # Gather stdout / stderr from captured sections
        stdout_lines: List[str] = []
        stderr_lines: List[str] = []
        for rep in [setup_rep, call_rep, teardown_rep]:
            if rep is None:
                continue
            for section_name, section_content in rep.sections:
                if "stdout" in section_name.lower():
                    stdout_lines.extend(section_content.splitlines())
                elif "stderr" in section_name.lower():
                    stderr_lines.extend(section_content.splitlines())

        browser = _detect_browser(item)
        test_id = _make_test_id(item)
        suite_name = _get_suite_name(item)
        describe = _get_describe(item)
        spec_file = _get_spec_file(item)
        title_path = _get_title_path(item, suite_name)
        tags = _get_tags(item)
        severity = _get_severity(item)
        annotations = _get_annotations(item)
        retry_count = _get_retry_count(item)

        # Collect attachments
        screenshots: List[str] = []
        videos: List[str] = []
        trace_path: Optional[str] = None
        other_attachments = []

        pw_output = _get_pw_output_dir(self.config)
        if pw_output:
            artefacts = find_playwright_artifacts(pw_output, nid, browser)
            ts_ms = int(time.time() * 1000)
            test_subfolder = re.sub(r"[^a-zA-Z0-9_\-]", "_", test_id)
            dest_dir = os.path.join(self.attachments_dir, test_subfolder)

            for i, src in enumerate(artefacts["screenshots"]):
                dest = copy_attachment(src, dest_dir, i, ts_ms, os.path.basename(src))
                if dest:
                    rel = os.path.relpath(dest, self.output_dir)
                    screenshots.append(rel)

            for i, src in enumerate(artefacts["videos"]):
                dest = copy_attachment(src, dest_dir, i + 100, ts_ms, os.path.basename(src))
                if dest:
                    rel = os.path.relpath(dest, self.output_dir)
                    videos.append(rel)

            if artefacts["trace"]:
                src = artefacts["trace"]
                dest = copy_attachment(src, dest_dir, 200, ts_ms, "trace.zip")
                if dest:
                    trace_path = os.path.relpath(dest, self.output_dir)

        # Also check for any files added via pytest's extra mechanism (e.g. allure-style)
        for path_str in _collect_extra_attachments(item):
            ext = os.path.splitext(path_str)[1].lower()
            if ext in (".png", ".jpg", ".jpeg", ".webp"):
                screenshots.append(path_str)
            elif ext in (".webm", ".mp4"):
                videos.append(path_str)

        steps = state.recorder.steps if state.recorder else []

        result = TestResult(
            id=test_id,
            runId=self.run_id,
            name=title_path,
            describe=describe,
            spec_file=spec_file,
            status=status,
            duration=duration_ms,
            startTime=state.start_time,
            endTime=end_time,
            retries=retry_count,
            steps=steps,
            errorMessage=error_msg if error_msg else None,
            stackTrace=stack_trace if stack_trace else None,
            tags=tags,
            severity=severity,
            suiteName=suite_name,
            browser=browser,
            screenshots=screenshots,
            videoPath=videos,
            tracePath=trace_path,
            attachments=other_attachments,
            stdout=stdout_lines if stdout_lines else None,
            stderr=stderr_lines if stderr_lines else None,
            workerId=self._worker_index() + 1 if self._is_worker() else 1,
            totalWorkers=self._total_workers,
            configFile=str(self.config.inipath) if self.config.inipath else None,
            annotations=annotations if annotations else None,
        )

        self._results.append(result)

    # ── Finalise ───────────────────────────────────────────────────────────────
    def finalise(self) -> None:
        final_results = _dedupe_retries(self._results)

        run_end_ms = int(time.time() * 1000)
        duration_ms = run_end_ms - self.run_start_ms

        env = get_env_details()

        run = TestRun(
            id=self.run_id,
            timestamp=datetime.fromtimestamp(self.run_start_ms / 1000, tz=timezone.utc),
            totalTests=len(final_results),
            passed=sum(1 for r in final_results if _final_status(r) == "passed"),
            failed=sum(1 for r in final_results if _final_status(r) == "failed"),
            skipped=sum(1 for r in final_results if _final_status(r) == "skipped"),
            flaky=sum(1 for r in final_results if _final_status(r) == "flaky"),
            duration=float(duration_ms),
            environment=env,
        )

        for r in final_results:
            r.runId = self.run_id

        logo_val = self.logo
        if logo_val and os.path.isfile(logo_val):
            logo_val = _encode_logo(logo_val)

        metadata = ReportMetadata(
            generatedAt=datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            reportDescription=self.report_description,
            logo=logo_val,
        )

        report = PulseReport(run=run, results=final_results, metadata=metadata)

        if self._is_worker():
            shard_path = os.path.join(
                self.output_dir,
                f"{TEMP_SHARD_PREFIX}{self._worker_index()}.json",
            )
            write_report(report, shard_path)
            return

        if self.reset_on_each_run:
            out_path = os.path.join(self.output_dir, self.output_file)
            write_report(report, out_path)
            print(f"\nPulseReport: JSON report written to {out_path}")
        else:
            sub_dir = os.path.join(self.output_dir, self.individual_sub)
            stem = self.output_file.replace(".json", "")
            individual_path = os.path.join(sub_dir, f"{stem}-{self.run_start_ms}.json")
            write_report(report, individual_path)
            print(f"\nPulseReport: Individual run report written to {individual_path}")

    def merge_shard_files(self) -> None:
        """Called on xdist master after all workers finish to merge shard files."""
        from .report_writer import read_report, merge_raw_reports
        import json

        total = self._total_workers
        all_results: list = []
        environments: list = []
        run_start: Optional[str] = None

        for i in range(total):
            fpath = os.path.join(self.output_dir, f"{TEMP_SHARD_PREFIX}{i}.json")
            if not os.path.exists(fpath):
                print(f"PulseReport: shard {i} not found at {fpath}, skipping")
                continue
            try:
                with open(fpath, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                all_results.extend(data.get("results") or [])
                env = (data.get("run") or {}).get("environment")
                if env:
                    environments.append(env)
                ts = (data.get("run") or {}).get("timestamp", "")
                if run_start is None or ts < run_start:
                    run_start = ts
            except Exception as exc:
                print(f"PulseReport: failed to read shard {i}: {exc}")

        run_end_ms = int(time.time() * 1000)
        duration_ms = run_end_ms - self.run_start_ms

        logo_val = self.logo
        if logo_val and os.path.isfile(logo_val):
            logo_val = _encode_logo(logo_val)

        passed = sum(1 for r in all_results if (r.get("final_status") or r.get("status")) == "passed")
        failed = sum(1 for r in all_results if (r.get("final_status") or r.get("status")) == "failed")
        skipped = sum(1 for r in all_results if (r.get("final_status") or r.get("status")) == "skipped")
        flaky = sum(1 for r in all_results if (r.get("final_status") or r.get("status")) == "flaky")

        merged = {
            "run": {
                "id": self.run_id,
                "timestamp": run_start or datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                "totalTests": len(all_results),
                "passed": passed,
                "failed": failed,
                "skipped": skipped,
                "flaky": flaky,
                "duration": float(duration_ms),
                "environment": environments,
            },
            "results": all_results,
            "metadata": {
                "generatedAt": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                "reportDescription": self.report_description,
                "logo": logo_val,
            },
        }

        out_path = os.path.join(self.output_dir, self.output_file)
        import json as _json
        os.makedirs(self.output_dir, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            _json.dump(merged, fh, indent=2, ensure_ascii=False)
        print(f"\nPulseReport: merged xdist report written to {out_path}")
        self._cleanup_shard_files()


# ── Helper functions ───────────────────────────────────────────────────────────

def _make_test_id(item: pytest.Item) -> str:
    """Stable unique ID based on nodeid hash (mirrors JS project-testId pattern)."""
    h = hashlib.md5(item.nodeid.encode()).hexdigest()[:20]
    suite = _get_suite_name(item).replace(" ", "_")[:20]
    return f"{suite}-{h}"


def _get_suite_name(item: pytest.Item) -> str:
    """Suite name = parametrise browser value or first marker value or module."""
    # Check if there's a [browser] parametrise marker
    for marker in item.iter_markers("parametrize"):
        pass

    # Check pytest-playwright browser parametrisation in callspec
    callspec = getattr(item, "callspec", None)
    if callspec:
        params = getattr(callspec, "params", {})
        if "browser_name" in params:
            return str(params["browser_name"])

    # Class name
    if item.cls:
        return item.cls.__name__

    # Module stem without path
    return Path(item.fspath).stem


def _get_describe(item: pytest.Item) -> str:
    if item.cls:
        return item.cls.__name__
    return "n/a"


def _get_spec_file(item: pytest.Item) -> str:
    return Path(item.fspath).name


def _get_title_path(item: pytest.Item, suite_name: str) -> str:
    """Build a ' > ' separated title path like the JS reporter."""
    parts: List[str] = []
    if suite_name:
        parts.append(suite_name)
    parts.append(_get_spec_file(item))
    if item.cls:
        parts.append(item.cls.__name__)
    # Sanitise parametrise suffix from test name
    test_name = re.sub(r"\[.*?\]$", "", item.name)
    parts.append(test_name)
    return " > ".join(parts)


def _detect_browser(item: pytest.Item) -> str:
    # From pytest-playwright callspec params
    callspec = getattr(item, "callspec", None)
    if callspec:
        params = getattr(callspec, "params", {})
        if "browser_name" in params:
            return str(params["browser_name"])

    # From fixture value cached on item
    funcargs = getattr(item, "funcargs", None) or {}
    if "browser_name" in funcargs:
        try:
            return str(funcargs["browser_name"])
        except Exception:
            pass

    # From marker
    for marker in item.iter_markers("pulse_browser"):
        if marker.args:
            return str(marker.args[0])

    return "python"


def _get_tags(item: pytest.Item) -> List[str]:
    tags: List[str] = []
    for marker in item.iter_markers("pulse_tag"):
        if marker.args:
            tags.append(str(marker.args[0]))
    # Also treat pytest marks starting with known CI tags
    for marker in item.iter_markers():
        if marker.name in ("smoke", "regression", "sanity", "e2e", "integration"):
            tags.append(marker.name)
    return list(dict.fromkeys(tags))  # dedupe, preserve order


def _get_severity(item: pytest.Item) -> str:
    for marker in item.iter_markers("pulse_severity"):
        if marker.args:
            return str(marker.args[0])
    return "Medium"


def _get_annotations(item: pytest.Item) -> List[Annotation]:
    annotations: List[Annotation] = []
    for marker in item.iter_markers("pulse_annotation"):
        ann_type = marker.args[0] if marker.args else ""
        ann_desc = marker.args[1] if len(marker.args) > 1 else marker.kwargs.get("description")
        annotations.append(Annotation(type=str(ann_type), description=str(ann_desc) if ann_desc else None))
    return annotations


def _get_retry_count(item: pytest.Item) -> int:
    """Return the current retry index (0 = first run)."""
    return getattr(item, "execution_count", 1) - 1


def _get_pw_output_dir(config: pytest.Config) -> Optional[str]:
    """Locate pytest-playwright's --output directory."""
    try:
        output = config.option.output
        if output:
            return str(output)
    except AttributeError:
        pass
    default = "test-results"
    if os.path.isdir(default):
        return default
    return None


def _collect_extra_attachments(item: pytest.Item) -> List[str]:
    """Gather any extra file paths stored by other plugins (e.g. allure)."""
    extras = getattr(item, "_pulse_extras", [])
    return [e for e in extras if isinstance(e, str)]


def _determine_status(setup, call, teardown):
    """Derive overall status + error info from the three report phases."""
    error_msg = ""
    stack = ""

    # If call phase exists, it drives the primary status
    if call is not None:
        if call.outcome == "failed":
            error_msg = _extract_error(call)
            stack = _extract_stack(call)
            return "failed", error_msg, stack
        if call.outcome == "skipped":
            return "skipped", "", ""
        # passed — still check setup/teardown
        if setup and setup.outcome == "failed":
            return "failed", _extract_error(setup), _extract_stack(setup)
        return "passed", "", ""

    # No call phase (e.g. collected-only / setup failure)
    if setup is not None:
        if setup.outcome == "failed":
            return "failed", _extract_error(setup), _extract_stack(setup)
        if setup.outcome == "skipped":
            return "skipped", "", ""

    return "skipped", "", ""


def _extract_error(report: pytest.TestReport) -> str:
    if report.longrepr is None:
        return ""
    if hasattr(report.longrepr, "reprcrash"):
        crash = report.longrepr.reprcrash
        return f"{crash.path}:{crash.lineno}: {crash.message}" if crash else str(report.longrepr)
    return str(report.longrepr)


def _extract_stack(report: pytest.TestReport) -> str:
    if report.longrepr is None:
        return ""
    if hasattr(report.longrepr, "reprtraceback"):
        return str(report.longrepr.reprtraceback)
    return str(report.longrepr)


def _final_status(r: TestResult) -> str:
    return r.final_status or r.status


def _dedupe_retries(results: List[TestResult]) -> List[TestResult]:
    """Group by test id, assign retry history, determine final status."""
    from collections import defaultdict
    grouped: dict[str, List[TestResult]] = defaultdict(list)
    for r in results:
        grouped[r.id].append(r)

    final: List[TestResult] = []
    for attempts in grouped.values():
        attempts.sort(key=lambda r: (r.retries, r.startTime))
        first = attempts[0]
        retries = attempts[1:]

        has_actual_retries = retries and any(
            a.status in ("failed", "flaky") or first.status in ("failed", "flaky")
            for a in retries
        )

        if has_actual_retries:
            last = attempts[-1]
            first.retryHistory = retries
            first.final_status = last.status
            if last.status == "flaky" or (first.status == "failed" and last.status == "passed"):
                first.outcome = "flaky"
                first.status = "flaky"
        else:
            first.final_status = None
            first.retryHistory = None

        final.append(first)

    return final


def _encode_logo(path: str) -> str:
    import base64, mimetypes
    mime, _ = mimetypes.guess_type(path)
    mime = mime or "image/png"
    with open(path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    return f"data:{mime};base64,{b64}"


# ── pytest plugin hooks ────────────────────────────────────────────────────────

def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("pulse-report", "Pulse Report options")
    group.addoption(
        "--pulse-output-dir",
        dest="pulse_output_dir",
        default=None,
        help=f"Output directory for pulse report (default: {DEFAULT_OUTPUT_DIR})",
    )
    group.addoption(
        "--pulse-output-file",
        dest="pulse_output_file",
        default=None,
        help=f"Output JSON filename (default: {DEFAULT_OUTPUT_FILE})",
    )
    group.addoption(
        "--pulse-reset-on-each-run",
        dest="pulse_reset_on_each_run",
        action="store_true",
        default=True,
        help="Reset report on each run (default: True)",
    )
    group.addoption(
        "--pulse-no-reset",
        dest="pulse_reset_on_each_run",
        action="store_false",
        help="Accumulate reports across runs (set resetOnEachRun=False)",
    )
    group.addoption(
        "--pulse-individual-subdir",
        dest="pulse_individual_subdir",
        default=None,
        help=f"Sub-directory for individual run reports when --pulse-no-reset is set (default: {DEFAULT_INDIVIDUAL_SUBDIR})",
    )
    group.addoption(
        "--pulse-description",
        dest="pulse_description",
        default=None,
        help="Custom description to embed in the report",
    )
    group.addoption(
        "--pulse-logo",
        dest="pulse_logo",
        default=None,
        help="Path to a custom logo image",
    )


def pytest_configure(config: pytest.Config) -> None:
    config._pulse_reporter = PulseReporter(config)  # type: ignore[attr-defined]

    # Register custom marks so pytest doesn't warn about unknown marks
    config.addinivalue_line("markers", "pulse_severity(level): set test severity (Minor/Low/Medium/High/Critical)")
    config.addinivalue_line("markers", "pulse_tag(name): tag the test")
    config.addinivalue_line("markers", "pulse_annotation(type, description): add custom annotation")
    config.addinivalue_line("markers", "pulse_browser(name): override detected browser name")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item, nextitem=None) -> Generator:  # noqa: ARG001
    """Wrap the entire test lifecycle to reliably start & finish tracking."""
    reporter: PulseReporter = item.config._pulse_reporter
    reporter.on_test_start(item)
    yield
    reporter.on_test_finish(item)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo) -> Generator:  # noqa: ARG001
    """Capture the report for each phase (setup / call / teardown)."""
    outcome = yield
    try:
        report: pytest.TestReport = outcome.get_result()
    except Exception:
        return
    reporter: PulseReporter = item.config._pulse_reporter
    reporter.on_test_report(item, report)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    reporter: PulseReporter = session.config._pulse_reporter

    # xdist master — merge shard files instead of writing directly
    if hasattr(session.config, "workercontroller"):
        reporter.merge_shard_files()
        return

    reporter.finalise()


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def pulse_step(request: pytest.FixtureRequest):
    """Context-manager fixture for recording named test steps.

    Usage::

        def test_login(page, pulse_step):
            with pulse_step("Navigate to login page"):
                page.goto("/login")
            with pulse_step("Submit credentials"):
                page.fill("#user", "admin")
                page.click("#submit")
    """
    recorder: Optional[_StepRecorder] = getattr(request.node, "_pulse_recorder", None)
    if recorder is None:
        # Fallback no-op recorder so tests don't crash if plugin state is missing
        @contextmanager
        def _noop(title: str):
            yield
        return _noop
    return recorder.step


@pytest.fixture(scope="function")
def pulse_attach(request: pytest.FixtureRequest):
    """Fixture to manually attach extra file paths to the pulse report.

    Usage::

        def test_export(page, pulse_attach):
            page.click("#export")
            pulse_attach("/tmp/exported.pdf")
    """
    def _attach(path: str) -> None:
        if not hasattr(request.node, "_pulse_extras"):
            request.node._pulse_extras = []
        request.node._pulse_extras.append(path)

    return _attach
