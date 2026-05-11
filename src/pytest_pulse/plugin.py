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
import inspect
import linecache
import os
import re
import textwrap
import time
import traceback
import uuid
import functools
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

import pytest
from contextvars import ContextVar

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
from .static_generator import generate_static_html
from .dynamic_generator import generate_dynamic_html

# ── Constants ──────────────────────────────────────────────────────────────────
TEMP_SHARD_PREFIX = "pulse-shard-results-"
ATTACHMENTS_SUBDIR = "attachments"
DEFAULT_OUTPUT_DIR = "pulse-report"
DEFAULT_OUTPUT_FILE = "playwright-pulse-report.json"
DEFAULT_INDIVIDUAL_SUBDIR = "pulse-results"


# ── Context for decorators ───────────────────────────────────────────────────
# Storing the callable (recorder.step) in a ContextVar so static decorators
# can find the active test's step recorder without receiving the fixture.
pulse_step_context: ContextVar[Optional[Any]] = ContextVar("pulse_step_context", default=None)
current_active_step_var: ContextVar[Optional[TestStep]] = ContextVar("current_active_step_var", default=None)


# ── pulse_step helpers ─────────────────────────────────────────────────────────

def extract_block_snippet(file_path: str, start_line: int) -> str:
    """Extract the body of the ``with pulse_step(...)`` block via linecache.

    Algorithm
    ---------
    1. Fetch the ``with`` statement at *start_line* via ``linecache.getline``.
    2. Measure its leading whitespace → *base_indent*.
    3. Walk subsequent lines; collect every line whose indent is strictly
       greater than *base_indent*.  Empty lines are kept verbatim so the
       block retains its visual structure.
    4. Stop at the first non-empty line with indent ≤ *base_indent* — that
       marks the end of the ``with`` block.
    5. ``textwrap.dedent`` strips the uniform leading whitespace so the
       snippet is left-aligned while preserving relative internal indentation.

    Returns ``""`` on any I/O or parsing error so callers never crash.
    """
    try:
        # linecache.getline returns "" for out-of-range / missing files
        with_line = linecache.getline(file_path, start_line)
        if not with_line:
            return ""

        # Number of leading spaces on the ``with pulse_step(...)`` line
        base_indent = len(with_line) - len(with_line.lstrip())

        body: list[str] = []
        lineno = start_line + 1  # body begins on the very next line
        while True:
            raw = linecache.getline(file_path, lineno)
            if not raw:  # EOF or past end of file
                break
            stripped = raw.rstrip("\n\r")
            if stripped.strip() == "":
                # Blank / whitespace-only line — preserve for visual fidelity
                body.append("")
                lineno += 1
                continue
            # this_indent = number of leading spaces on this source line
            this_indent = len(stripped) - len(stripped.lstrip())
            if this_indent <= base_indent:
                # Indentation returned to (or past) the ``with`` level → done
                break
            body.append(stripped)
            lineno += 1

        # Trim trailing blank lines (they add noise without adding meaning)
        while body and body[-1] == "":
            body.pop()

        if not body:
            return ""

        # Remove uniform leading whitespace; relative indentation is preserved
        return textwrap.dedent("\n".join(body))

    except Exception:
        return ""


def _get_caller_frame() -> Optional[inspect.FrameInfo]:
    """Return the first call-stack frame that belongs to user test code.

    Skips frames from:
    * this plugin file itself
    * ``contextlib`` (the ``@contextmanager`` machinery)

    Inside a ``@contextmanager`` the call stack looks like:
        frame 0 → step() generator         (plugin.py)
        frame 1 → _GeneratorContextManager.__enter__  (contextlib.py)
        frame 2 → user test function        ← the frame we want
    """
    plugin_file = os.path.abspath(__file__)
    # Also skip our own decorators file if it exists
    decorators_file = os.path.join(os.path.dirname(plugin_file), "decorators.py")
    
    for frame_info in inspect.stack():
        co_filename = frame_info.frame.f_code.co_filename
        abs_filename = os.path.abspath(co_filename)
        if abs_filename == plugin_file or abs_filename == decorators_file:
            continue
        if "contextlib" in co_filename:
            continue
        return frame_info
    return None


