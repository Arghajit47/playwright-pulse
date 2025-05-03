import type { LucideIcon } from 'lucide-react';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestStep {
  id: string;
  title: string;
  status: TestStatus;
  duration: number; // in milliseconds
  startTime: Date;
  endTime: Date;
  errorMessage?: string;
  stackTrace?: string;
  codeLocation?: string;
  isHook?: boolean;
  hookType?: "before" | "after";
  steps?: TestStep[]; // Nested steps
  // Removed step-level attachments as the new logic handles them at the result level
}

export interface TestResult {
  id: string;
  name: string;
  status: TestStatus;
  duration: number; // in milliseconds
  startTime: Date;
  endTime: Date;
  retries: number;
  steps: TestStep[];
  errorMessage?: string;
  stackTrace?: string;
  codeSnippet?: string; // For AI analysis
  tags?: string[];
  suiteName?: string;
  runId: string; // Identifier for the test run this result belongs to

  // New fields for refined attachment handling
  screenshots?: string[]; // Array of paths or base64 data URIs for screenshots
  videoPath?: string; // Relative path to the video file
  tracePath?: string; // Relative path to the trace file
}

export interface TestRun {
  id: string;
  timestamp: Date;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number; // total duration for the run
}

export interface TrendDataPoint {
  date: string; // e.g., "YYYY-MM-DD" or run ID
  passed: number;
  failed: number;
  skipped: number;
}

export interface SummaryMetric {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: string; // Tailwind color class
}

// Options for the reporter
export interface PlaywrightPulseReporterOptions {
  outputFile?: string;
  outputDir?: string;
  base64Images?: boolean; // Option to embed images as base64
}
