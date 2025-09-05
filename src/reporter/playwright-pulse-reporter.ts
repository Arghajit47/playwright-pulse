// src/reporter/playwright-pulse-reporter.ts
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult as PwTestResult,
  TestStep as PwStep,
} from "@playwright/test/reporter";
import * as fs from "fs/promises";
import * as path from "path";
import type { PlaywrightPulseReport } from "../lib/report-types";

// Import the original types so we can use them for compatibility.
import type {
  TestRun,
  PulseTestStatus,
  TestStep as PulseTestStep,
  PlaywrightPulseReporterOptions,
} from "../types";
import { randomUUID } from "crypto";
import { UAParser } from "ua-parser-js";
import * as os from "os";

// We define our new, specific types here, locally within this file.
// This prevents conflicts with the existing index.ts file.

// This is the new type for a single test run attempt, matching your `onTestEnd` object.
interface TestRunAttempt {
  id: string; // Will include retry counter (e.g., "testId-0", "testId-1")
  runId: string; // Identifier for the test run this belongs to
  name: string;
  suiteName: string | undefined; // This needs to be optional based on your error
  status: PulseTestStatus;
  duration: number; // in milliseconds
  startTime: Date;
  endTime: Date;
  retries: number; // Number of retries for this specific attempt (0 for initial run)
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

// This is the new type that represents a logical test case in the final report.
// It groups all the individual run attempts.
interface ConsolidatedTestResult {
  id: string; // Base test ID (e.g., "testId")
  name: string;
  suiteName?: string;
  status: PulseTestStatus; // The overall status of the test case
  duration: number; // Overall duration
  startTime: Date;
  endTime: Date;
  browser: string;
  tags?: string[];
  runs: TestRunAttempt[]; // The array of all run attempts for this test
}

const convertStatus = (
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted",
  testCase?: TestCase,
  retryCount: number = 0
): PulseTestStatus => {
  if (status === "passed" && retryCount > 0) {
    return "flaky";
  }

  if (testCase?.expectedStatus === "failed") {
    if (status === "passed") return "flaky";
    return "failed";
  }
  if (testCase?.expectedStatus === "skipped") {
    return "skipped";
  }

  switch (status) {
    case "passed":
      return "passed";
    case "failed":
    case "timedOut":
    case "interrupted":
      return "failed";
    case "skipped":
    default:
      return "skipped";
  }
};

const TEMP_SHARD_FILE_PREFIX = ".pulse-shard-results-";
const ATTACHMENTS_SUBDIR = "attachments";
const INDIVIDUAL_REPORTS_SUBDIR = "pulse-results";

export class PlaywrightPulseReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;
  // This will now store all individual run attempts for all tests using our new local type.
  private results: TestRunAttempt[] = [];
  private runStartTime!: number;
  private options: PlaywrightPulseReporterOptions;
  private outputDir: string;
  private attachmentsDir: string;
  private baseOutputFile: string = "playwright-pulse-report.json";
  private isSharded: boolean = false;
  private shardIndex: number | undefined = undefined;
  private resetOnEachRun: boolean;
  private currentRunId: string = "";

  constructor(options: PlaywrightPulseReporterOptions = {}) {
    this.options = options;
    this.baseOutputFile = options.outputFile ?? this.baseOutputFile;
    this.outputDir = options.outputDir ?? "pulse-report";
    this.attachmentsDir = path.join(this.outputDir, ATTACHMENTS_SUBDIR);
    this.resetOnEachRun = options.resetOnEachRun ?? true;
  }

