import type { LucideIcon } from "lucide-react";
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
    describe?: string;
    spec_file?: string;
    name: string;
    status: TestStatus;
    duration: number;
    startTime: Date;
    endTime: Date;
    retries: number;
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
    annotations?: {
        type: string;
        description?: string;
        location?: {
            file: string;
            line: number;
            column: number;
        };
    }[];
}
export interface TestRun {
    id: string;
    timestamp: Date;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
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
