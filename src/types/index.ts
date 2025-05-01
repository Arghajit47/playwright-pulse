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
  screenshot?: string; // URL or path
  videoTimestamp?: number; // Timestamp in video
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
  screenshot?: string; // Final screenshot on failure
  video?: string; // URL or path to video
  tags?: string[];
  suiteName?: string;
  runId: string; // Identifier for the test run this result belongs to
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
