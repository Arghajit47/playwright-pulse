import type { LucideIcon } from "lucide-react";

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
}

export interface TestResult {
  id: string;
  describe?: string; // Add this
  spec_file?: string; // Add this
  name: string;
  status: TestStatus;
  duration: number; // in milliseconds
  startTime: Date;
  endTime: Date;
  retries: number;
  steps: TestStep[];
  errorMessage?: string;
  stackTrace?: string;
  snippet?: string; // For AI analysis
  codeSnippet?: string; // For AI analysis
  tags?: string[];
  severity?: "Minor" | "Low" | "Medium" | "High" | "Critical";
  suiteName?: string;
  runId: string; // Identifier for the test run this belongs to
  browser: string; // Browser name (e.g., "chromium", "firefox", "webkit")

  // --- MODIFIED & NEW ATTACHMENT FIELDS ---
  screenshots?: string[];
  videoPath?: string[]; // MODIFIED: Now an array to support multiple videos
  tracePath?: string;

  // NEW: A generic array for other file types (HTML, PDF, JSON, etc.)
  attachments?: {
    name: string; // Original name of the attachment (e.g., "user-data.json")
    path: string; // Relative path within the report's attachments directory
    contentType: string; // MIME type (e.g., "application/json", "text/html")
  }[];

  stdout?: string[]; // Standard output captured during the test
  stderr?: string[]; // Standard error captured during the test
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
  duration: number; // total duration for the run
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
  base64Images?: boolean;
  resetOnEachRun?: boolean;
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
