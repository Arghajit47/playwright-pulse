import type { LucideIcon } from "lucide-react";
export type TestStatus = "passed" | "failed" | "skipped" | "expected-failure" | "unexpected-success" | "explicitly-skipped";
export type PulseTestStatus = TestStatus | "flaky";
export interface TestStep {
    id: string;
    title: string;
    status: PulseTestStatus;
    duration: number;
    startTime: Date;
    endTime: Date;
    browser: string;
    errorMessage?: string;
    stackTrace?: string;
    codeLocation?: string;
    isHook?: boolean;
    hookType?: "before" | "after";
    steps?: TestStep[];
}
export interface TestResult {
    id: string;
    name: string;
    status: PulseTestStatus;
    duration: number;
    startTime: Date;
    endTime: Date;
    retries: number;
    runCounter: number;
    steps: TestStep[];
    errorMessage?: string;
    stackTrace?: string;
    snippet?: string;
    codeSnippet?: string;
    tags?: string[];
    suiteName?: string;
    runId: string;
    browser: string;
    screenshots?: string[];
    videoPath?: string[];
    tracePath?: string;
    attachments?: {
        name: string;
        path: string;
        contentType: string;
    }[];
    stdout?: string[];
    stderr?: string[];
    workerId?: number;
    totalWorkers?: number;
    configFile?: string;
    metadata?: string;
}
export interface TestRun {
    id: string;
    timestamp: Date;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    duration: number;
    environment?: EnvDetails;
}
export interface TrendDataPoint {
    date: string;
    passed: number;
    failed: number;
    skipped: number;
}
export interface SummaryMetric {
    label: string;
    value: string | number;
    icon: LucideIcon;
    color?: string;
}
export interface PlaywrightPulseReporterOptions {
    outputFile?: string;
    outputDir?: string;
    base64Images?: boolean;
    resetOnEachRun?: boolean;
}
export interface EnvDetails {
    host: string;
    os: string;
    cpu: {
        model: string;
        cores: number;
    };
    memory: string;
    node: string;
    v8: string;
    cwd: string;
}
