interface FullConfig {
  workers: number;
  outputDir?: string;
  shard?: { current: number };
  projects: Array<{ name?: string }>;
  metadata?: any;
  configFile?: string;
}

interface FullResult {
  status: string;
  duration: number;
}

interface Reporter {
  onBegin?(config: FullConfig, suite: Suite): void;
  onTestEnd?(test: TestCase, result: PwTestResult): void | Promise<void>;
  onEnd?(result: FullResult): void | Promise<void>;
  onError?(error: Error): void;
  printsToStdio?(): boolean;
}

interface Suite {}

interface TestCase {
  id: string;
  title: string;
  tags: string[];
  location?: {
    file: string;
    line: number;
    column: number;
  };
  titlePath(): string[];
  parent?: {
    title?: string;
    project?(): any;
  };
}

interface PwTestResult {
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  duration: number;
  startTime: Date;
  retry: number;
  workerIndex: number;
  stdout: Array<string | any>;
  stderr: Array<string | any>;
  error?: {
    message?: string;
    stack?: string;
    snippet?: string;
  };
  steps: PwStep[];
  attachments: Array<{
    name: string;
    contentType?: string;
    path?: string;
    body?: any;
  }>;
}

interface PwStep {
  title: string;
  category: string;
  startTime: Date;
  duration: number;
  error?: {
    message?: string;
    stack?: string;
    snippet?: string;
  };
  count?: number;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  steps?: PwStep[];
}

const fs = {
  promises: {
    writeFile: async (path: string, data: string) => {
      console.log(`Would write to ${path}`);
    },
    readFile: async (path: string, encoding?: string) => {
      console.log(`Would read from ${path}`);
      return "{}";
    },
    readdir: async (path: string): Promise<string[]> => {
      console.log(`Would read directory ${path}`);
      return [];
    },
    mkdir: async (path: string, options?: any) => {
      console.log(`Would create directory ${path}`);
    },
    unlink: async (path: string) => {
      console.log(`Would delete ${path}`);
    },
  },
};

const path = {
  resolve: (...paths: string[]) => paths.join("/"),
  join: (...paths: string[]) => paths.join("/"),
  relative: (from: string, to: string) => to,
  dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
  basename: (p: string, ext?: string) => {
    const base = p.split("/").pop() || "";
    return ext ? base.replace(ext, "") : base;
  },
  extname: (p: string) => {
    const parts = p.split(".");
    return parts.length > 1 ? "." + parts.pop() : "";
  },
};

const randomUUID = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const UAParser = class {
  getBrowser() {
    return { name: "unknown", version: "unknown" };
  }
};

const os = {
  type: () => "Linux",
  release: () => "5.4.0",
  arch: () => "x64",
  hostname: () => "localhost",
  platform: () => "linux",
  cpus: () => [{ model: "Intel" }],
  totalmem: () => 8589934592,
};

const process = {
  cwd: () => "/current/working/directory",
  version: "v18.0.0",
  versions: { v8: "10.0.0" },
};

type PulseTestStatus = "passed" | "failed" | "skipped" | "flaky";

interface PulseTestStep {
  title: string;
  category: string;
  startTime: Date;
  duration: number;
  error?: {
    message: string;
    stack?: string;
    snippet?: string;
  };
  count: number;
  location?: string;
  status: PulseTestStatus;
}

interface PlaywrightPulseReporterOptions {
  outputDir?: string;
  outputFile?: string;
  base64Images?: boolean;
  open?: boolean;
  resetOnEachRun?: boolean;
}

interface TestRunAttempt {
  id: string;
  runId: string;
  name: string;
  suiteName?: string;
  status: PulseTestStatus;
  duration: number;
  startTime: Date;
  endTime: Date;
  retry: number;
  steps: PulseTestStep[];
  errorMessage?: string;
  stackTrace?: string;
  snippet?: string;
  codeSnippet?: string;
  tags?: string[];
  browser: string;
  screenshots?: string[];
  videoPath?: string[];
  tracePath?: string;
  attachments?: Array<{
    name: string;
    path: string;
    contentType?: string;
  }>;
  stdout?: string[];
  stderr?: string[];
  workerId?: number;
  totalWorkers?: number;
  configFile?: string;
  metadata?: string;
}

interface ConsolidatedTestResult {
  id: string;
  name: string;
  suiteName?: string;
  status: PulseTestStatus;
  duration: number;
  startTime: Date;
  endTime: Date;
  browser: string;
  tags?: string[];
  results: TestRunAttempt[];
}

interface TestRun {
  id: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  status: string;
  environment: {
    os: string;
    browser: any;
    cpu: string;
  };
}

