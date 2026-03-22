export type TestStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "expected-failure"
  | "unexpected-success"
  | "explicitly-skipped"
  | "flaky";

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
  codeSnippet?: string; // Code snippet from source file with line numbers
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

  outcome?: string; // Captures Playwright's testCase.outcome()
  final_status?: TestStatus; // Captures the Last-Run-Wins status

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

  retryHistory?: TestResult[];
}

export interface TestRun {
  id: string;
  timestamp: Date;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky?: number;
  duration: number; // total duration for the run
  environment?: EnvDetails | EnvDetails[]; // Single for non-sharded, array for merged sharded reports
}

export interface TrendDataPoint {
  date: string; // e.g., "YYYY-MM-DD" or run ID
  passed: number;
  failed: number;
  skipped: number;
  flaky?: number;
}

// Options for the reporter
export interface PlaywrightPulseReporterOptions {
  /**
   * The name of the output JSON file. Kindly do not change.
   * @default "playwright-pulse-report.json"
   */
  outputFile?: string;

  /**
   * The directory where the report files will be generated.
   *
   * Mostly useful while using sharding
   *
   * @default "pulse-report"
   */
  outputDir?: string;

  /**
   * Whether to embed images directly as base64 strings in the report.
   * @default false
   */
  base64Images?: boolean;

  /**
   * Whether to reset the output directory before each run.
   *
   * Mostly useful while running multiple test suites in a single run with `&&` operator.
   *
   * example: `npx playwright test test1.spec.ts && npx playwright test test2.spec.ts`
   *
   * If `resetOnEachRun` is set to `false`, then the report of `test2.spec.ts` will be merged with `test1.spec.ts` report.
   *
   * @default true
   */
  resetOnEachRun?: boolean;

  /**
   * A custom description to embed or display in the report.
   *
   * If not added, the component will not appear in the html reports
   */
  reportDescription?: string;

  /**
   * Path to a custom logo image file to use in the report, which will be displayed in the header of the html report's logo and favicon.
   *
   * If not added, the default logo will be used.
   */
  logo?: string;

  /**
   * The subdirectory within `outputDir` where individual run reports are stored.
   * Only used when `resetOnEachRun` is `false`.
   *
   * @default "pulse-results"
   */
  individualReportsSubDir?: string;
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
