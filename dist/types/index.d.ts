import type { LucideIcon } from 'lucide-react';
export type TestStatus = "passed" | "failed" | "skipped" | "expected-failure" | "unexpected-success" | "explicitly-skipped";
export interface TestStep {
    id: string;
    title: string;
    status: TestStatus;
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
    status: TestStatus;
    duration: number;
    startTime: Date;
    endTime: Date;
    retries: number;
    steps: TestStep[];
    errorMessage?: string;
    stackTrace?: string;
    codeSnippet?: string;
    tags?: string[];
    suiteName?: string;
    runId: string;
    browser: string;
    screenshots?: string[];
    videoPath?: string;
    tracePath?: string;
    stdout?: string[];
    stderr?: string[];
}
export interface TestRun {
    id: string;
    timestamp: Date;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
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
}