interface PlaywrightPulseReport {
  run: TestRun;
  results: ConsolidatedTestResult[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    totalTests: number;
  };
}

function convertStatus(
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted"
): PulseTestStatus {
  switch (status) {
    case "passed":
      return "passed";
    case "failed":
    case "timedOut":
    case "interrupted":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      return "failed";
  }
}

function attachFiles(
  testId: string,
  pwResult: PwTestResult,
  pulseResult: TestRunAttempt,
  config: PlaywrightPulseReporterOptions
) {
  const baseReportDir = config.outputDir || "pulse-report";
  const attachmentsBaseDir = path.resolve(baseReportDir, "attachments");
  const attachmentsSubFolder = `${testId}-retry-${pwResult.retry || 0}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );

  pulseResult.screenshots = [];
  pulseResult.videoPath = [];
  pulseResult.attachments = [];

  if (!pwResult.attachments) return;

  pwResult.attachments.forEach((attachment) => {
    const { contentType, name, path: attachmentPath } = attachment;

    if (!attachmentPath) return;

    const relativePath = path.join(
      "attachments",
      attachmentsSubFolder,
      path.basename(attachmentPath)
    );

    if (contentType?.startsWith("image/")) {
      pulseResult.screenshots?.push(relativePath);
    } else if (name === "video" || contentType?.startsWith("video/")) {
      pulseResult.videoPath?.push(relativePath);
    } else if (name === "trace" || contentType === "application/zip") {
      pulseResult.tracePath = relativePath;
    } else {
      pulseResult.attachments?.push({
        name: attachment.name,
        path: relativePath,
        contentType: attachment.contentType,
      });
    }
  });
}

export class PlaywrightPulseReporter implements Reporter {
  private testResults: TestRunAttempt[] = [];
  private currentRunId: string = "";
  private outputDir: string = "";
  private totalWorkers: number = 0;
  private shardIndex?: number;
  private options: PlaywrightPulseReporterOptions;

  constructor(options: PlaywrightPulseReporterOptions = {}) {
    this.options = options;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.currentRunId = randomUUID();
    this.totalWorkers = config.workers;
    this.shardIndex = config.shard?.current;

    this.outputDir = path.resolve(
      this.options.outputDir || config.outputDir || "pulse-report"
    );

    if (this.options.open === undefined) {
      this.options.open = false;
    }
    if (this.options.base64Images === undefined) {
      this.options.base64Images = false;
    }

    console.log(
      `Pulse Reporter: Starting test run with ID: ${this.currentRunId}`
    );
    if (this.shardIndex !== undefined) {
      console.log(`Pulse Reporter: Running shard ${this.shardIndex}`);
    }
  }

  getBrowserDetails(project: any): string {
    if (!project) return "unknown";

    const projectName = project.name || "unknown";
    const browserName = project.use?.browserName || "unknown";
    const channel = project.use?.channel;

    if (channel) {
      return `${browserName}-${channel}`;
    }

    return browserName;
  }

  async processStep(step: PwStep): Promise<PulseTestStep> {
    const stepStatus = convertStatus(step.error ? "failed" : "passed");

    const codeLocation = step.location
      ? `${step.location.file}:${step.location.line}:${step.location.column}`
      : undefined;

    return {
      title: step.title,
      category: step.category,
      startTime: step.startTime,
      duration: step.duration,
      error: step.error
        ? {
            message: step.error.message || "",
            stack: step.error.stack,
            snippet: step.error.snippet,
          }
        : undefined,
      count: step.count || 0,
      location: codeLocation,
      status: stepStatus,
    };
  }

  async onTestEnd(test: TestCase, result: PwTestResult): Promise<void> {
    const processAllSteps = async (
      steps: PwStep[]
    ): Promise<PulseTestStep[]> => {
      const processedSteps: PulseTestStep[] = [];
      for (const step of steps) {
        const processedStep = await this.processStep(step);
        processedSteps.push(processedStep);
        if (step.steps && step.steps.length > 0) {
          const nestedSteps = await processAllSteps(step.steps);
          processedSteps.push(...nestedSteps);
        }
      }
      return processedSteps;
    };

    const project = test.parent?.project?.();
    const relativePath = path.relative(
      process.cwd(),
      test.location?.file || ""
    );

    const testStatus = convertStatus(result.status);
    const startTime = result.startTime;
    const endTime = new Date(startTime.getTime() + result.duration);

    const stdoutMessages = result.stdout
      .filter((msg) => msg.trim().length > 0)
      .map((msg) => msg.toString());
    const stderrMessages = result.stderr
      .filter((msg) => msg.trim().length > 0)
      .map((msg) => msg.toString());

    const mappedWorkerId =
      result.workerIndex !== undefined ? result.workerIndex + 1 : undefined;

    const testSpecificData = {
      workerId: mappedWorkerId,
      totalWorkers: this.totalWorkers,
      configFile: relativePath,
      metadata: JSON.stringify({ project: project?.name }),
    };

    const pulseResult: TestRunAttempt = {
      id: test.id,
      runId: this.currentRunId,
      name: `${project?.name || "unknown"} > ${test.parent?.title || ""} > ${
        test.title
      }`,
      suiteName: project?.name,
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      retry: result.retry,
      steps: await processAllSteps(result.steps),
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      snippet: result.error?.snippet,
      codeSnippet: result.error?.snippet,
      tags: test.tags,
      browser: this.getBrowserDetails(project),
      screenshots: [],
      videoPath: [],
      attachments: [],
      stdout: stdoutMessages,
      stderr: stderrMessages,
      ...testSpecificData,
    };

    attachFiles(test.id, result, pulseResult, this.options);
    this.testResults.push(pulseResult);
  }

  private _getFinalizedResults(
    allAttempts: TestRunAttempt[]
  ): ConsolidatedTestResult[] {
    const groupedResults = new Map<string, TestRunAttempt[]>();

    for (const attempt of allAttempts) {
      const baseTestId = attempt.id;
      if (!groupedResults.has(baseTestId)) {
        groupedResults.set(baseTestId, []);
      }
      groupedResults.get(baseTestId)!.push(attempt);
    }

    const finalResults: ConsolidatedTestResult[] = [];

    for (const [baseId, attempts] of groupedResults.entries()) {
      attempts.sort((a, b) => a.retry - b.retry);

      let overallStatus: PulseTestStatus = "passed";
      const statuses = attempts.map((a) => a.status);
      const hasFailures = statuses.some((s) => s === "failed");
      const hasPasses = statuses.some((s) => s === "passed");

      if (hasFailures && hasPasses) {
        overallStatus = "flaky";
      } else if (hasFailures) {
        overallStatus = "failed";
      } else if (statuses.some((s) => s === "skipped")) {
        overallStatus = "skipped";
      } else {
        overallStatus = "passed";
      }

      const startTimes = attempts.map((a) => a.startTime.getTime());
      const endTimes = attempts.map((a) => a.endTime.getTime());
      const overallDuration = Math.max(...endTimes) - Math.min(...startTimes);

      const baseAttempt = attempts[0];

      finalResults.push({
        id: baseId,
        name: baseAttempt.name,
        suiteName: baseAttempt.suiteName,
        status: overallStatus,
        duration: overallDuration,
        startTime: new Date(Math.min(...startTimes)),
        endTime: new Date(Math.max(...endTimes)),
        browser: baseAttempt.browser,
        tags: baseAttempt.tags,
        results: attempts,
      });
    }

    return finalResults;
  }

  private _getSummaryStats(consolidatedResults: ConsolidatedTestResult[]): {
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    totalTests: number;
  } {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let flaky = 0;

    for (const result of consolidatedResults) {
      switch (result.status) {
        case "passed":
          passed++;
          break;
        case "failed":
          failed++;
          break;
        case "skipped":
          skipped++;
          break;
        case "flaky":
          flaky++;
          break;
      }
    }

    return {
      passed,
      failed,
      skipped,
      flaky,
      totalTests: consolidatedResults.length,
    };
  }

  onError(error: Error): void {
    console.error("Pulse Reporter: Error occurred:", error);
  }

  private _getEnvDetails() {
    const parser = new UAParser();
    return {
      os: `${os.type()} ${os.release()}`,
      browser: parser.getBrowser(),
      cpu: os.arch(),
    };
  }

  private async _writeShardResults(
    consolidatedResults: ConsolidatedTestResult[]
  ): Promise<void> {
    const tempFilePath = path.join(
      this.outputDir,
      `shard-${this.shardIndex || 0}-results.json`
    );

    try {
      await this._ensureDirExists(path.dirname(tempFilePath));
      const allAttempts: TestRunAttempt[] = [];
      for (const result of consolidatedResults) {
        allAttempts.push(...result.results);
      }
      await fs.promises.writeFile(
        tempFilePath,
        JSON.stringify(allAttempts, null, 2)
      );
    } catch (error) {
      console.error("Pulse Reporter: Error writing shard results:", error);
    }
  }

  private async _mergeShardResults(
    allShardResults: TestRunAttempt[][]
  ): Promise<ConsolidatedTestResult[]> {
    try {
      const allAttempts = allShardResults.flat();
      const consolidatedResults = this._getFinalizedResults(allAttempts);

      const reviveDates = (key: string, value: any) => {
        if (
          typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
        ) {
          return new Date(value);
        }
        return value;
      };
      const properlyTypedResults = JSON.parse(
        JSON.stringify(consolidatedResults),
        reviveDates
      ) as ConsolidatedTestResult[];

      return properlyTypedResults;
    } catch (error) {
      console.error("Pulse Reporter: Error merging shard results:", error);
      return [];
    }
  }

  private async _cleanupTemporaryFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.outputDir);
      const shardFiles = files.filter(
        (file) => file.startsWith("shard-") && file.endsWith("-results.json")
      );

      for (const file of shardFiles) {
        await fs.promises.unlink(path.join(this.outputDir, file));
      }
    } catch (error) {
      console.error(
        "Pulse Reporter: Error cleaning up temporary files:",
        error
      );
    }
  }

  private async _ensureDirExists(dirPath: string): Promise<void> {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error(
        `Pulse Reporter: Error creating directory ${dirPath}:`,
        error
      );
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    try {
      const consolidatedResults = this._getFinalizedResults(this.testResults);
      const stats = this._getSummaryStats(consolidatedResults);

      const runData: TestRun = {
        id: this.currentRunId,
        startTime: new Date(),
        endTime: new Date(),
        duration: result.duration,
        status: result.status,
        environment: this._getEnvDetails(),
      };

      const finalReport: PlaywrightPulseReport = {
        run: runData,
        results: consolidatedResults,
        summary: stats,
      };

      const jsonReplacer = (key: string, value: any) => {
        if (value instanceof Date) {
          return value.toISOString();
        }
        return value;
      };

      if (this.shardIndex !== undefined) {
        await this._writeShardResults(consolidatedResults);
        console.log(
          `Pulse Reporter: Shard ${this.shardIndex} results written.`
        );
      } else {
        const pulseResultsDir = path.join(this.outputDir, "pulse-results");
        await this._ensureDirExists(pulseResultsDir);
        const individualReportPath = path.join(
          pulseResultsDir,
          `${this.currentRunId}-pulse-report.json`
        );

        await fs.promises.writeFile(
          individualReportPath,
          JSON.stringify(finalReport, jsonReplacer, 2)
        );

        const mergedReport = await this._mergeAllRunReports();
        if (mergedReport) {
          const finalReportPath = path.join(
            this.outputDir,
            "playwright-pulse-report.json"
          );
          await fs.promises.writeFile(
            finalReportPath,
            JSON.stringify(mergedReport, jsonReplacer, 2)
          );
          console.log(
            `Pulse Reporter: Final report written to ${finalReportPath}`
          );
        }
      }
    } catch (error) {
      console.error("Pulse Reporter: Error in onEnd:", error);
    }
  }

  private async _mergeAllRunReports(): Promise<PlaywrightPulseReport | null> {
    try {
      const pulseResultsDir = path.join(this.outputDir, "pulse-results");
      const files = await fs.promises.readdir(pulseResultsDir);
      const jsonFiles = files.filter((file) =>
        file.endsWith("-pulse-report.json")
      );

      if (jsonFiles.length === 0) {
        return null;
      }

      const allAttempts: TestRunAttempt[] = [];
      let totalDuration = 0;

      for (const file of jsonFiles) {
        const filePath = path.join(pulseResultsDir, file);
        const content = await fs.promises.readFile(filePath, "utf-8");
        const report = JSON.parse(content) as PlaywrightPulseReport;

        if (report.results) {
          for (const consolidatedResult of report.results) {
            if (
              consolidatedResult.results &&
              consolidatedResult.results.length > 0
            ) {
              allAttempts.push(...consolidatedResult.results);
            }
          }
        }
        if (report.run?.duration) {
          totalDuration += report.run.duration;
        }
      }

      const consolidatedResults = this._getFinalizedResults(allAttempts);
      const stats = this._getSummaryStats(consolidatedResults);

      const combinedRun: TestRun = {
        id: this.currentRunId,
        startTime: new Date(),
        endTime: new Date(),
        duration: totalDuration,
        status: "passed",
        environment: this._getEnvDetails(),
      };

      const finalReport: PlaywrightPulseReport = {
        run: combinedRun,
        results: consolidatedResults,
        summary: stats,
      };

      return finalReport;
    } catch (error) {
      console.error("Pulse Reporter: Error merging all run reports:", error);
      return null;
    }
  }
}
