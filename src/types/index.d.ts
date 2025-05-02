import type { LucideIcon } from 'lucide-react';
export type TestStatus = 'passed' | 'failed' | 'skipped';
export interface TestStep {
    id: string;
    title: string;
    status: TestStatus;
    duration: number;
    startTime: Date;
    endTime: Date;
    errorMessage?: string;
    screenshot?: string;
    videoTimestamp?: number;
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
    screenshot?: string;
    video?: string;
    tags?: string[];
    suiteName?: string;
    runId: string;
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