  printsToStdio() {
    return this.shardIndex === undefined || this.shardIndex === 0;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runStartTime = Date.now();
    this.currentRunId = `run-${this.runStartTime}-${randomUUID()}`;

    const configDir = this.config.rootDir;
    const configFileDir = this.config.configFile
      ? path.dirname(this.config.configFile)
      : configDir;
    this.outputDir = path.resolve(
      configFileDir,
      this.options.outputDir ?? "pulse-report"
    );
    this.attachmentsDir = path.resolve(this.outputDir, ATTACHMENTS_SUBDIR);
    this.options.outputDir = this.outputDir;

    const totalShards = this.config.shard ? this.config.shard.total : 1;
    this.isSharded = totalShards > 1;
    this.shardIndex = this.config.shard
      ? this.config.shard.current - 1
      : undefined;

    this._ensureDirExists(this.outputDir)
      .then(() => {
        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: Starting test run with ${
              suite.allTests().length
            } tests${
              this.isSharded ? ` across ${totalShards} shards` : ""
            }. Pulse outputting to ${this.outputDir}`
          );
          if (
            this.shardIndex === undefined ||
            (this.isSharded && this.shardIndex === 0)
          ) {
            return this._cleanupTemporaryFiles();
          }
        }
      })
      .catch((err) =>
        console.error("Pulse Reporter: Error during initialization:", err)
      );
  }

  onTestBegin(test: TestCase): void {}

  private getBrowserDetails(test: TestCase): string {
    const project = test.parent?.project();
    const projectConfig = project?.use;
    const userAgent = projectConfig?.userAgent;
    const configuredBrowserType = projectConfig?.browserName?.toLowerCase();

    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    let browserName = result.browser.name;
    const browserVersion = result.browser.version
      ? ` v${result.browser.version.split(".")[0]}`
      : "";
    const osName = result.os.name ? ` on ${result.os.name}` : "";
    const osVersion = result.os.version
      ? ` ${result.os.version.split(".")[0]}`
      : "";
    const deviceType = result.device.type;
    let finalString;

    if (browserName === undefined) {
      browserName = configuredBrowserType;
      finalString = `${browserName}`;
    } else {
      if (deviceType === "mobile" || deviceType === "tablet") {
        if (result.os.name?.toLowerCase().includes("android")) {
          if (browserName.toLowerCase().includes("chrome"))
            browserName = "Chrome Mobile";
          else if (browserName.toLowerCase().includes("firefox"))
            browserName = "Firefox Mobile";
          else if (result.engine.name === "Blink" && !result.browser.name)
            browserName = "Android WebView";
          else if (
            browserName &&
            !browserName.toLowerCase().includes("mobile")
          ) {
            // Keep it as is
          } else {
            browserName = "Android Browser";
          }
        } else if (result.os.name?.toLowerCase().includes("ios")) {
          browserName = "Mobile Safari";
        }
      } else if (browserName === "Electron") {
        browserName = "Electron App";
      }
      finalString = `${browserName}${browserVersion}${osName}${osVersion}`;
    }

    return finalString.trim();
  }

  private async processStep(
    step: PwStep,
    testId: string,
    browserDetails: string,
    testCase?: TestCase,
    retryCount: number = 0
  ): Promise<PulseTestStep> {
    let stepStatus: PulseTestStatus = "passed";
    let errorMessage = step.error?.message || undefined;

    if (step.error?.message?.startsWith("Test is skipped:")) {
      stepStatus = "skipped";
    } else {
      stepStatus = convertStatus(
        step.error ? "failed" : "passed",
        testCase,
        retryCount
      );
    }

    const duration = step.duration;
    const startTime = new Date(step.startTime);
    const endTime = new Date(startTime.getTime() + Math.max(0, duration));
    let codeLocation = "";
    if (step.location) {
      codeLocation = `${path.relative(
        this.config.rootDir,
        step.location.file
      )}:${step.location.line}:${step.location.column}`;
    }

    return {
      id: `${testId}_step_${startTime.toISOString()}-${duration}-${randomUUID()}`,
      title: step.title,
      status: stepStatus,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserDetails,
      errorMessage: errorMessage,
      stackTrace: step.error?.stack || undefined,
      codeLocation: codeLocation || undefined,
      isHook: step.category === "hook",
      hookType:
        step.category === "hook"
          ? step.title.toLowerCase().includes("before")
            ? "before"
            : "after"
          : undefined,
      steps: [],
    };
  }

  async onTestEnd(test: TestCase, result: PwTestResult): Promise<void> {
    const project = test.parent?.project();
    const browserDetails = this.getBrowserDetails(test);
    const testStatus = convertStatus(result.status, test, result.retry);
    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration);

    const processAllSteps = async (
      steps: PwStep[]
    ): Promise<PulseTestStep[]> => {
      let processed: PulseTestStep[] = [];
      for (const step of steps) {
        const processedStep = await this.processStep(
          step,
          test.id,
          browserDetails,
          test,
          result.retry
        );
        processed.push(processedStep);
        if (step.steps && step.steps.length > 0) {
          processedStep.steps = await processAllSteps(step.steps);
        }
      }
      return processed;
    };

    let codeSnippet: string | undefined = undefined;
    try {
      if (test.location?.file && test.location?.line && test.location?.column) {
        const relativePath = path.relative(
          this.config.rootDir,
          test.location.file
        );
        codeSnippet = `Test defined at: ${relativePath}:${test.location.line}:${test.location.column}`;
      }
    } catch (e) {
      console.warn(
        `Pulse Reporter: Could not extract code snippet for ${test.title}`,
        e
      );
    }

    const stdoutMessages: string[] = result.stdout.map((item) =>
      typeof item === "string" ? item : item.toString()
    );
    const stderrMessages: string[] = result.stderr.map((item) =>
      typeof item === "string" ? item : item.toString()
    );

    const maxWorkers = this.config.workers;
    let mappedWorkerId: number | undefined =
      result.workerIndex === -1
        ? -1
        : (result.workerIndex % (maxWorkers > 0 ? maxWorkers : 1)) + 1;

    const testSpecificData = {
      workerId: mappedWorkerId,
      totalWorkers: maxWorkers,
      configFile: this.config.configFile,
      metadata: this.config.metadata
        ? JSON.stringify(this.config.metadata)
        : undefined,
    };

    const testIdWithRetries = `${test.id}-${result.retry}`;

    const pulseResult: TestRunAttempt = {
      id: testIdWithRetries, // Modified: Use retry number instead of "run-X"
      runId: this.currentRunId, // Keep same runId for all retries of the same test
      name: test.titlePath().join(" > "),
      suiteName:
        project?.name || this.config.projects[0]?.name || "Default Suite",
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserDetails,
      retries: result.retry, // This is the retry count (0 for initial run, 1+ for retries)
      steps: result.steps?.length ? await processAllSteps(result.steps) : [],
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      snippet: result.error?.snippet,
      codeSnippet: codeSnippet,
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag
      ),
      screenshots: [],
      videoPath: [],
      tracePath: undefined,
      attachments: [],
      stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
      stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
      ...testSpecificData,
    };

    for (const [index, attachment] of result.attachments.entries()) {
      if (!attachment.path) continue;

      try {
        const testSubfolder = testIdWithRetries.replace(/[^a-zA-Z0-9_-]/g, "_");
        const safeAttachmentName = path
          .basename(attachment.path)
          .replace(/[^a-zA-Z0-9_.-]/g, "_");
        const uniqueFileName = `${index}-${Date.now()}-${safeAttachmentName}`;
        const relativeDestPath = path.join(
          ATTACHMENTS_SUBDIR,
          testSubfolder,
          uniqueFileName
        );
        const absoluteDestPath = path.join(this.outputDir, relativeDestPath);
        await this._ensureDirExists(path.dirname(absoluteDestPath));
        await fs.copyFile(attachment.path, absoluteDestPath);

        if (attachment.contentType.startsWith("image/")) {
          pulseResult.screenshots?.push(relativeDestPath);
        } else if (attachment.contentType.startsWith("video/")) {
          pulseResult.videoPath?.push(relativeDestPath);
        } else if (attachment.name === "trace") {
          pulseResult.tracePath = relativeDestPath;
        } else {
          pulseResult.attachments?.push({
            name: attachment.name,
            path: relativeDestPath,
            contentType: attachment.contentType,
          });
        }
      } catch (err: any) {
        console.error(
          `Pulse Reporter: Failed to process attachment "${attachment.name}" for test ${pulseResult.name}. Error: ${err.message}`
        );
      }
    }

    this.results.push(pulseResult);
  }

  private _getBaseTestId(testResultId: string): string {
    const parts = testResultId.split("-");
    if (parts.length > 1 && !isNaN(parseInt(parts[parts.length - 1]))) {
      return parts.slice(0, -1).join("-");
    }
    return testResultId;
  }

  private _getStatusOrder(status: PulseTestStatus): number {
    switch (status) {
      case "passed":
        return 1;
      case "flaky":
        return 2;
      case "failed":
        return 3;
      case "skipped":
        return 4;
      default:
        return 99;
    }
  }

  /**
   * Modified: Groups all run attempts for a single logical test case.
   * This ensures that tests with multiple retries are counted as single test case
   * while preserving all retry data in the JSON report.
   * @param allAttempts An array of all individual test run attempts.
   * @returns An array of ConsolidatedTestResult objects, where each object represents one logical test and contains an array of all its runs.
   */
  private _getFinalizedResults(
    allAttempts: TestRunAttempt[]
  ): ConsolidatedTestResult[] {
    const groupedResults = new Map<string, TestRunAttempt[]>();
    for (const attempt of allAttempts) {
      const baseTestId = this._getBaseTestId(attempt.id);
      if (!groupedResults.has(baseTestId)) {
        groupedResults.set(baseTestId, []);
      }
      groupedResults.get(baseTestId)!.push(attempt);
    }

    const finalResults: ConsolidatedTestResult[] = [];
    for (const [baseId, runs] of groupedResults.entries()) {
      // Sort runs to find the best status (passed > flaky > failed > skipped)
      runs.sort(
        (a, b) =>
          this._getStatusOrder(a.status) - this._getStatusOrder(b.status)
      );
      const bestRun = runs[0];

      let overallStatus = bestRun.status;
      if (runs.length > 1) {
        const hasPassedRun = runs.some((run) => run.status === "passed");
        const hasFailedRun = runs.some((run) => run.status === "failed");
        if (hasPassedRun && hasFailedRun) {
          overallStatus = "flaky";
        }
      }

      // Calculate total duration from the earliest start to the latest end time of all runs
      const startTimes = runs.map((run) => run.startTime.getTime());
      const endTimes = runs.map((run) => run.endTime.getTime());
      const overallDuration = Math.max(...endTimes) - Math.min(...startTimes);

      finalResults.push({
        id: baseId,
        name: bestRun.name,
        suiteName: bestRun.suiteName,
        status: overallStatus, // Use the determined overall status
        duration: overallDuration,
        startTime: new Date(Math.min(...startTimes)),
        endTime: new Date(Math.max(...endTimes)),
        browser: bestRun.browser,
        tags: bestRun.tags,
        runs: runs.sort((a, b) => a.retries - b.retries), // Sort runs chronologically for the report
      });
    }

    return finalResults;
  }

  onError(error: any): void {
    console.error(
      `PlaywrightPulseReporter: Error encountered (Shard: ${
        this.shardIndex ?? "Main"
      }):`,
      error?.message || error
    );
    if (error?.stack) {
      console.error(error.stack);
    }
  }

  private _getEnvDetails() {
    return {
      host: os.hostname(),
      os: `${os.platform()} ${os.release()}`,
      cpu: {
        model: os.cpus()[0] ? os.cpus()[0].model : "N/A",
        cores: os.cpus().length,
      },
      memory: `${(os.totalmem() / 1024 ** 3).toFixed(2)}GB`,
      node: process.version,
      v8: process.versions.v8,
      cwd: process.cwd(),
    };
  }

  private async _writeShardResults(): Promise<void> {
    if (this.shardIndex === undefined) {
      return;
    }
    const tempFilePath = path.join(
      this.outputDir,
      `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`
    );
    try {
      await fs.writeFile(
        tempFilePath,
        JSON.stringify(
          this.results,
          (key, value) => (value instanceof Date ? value.toISOString() : value),
          2
        )
      );
    } catch (error) {
      console.error(
        `Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`,
        error
      );
    }
  }

  private async _mergeShardResults(
    finalRunData: TestRun
  ): Promise<PlaywrightPulseReport> {
    let allShardRawResults: TestRunAttempt[] = [];
    const totalShards = this.config.shard ? this.config.shard.total : 1;

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        const shardResults = JSON.parse(content) as TestRunAttempt[];
        allShardRawResults = allShardRawResults.concat(shardResults);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          console.warn(
            `Pulse Reporter: Shard results file not found: ${tempFilePath}. This might be normal if a shard had no tests or failed early.`
          );
        } else {
          console.error(
            `Pulse Reporter: Could not read/parse results from shard ${i} (${tempFilePath}). Error:`,
            error
          );
        }
      }
    }

    const finalResultsList = this._getFinalizedResults(allShardRawResults);

    finalRunData.passed = finalResultsList.filter(
      (r) => r.status === "passed"
    ).length;
    finalRunData.failed = finalResultsList.filter(
      (r) => r.status === "failed"
    ).length;
    finalRunData.skipped = finalResultsList.filter(
      (r) => r.status === "skipped"
    ).length;
    finalRunData.flaky = finalResultsList.filter(
      (r) => r.status === "flaky"
    ).length;
    finalRunData.totalTests = finalResultsList.length;

    const reviveDates = (key: string, value: any): any => {
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
      if (typeof value === "string" && isoDateRegex.test(value)) {
        const date = new Date(value);
        return !isNaN(date.getTime()) ? date : value;
      }
      return value;
    };
    const properlyTypedResults = JSON.parse(
      JSON.stringify(finalResultsList),
      reviveDates
    );

    return {
      run: finalRunData,
      results: properlyTypedResults,
      metadata: { generatedAt: new Date().toISOString() },
    };
  }

  private async _cleanupTemporaryFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.outputDir);
      const tempFiles = files.filter((f) =>
        f.startsWith(TEMP_SHARD_FILE_PREFIX)
      );
      if (tempFiles.length > 0) {
        await Promise.all(
          tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f)))
        );
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        console.warn(
          "Pulse Reporter: Warning during cleanup of temporary files:",
          error.message
        );
      }
    }
  }

  private async _ensureDirExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      if (error.code !== "EEXIST") {
        console.error(
          `Pulse Reporter: Failed to ensure directory exists: ${dirPath}`,
          error
        );
        throw error;
      }
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.shardIndex !== undefined) {
      await this._writeShardResults();
      return;
    }
    let finalReport;

    const allAttempts = this.results;

    const summaryResults = this._getFinalizedResults(this.results);

    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runId = this.currentRunId;
    const environmentDetails = this._getEnvDetails();

    const runData: TestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      totalTests: summaryResults.length, // Count each logical test once
      passed: summaryResults.filter((r) => r.status === "passed").length,
      failed: summaryResults.filter((r) => r.status === "failed").length,
      skipped: summaryResults.filter((r) => r.status === "skipped").length,
      flaky: summaryResults.filter((r) => r.status === "flaky").length,
      duration,
      environment: environmentDetails,
    };

    finalReport = {
      run: runData,
      results: allAttempts, // Include all retry attempts in the JSON
      metadata: { generatedAt: new Date().toISOString() },
    };

    if (this.isSharded) {
      finalReport = await this._mergeShardResults(runData);
    } else {
      finalReport = {
        run: runData,
        results: allAttempts, // Modified: Use all attempts instead of consolidated
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

    if (!finalReport) {
      console.error(
        "PlaywrightPulseReporter: CRITICAL - finalReport object was not generated. Cannot create summary."
      );
      return;
    }

    const jsonReplacer = (key: string, value: any) => {
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "bigint") return value.toString();
      return value;
    };

    if (this.resetOnEachRun) {
      const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);
      try {
        await this._ensureDirExists(this.outputDir);
        await fs.writeFile(
          finalOutputPath,
          JSON.stringify(finalReport, jsonReplacer, 2)
        );
        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`
          );
        }
      } catch (error: any) {
        console.error(
          `Pulse Reporter: Failed to write final JSON report to ${finalOutputPath}. Error: ${error.message}`
        );
      }
    } else {
      const pulseResultsDir = path.join(
        this.outputDir,
        INDIVIDUAL_REPORTS_SUBDIR
      );
      const individualReportPath = path.join(
        pulseResultsDir,
        `playwright-pulse-report-${Date.now()}.json`
      );

      try {
        await this._ensureDirExists(pulseResultsDir);
        await fs.writeFile(
          individualReportPath,
          JSON.stringify(finalReport, jsonReplacer, 2)
        );

        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: Individual run report for merging written to ${individualReportPath}`
          );
        }
        await this._mergeAllRunReports();
      } catch (error: any) {
        console.error(
          `Pulse Reporter: Failed to write or merge report. Error: ${error.message}`
        );
      }
    }

    if (this.isSharded) {
      await this._cleanupTemporaryFiles();
    }
  }

  private async _mergeAllRunReports(): Promise<void> {
    const pulseResultsDir = path.join(
      this.outputDir,
      INDIVIDUAL_REPORTS_SUBDIR
    );
    const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);

    let reportFiles: string[];
    try {
      const allFiles = await fs.readdir(pulseResultsDir);
      reportFiles = allFiles.filter(
        (file) =>
          file.startsWith("playwright-pulse-report-") && file.endsWith(".json")
      );
    } catch (error: any) {
      if (error.code === "ENOENT") {
        if (this.printsToStdio()) {
          console.log(
            `Pulse Reporter: No individual reports directory found at ${pulseResultsDir}. Skipping merge.`
          );
        }
        return;
      }
      console.error(
        `Pulse Reporter: Error reading report directory ${pulseResultsDir}:`,
        error
      );
      return;
    }

    if (reportFiles.length === 0) {
      if (this.printsToStdio()) {
        console.log(
          "Pulse Reporter: No matching JSON report files found to merge."
        );
      }
      return;
    }

    const allResultsFromAllFiles: TestRunAttempt[] = [];
    let latestTimestamp = new Date(0);
    let lastRunEnvironment: any = undefined;
    let earliestStartTime = Date.now();
    let latestEndTime = 0;

    for (const file of reportFiles) {
      const filePath = path.join(pulseResultsDir, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const json: PlaywrightPulseReport = JSON.parse(content);

        if (json.results) {
          json.results.forEach((testResult) => {
            // Check if the TestResult has a 'runs' array (new format)
            if ("runs" in testResult && Array.isArray(testResult.runs)) {
              allResultsFromAllFiles.push(...testResult.runs);
            } else {
              // This is the old format (single run). We'll treat it as a single attempt.
              allResultsFromAllFiles.push(testResult as any);
            }
          });
        }
      } catch (err: any) {
        console.warn(
          `Pulse Reporter: Could not parse report file ${filePath}. Skipping. Error: ${err.message}`
        );
      }
    }

    const finalMergedResults = this._getFinalizedResults(
      allResultsFromAllFiles
    );

    for (const res of finalMergedResults) {
      if (res.startTime.getTime() < earliestStartTime)
        earliestStartTime = res.startTime.getTime();
      if (res.endTime.getTime() > latestEndTime)
        latestEndTime = res.endTime.getTime();
    }
    const totalDuration =
      latestEndTime > earliestStartTime ? latestEndTime - earliestStartTime : 0;

    const combinedRun: TestRun = {
      id: `merged-${Date.now()}`,
      timestamp: latestTimestamp,
      environment: lastRunEnvironment,
      totalTests: finalMergedResults.length, // Count each logical test once
      passed: finalMergedResults.filter((r) => r.status === "passed").length,
      failed: finalMergedResults.filter((r) => r.status === "failed").length,
      skipped: finalMergedResults.filter((r) => r.status === "skipped").length,
      flaky: finalMergedResults.filter((r) => r.status === "flaky").length,
      duration: totalDuration,
    };

    const finalReport: PlaywrightPulseReport = {
      run: combinedRun,
      results: finalMergedResults as any,
      metadata: {
        generatedAt: new Date().toISOString(),
      },
    };

    try {
      await fs.writeFile(
        finalOutputPath,
        JSON.stringify(
          finalReport,
          (key, value) => {
            if (value instanceof Date) return value.toISOString();
            return value;
          },
          2
        )
      );
      if (this.printsToStdio()) {
        console.log(
          `PlaywrightPulseReporter: ✅ Merged report with ${finalMergedResults.length} total results saved to ${finalOutputPath}`
        );
      }
    } catch (err: any) {
      console.error(
        `Pulse Reporter: Failed to write final merged report to ${finalOutputPath}. Error: ${err.message}`
      );
    }
  }
}

export default PlaywrightPulseReporter;
