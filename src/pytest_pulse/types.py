"""Data types matching the TypeScript types in the JS playwright-pulse package."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional, Literal, Union
from datetime import datetime, timezone

TestStatus = Literal[
    "passed",
    "failed",
    "skipped",
    "expected-failure",
    "unexpected-success",
    "explicitly-skipped",
    "flaky",
]

Severity = Literal["Minor", "Low", "Medium", "High", "Critical"]


@dataclass
class StepLocation:
    file: str
    line: int
    column: int


@dataclass
class Annotation:
    type: str
    description: Optional[str] = None
    location: Optional[StepLocation] = None


@dataclass
class TestAction:
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None
    status: str = "passed"
    duration: float = 0.0          # milliseconds
    startTime: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))
    endTime: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))
    errorMessage: Optional[str] = None


@dataclass
class TestStep:
    id: str
    title: str
    status: str
    duration: float          # milliseconds
    startTime: datetime
    endTime: datetime
    browser: str
    errorMessage: Optional[str] = None
    stackTrace: Optional[str] = None
    codeLocation: Optional[str] = None
    snippet: Optional[str] = None
    isHook: bool = False
    hookType: Optional[str] = None  # "before" | "after"
    steps: List["TestStep"] = field(default_factory=list)
    actions: List[TestAction] = field(default_factory=list)


@dataclass
class Attachment:
    name: str
    path: str
    contentType: str


@dataclass
class CpuInfo:
    model: str
    cores: int


@dataclass
class EnvDetails:
    host: str
    os: str
    cpu: CpuInfo
    memory: str
    node: str       # "python 3.11.0"
    cwd: str


@dataclass
class TestResult:
    id: str
    runId: str
    name: str
    status: str
    duration: float          # milliseconds
    startTime: datetime
    endTime: datetime
    retries: int
    steps: List[TestStep]
    browser: str
    describe: str = "n/a"
    spec_file: str = "n/a"
    errorMessage: Optional[str] = None
    stackTrace: Optional[str] = None
    snippet: Optional[str] = None
    codeSnippet: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    severity: str = "Medium"
    suiteName: str = "Default Suite"
    outcome: Optional[str] = None
    final_status: Optional[str] = None
    screenshots: List[str] = field(default_factory=list)
    videoPath: List[str] = field(default_factory=list)
    tracePath: Optional[str] = None
    attachments: List[Attachment] = field(default_factory=list)
    stdout: Optional[List[str]] = None
    stderr: Optional[List[str]] = None
    workerId: Optional[int] = None
    totalWorkers: Optional[int] = None
    configFile: Optional[str] = None
    metadata: Optional[str] = None
    annotations: Optional[List[Annotation]] = None
    retryHistory: Optional[List["TestResult"]] = None


@dataclass
class TestRun:
    id: str
    timestamp: datetime
    totalTests: int
    passed: int
    failed: int
    skipped: int
    flaky: int
    duration: float          # milliseconds
    environment: Optional[Union[EnvDetails, List[EnvDetails]]] = None


@dataclass
class ReportMetadata:
    generatedAt: str
    reportDescription: Optional[str] = None
    logo: Optional[str] = None


@dataclass
class PulseReport:
    run: Optional[TestRun]
    results: List[TestResult]
    metadata: ReportMetadata


@dataclass
class TrendDataPoint:
    date: str
    passed: int
    failed: int
    skipped: int
    flaky: int = 0
    duration: float = 0.0