# ── Step recorder (per-test) ───────────────────────────────────────────────────
@dataclass
class _StepRecorder:
    test_id: str
    browser: str
    steps: List[TestStep] = field(default_factory=list)
    current_active_step: Optional[TestStep] = None

    def reset_steps(self) -> None:
        self.steps = []
        self.current_active_step = None

    @contextmanager
    def step(self, title: str) -> Generator[None, None, None]:
        # ── 1. Introspection ───────────────────────────────────────────────────
        # Walk the call stack past contextlib/__enter__ to the user test line.
        # Use co_filename (code object's canonical path) and f_lineno (current
        # execution line — i.e. the "with pulse_step(...):" line itself).
        caller = _get_caller_frame()
        caller_file = caller.frame.f_code.co_filename if caller else ""
        caller_line = caller.frame.f_lineno if caller else 0
        short_file = os.path.basename(caller_file)

        # ── 2. Static source extraction ────────────────────────────────────────
        # extract_block_snippet uses linecache to read the source file and
        # returns the dedented body of the with-block as a clean string.
        code_snippet = extract_block_snippet(caller_file, caller_line) if caller_file else ""
        code_location = f"{short_file}:{caller_line}" if caller_file else ""

        # ── 3. Timing & step object setup ──────────────────────────────────────
        t0 = time.time()
        start = datetime.now(tz=timezone.utc)
        step_status = "passed"
        error_msg: Optional[str] = None
        stack_trace: Optional[str] = None

        new_step = TestStep(
            id="",           # filled in finally
            title=title,
            status=step_status,
            duration=0.0,
            startTime=start,
            endTime=start,
            browser=self.browser,
            codeLocation=code_location or None,
            snippet=code_snippet or None,
        )

        previous_step = self.current_active_step
        self.current_active_step = new_step
        
        # Also update the ContextVar so nested calls find us correctly
        token = current_active_step_var.set(new_step)

        # ── 4. Execute the with-block ──────────────────────────────────────────
        try:
            yield

        except pytest.skip.Exception:
            step_status = "skipped"
            raise

        except pytest.xfail.Exception:
            step_status = "xfailed"
            raise

        except Exception as exc:
            step_status = "failed"
            error_msg = str(exc)
            stack_trace = traceback.format_exc()
            raise

        # ── 5. Finalise — always runs regardless of outcome ────────────────────
        finally:
            current_active_step_var.reset(token)
            
            duration_s = round(time.time() - t0, 3)
            duration_ms = duration_s * 1000
            end = datetime.now(tz=timezone.utc)
            sid = (
                f"{self.test_id}_step_"
                f"{start.isoformat()}-{int(duration_ms)}-{uuid.uuid4().hex[:8]}"
            )

            new_step.id = sid
            new_step.status = step_status
            new_step.duration = duration_ms
            new_step.endTime = end
            new_step.errorMessage = error_msg
            new_step.stackTrace = stack_trace

            if previous_step:
                previous_step.steps.append(new_step)
            else:
                self.steps.append(new_step)
            self.current_active_step = previous_step

    def record_action(self, action: str, selector: Optional[str] = None, value: Optional[str] = None, 
                      start_time: Optional[datetime] = None, end_time: Optional[datetime] = None,
                      status: str = "passed", error_msg: Optional[str] = None) -> None:
        # Prioritize the ContextVar for better nesting support in deep code
        active_step = current_active_step_var.get() or self.current_active_step
        if active_step:
            from .types import TestAction
            active_step.actions.append(
                TestAction(
                    action=action,
                    selector=selector,
                    value=value,
                    status=status,
                    startTime=start_time or datetime.now(tz=timezone.utc),
                    endTime=end_time or datetime.now(tz=timezone.utc),
                    duration=((end_time - start_time).total_seconds() * 1000) if (start_time and end_time) else 0.0,
                    errorMessage=error_msg
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


def _wrap_playwright_locator(locator: Any, recorder: _StepRecorder) -> None:
    """Monkey-patch common Playwright locator methods to record granular actions."""
    methods_to_wrap = [
        "click", "dblclick", "fill", "press", "type", 
        "select_option", "check", "uncheck", "hover", 
        "drag_and_drop", "screenshot", "wait_for", "is_visible"
    ]
    
    # Get the selector from the locator if possible
    # In python-playwright, locators don't easily expose the selector string,
    # but we can try to represent the locator.
    selector_repr = str(locator)

    def make_locator_wrapper(method_name, original_method):
        @functools.wraps(original_method)
        def wrapped_method(*args, **kwargs):
            value = None
            if method_name == "fill":
                value = args[0] if args else kwargs.get("value")
            elif method_name in ["type", "press", "select_option"] and args:
                value = args[0]
                
            start_time = datetime.now(tz=timezone.utc)
            try:
                result = original_method(*args, **kwargs)
                end_time = datetime.now(tz=timezone.utc)
                recorder.record_action(
                    action=method_name,
                    selector=selector_repr,
                    value=str(value) if value is not None else None,
                    start_time=start_time,
                    end_time=end_time,
                    status="passed"
                )
                return result
            except Exception as e:
                end_time = datetime.now(tz=timezone.utc)
                recorder.record_action(
                    action=method_name,
                    selector=selector_repr,
                    value=str(value) if value is not None else None,
                    start_time=start_time,
                    end_time=end_time,
                    status="failed",
                    error_msg=str(e)
                )
                raise
        return wrapped_method

    for method_name in methods_to_wrap:
        if not hasattr(locator, method_name):
            continue
            
        original_method = getattr(locator, method_name)
        setattr(locator, method_name, make_locator_wrapper(method_name, original_method))


def _wrap_playwright_page(page: Any, recorder: _StepRecorder) -> None:
    """Monkey-patch common Playwright page methods to record granular actions."""
    
    # First, wrap page.locator so it returns wrapped locators
    if hasattr(page, "locator"):
        original_locator = page.locator
        @functools.wraps(original_locator)
        def wrapped_locator(*args, **kwargs):
            loc = original_locator(*args, **kwargs)
            _wrap_playwright_locator(loc, recorder)
            return loc
        page.locator = wrapped_locator

    methods_to_wrap = [
        "goto", "click", "dblclick", "fill", "press", "type", 
        "select_option", "check", "uncheck", "hover", 
        "drag_and_drop", "screenshot", "reload",
        "wait_for_selector", "wait_for_load_state", "is_visible"
    ]
    
    def make_wrapper(method_name, original_method):
        @functools.wraps(original_method)
        def wrapped_method(*args, **kwargs):
            # Extract common info
            selector = None
            value = None
            
            # Arguments vary by method
            # Usually first arg is selector, except for goto/reload/screenshot
            try:
                if method_name == "goto":
                    value = args[0] if args else kwargs.get("url")
                elif method_name == "fill":
                    selector = args[0] if args else kwargs.get("selector")
                    value = args[1] if len(args) > 1 else kwargs.get("value")
                elif method_name in ["click", "dblclick", "type", "press", "select_option", "check", "uncheck", "hover", "wait_for_selector", "is_visible"]:
                    selector = args[0] if args else kwargs.get("selector")
                    if method_name in ["type", "press"] and len(args) > 1:
                        value = args[1]
                    elif method_name == "select_option" and len(args) > 1:
                        value = args[1]
            except Exception:
                pass # Safety first
            
            start_time = datetime.now(tz=timezone.utc)
            try:
                result = original_method(*args, **kwargs)
                end_time = datetime.now(tz=timezone.utc)
                recorder.record_action(
                    action=method_name,
                    selector=selector,
                    value=str(value) if value is not None else None,
                    start_time=start_time,
                    end_time=end_time,
                    status="passed"
                )
                return result
            except Exception as e:
                end_time = datetime.now(tz=timezone.utc)
                recorder.record_action(
                    action=method_name,
                    selector=selector,
                    value=str(value) if value is not None else None,
                    start_time=start_time,
                    end_time=end_time,
                    status="failed",
                    error_msg=str(e)
                )
                raise
        return wrapped_method

    for method_name in methods_to_wrap:
        if not hasattr(page, method_name):
            continue
            
        original_method = getattr(page, method_name)
        setattr(page, method_name, make_wrapper(method_name, original_method))


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
        self.run_id = f"run-{self.run_start_ms}-581d5ad8-ce75-4ca5-94a6-ed29c466c815"

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
            if fname.startswith(TEMP_SHARD_PREFIX) or fname.startswith("." + TEMP_SHARD_PREFIX):

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
            
            # Generate HTML reports
            html_dynamic_path = out_path.replace(".json", ".html")
            try:
                generate_dynamic_html(out_path, html_dynamic_path)
                print(f"PulseReport: Dynamic HTML report generated at {html_dynamic_path}")
            except Exception as e:
                print(f"PulseReport: Failed to generate dynamic HTML report: {e}")
                
            html_static_path = out_path.replace(".json", "-static.html")
            if "playwright-pulse-report-static.html" in html_static_path:
                 # Ensure it matches "playwright-pulse-static-report.html" if using default naming
                 html_static_path = html_static_path.replace("playwright-pulse-report-static.html", "playwright-pulse-static-report.html")
            elif "playwright-pulse-report.html" in html_static_path:
                 html_static_path = html_static_path.replace("playwright-pulse-report.html", "playwright-pulse-static-report.html")

            try:
                generate_static_html(out_path, html_static_path)
                print(f"PulseReport: Static HTML report generated at {html_static_path}")
            except Exception as e:
                print(f"PulseReport: Failed to generate static HTML report: {e}")
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
                # Try hidden version if regular one not found
                hidden_path = os.path.join(self.output_dir, f".{TEMP_SHARD_PREFIX}{i}.json")
                if os.path.exists(hidden_path):
                    fpath = hidden_path

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
        
        # CRITICAL FIX: Trigger HTML generation after merging shard files on master
        from .dynamic_generator import generate_dynamic_html
        from .static_generator import generate_static_html
        
        dynamic_html = os.path.join(self.output_dir, "playwright-pulse-report.html")
        static_html = os.path.join(self.output_dir, "playwright-pulse-static-report.html")
        
        print(f"PulseReport: generating reports for merged results...")
        generate_dynamic_html(out_path, dynamic_html)
        generate_static_html(out_path, static_html)
        print(f"PulseReport: reports generated successfully.")

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

    return "N/A"


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
    # Only return the default if it actually exists as a directory
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
        "--pulse-report",
        dest="pulse_report",
        action="store_true",
        default=False,
        help="Enable the pulse report generation",
    )
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
    if not config.option.pulse_report:
        return

    config._pulse_reporter = PulseReporter(config)  # type: ignore[attr-defined]

    # Register custom marks so pytest doesn't warn about unknown marks
    config.addinivalue_line("markers", "pulse_severity(level): set test severity (Minor/Low/Medium/High/Critical)")
    config.addinivalue_line("markers", "pulse_tag(name): tag the test")
    config.addinivalue_line("markers", "pulse_annotation(type, description): add custom annotation")
    config.addinivalue_line("markers", "pulse_browser(name): override detected browser name")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item: pytest.Item, nextitem=None) -> Generator:  # noqa: ARG001
    """Wrap the entire test lifecycle to reliably start & finish tracking."""
    reporter = getattr(item.config, "_pulse_reporter", None)
    if not reporter:
        yield
        return
    reporter.on_test_start(item)
    yield
    reporter.on_test_finish(item)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo) -> Generator:  # noqa: ARG001
    """Capture the report for each phase (setup / call / teardown)."""
    outcome = yield
    reporter = getattr(item.config, "_pulse_reporter", None)
    if not reporter:
        return
    try:
        report: pytest.TestReport = outcome.get_result()
    except Exception:
        return
    reporter.on_test_report(item, report)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    reporter = getattr(session.config, "_pulse_reporter", None)
    if not reporter:
        return

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
    
    pulse_step_context.set(recorder.step)
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


@pytest.fixture(autouse=True)
def _pulse_auto_instrument(request):
    """Automatically instrument Playwright 'page' fixture if it is used."""
    # Check if 'page' is in fixturenames to avoid unnecessary work
    if "page" in request.fixturenames:
        try:
            # This triggers 'page' fixture creation and returns the object
            page = request.getfixturevalue("page")
            recorder = getattr(request.node, "_pulse_recorder", None)
            if recorder:
                pulse_step_context.set(recorder.step)
                if page:
                    _wrap_playwright_page(page, recorder)
        except Exception:
            pass
    else:
        # Even if page is not used, set the context if recorder is available
        recorder = getattr(request.node, "_pulse_recorder", None)
        if recorder:
            pulse_step_context.set(recorder.step)
    
    yield
    # Clear context after test
    pulse_step_context.set(None)
