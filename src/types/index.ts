import type { LucideIcon } from 'lucide-react';

export type TestStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "expected-failure"
  | "unexpected-success"
  | "explicitly-skipped";

export interface TestStep {
  id: string;
  title: string;
  status: TestStatus;
  duration: number; // in milliseconds
  startTime: Date;
  endTime: Date;
  browser: string; // Browser name (e.g., "chromium", "firefox", "webkit")
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
  browser: string; // Browser name (e.g., "chromium", "firefox", "webkit")
  // New fields for refined attachment handling
  screenshots?: string[]; // Array of paths or base64 data URIs for screenshots
  videoPath?: string; // Relative path to the video file
  tracePath?: string; // Relative path to the trace file
  stdout?: string[]; // Standard output captured during the test
  stderr?: string[]; // Standard error captured during the test
  // New fields for testData
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
  duration: number; // total duration for the run
  // New field for getEnvDetails
  environment?: EnvDetails;
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

// Add this new interface
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
