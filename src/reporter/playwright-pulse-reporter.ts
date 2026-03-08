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
import type {
  TestResult,
  TestRun,
  TestStatus as PulseTestStatus,
  TestStep as PulseTestStep,
  PlaywrightPulseReporterOptions,
} from "../types";
import { randomUUID } from "crypto";
import UAParser from "ua-parser-js";
import * as os from "os";
import { compressAttachment } from "../utils/compression-utils";


const convertStatus = (
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted",
  testCase?: TestCase
): PulseTestStatus => {
  if (testCase?.expectedStatus === "failed") {
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
  private results: TestResult[] = [];
  private _pendingTestEnds: Promise<void>[] = [];
  private runStartTime!: number;
  private options: PlaywrightPulseReporterOptions;
  private outputDir: string;
  private attachmentsDir: string;
  private baseOutputFile: string = "playwright-pulse-report.json";
  private isSharded: boolean = false;
  private shardIndex: number | undefined = undefined;
  private resetOnEachRun: boolean;

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
    const configDir = this.config.rootDir;
    const configFileDir = this.config.configFile
      ? path.dirname(this.config.configFile)
      : configDir;
    this.outputDir = path.resolve(
      configFileDir,
      this.options.outputDir ?? "pulse-report",
    );
    this.attachmentsDir = path.resolve(this.outputDir, ATTACHMENTS_SUBDIR);
    this.options.outputDir = this.outputDir;

    const totalShards = this.config.shard ? this.config.shard.total : 1;
    this.isSharded = totalShards > 1;
    this.shardIndex = this.config.shard
      ? this.config.shard.current - 1
      : undefined;

    this._ensureDirExists(this.outputDir)
      .then(async () => {
        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: Starting test run with ${
              suite.allTests().length
            } tests${
              this.isSharded ? ` across ${totalShards} shards` : ""
            }. Pulse outputting to ${this.outputDir}`,
          );
          if (
            this.shardIndex === undefined ||
            (this.isSharded && this.shardIndex === 0)
          ) {
            await this._cleanupTemporaryFiles();
          }
        }
        // When not resetting on each run, clear stale individual run files
        // from previous sessions. Without this, _mergeAllRunReports() reads
        // ALL accumulated files and de-duplicates by test.id, which collapses
        // results from different sessions into fewer entries than expected.
        if (!this.resetOnEachRun) {
          await this._cleanupStaleRunReports();
        }
      })
      .catch((err) =>
        console.error("Pulse Reporter: Error during initialization:", err),
      );
  }

  onTestBegin(test: TestCase): void {
    console.log(`Starting test: ${test.title}`);
  }

  private _getSeverity(
    annotations: { type: string; description?: string }[],
  ): string {
    const severityAnnotation = annotations.find(
      (a) => a.type === "pulse_severity",
    );
    return severityAnnotation?.description || "Medium";
  }

  private extractCodeSnippet(
    filePath: string,
    targetLine: number,
    targetColumn: number,
  ): string {
    try {
      const fsSync = require("fs");
      if (!fsSync.existsSync(filePath)) {
        return "";
      }

      const content = fsSync.readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      if (targetLine < 1 || targetLine > lines.length) {
        return "";
      }

      return lines[targetLine - 1]?.trim() || "";
    } catch (e) {
      return "";
    }
  }

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
  ): Promise<PulseTestStep> {
    let stepStatus: PulseTestStatus = "passed";
    let errorMessage = step.error?.message || undefined;

    if (step.error?.message?.startsWith("Test is skipped:")) {
      stepStatus = "skipped";
    } else {
      stepStatus = convertStatus(step.error ? "failed" : "passed", testCase);
    }

    const duration = step.duration;
    const startTime = new Date(step.startTime);
    const endTime = new Date(startTime.getTime() + Math.max(0, duration));
    let codeLocation = "";
    let codeSnippet: string = "";

    if (step.location) {
      codeLocation = `${path.relative(
        this.config.rootDir,
        step.location.file,
      )}:${step.location.line}:${step.location.column}`;

      codeSnippet = this.extractCodeSnippet(
        step.location.file,
        step.location.line,
        step.location.column,
      );
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
      codeSnippet: codeSnippet,
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
    // Track this async call so onEnd() can wait for all in-flight processing
    // before it reads this.results. This prevents the race condition where
    // onEnd() fires before an interrupted test's onTestEnd() has finished
    // its async attachment I/O and pushed to this.results.
    const p = this._processTestEnd(test, result);
    this._pendingTestEnds.push(p);
    await p;
  }

  private async _processTestEnd(
    test: TestCase,
    result: PwTestResult,
  ): Promise<void> {
    const project = test.parent?.project();
    const browserDetails = this.getBrowserDetails(test);
    const uniqueTestId = `${project?.name || "default"}-${test.id}`;

    // Captured outcome from Playwright
    const outcome = test.outcome();

    // Calculate final status based on the last result (Last-Run-Wins)
    // result.status in onTestEnd is typically the status of the test run (passed if flaky passed)
    // But we double check the last result in test.results just to be sure/consistent
    const lastResult = test.results[test.results.length - 1];
    const finalStatus = convertStatus(
      lastResult ? lastResult.status : result.status,
      test,
    );

    // Existing behavior: fail if flaky (implied by user request "existing status field should remain failed")
    // If outcome is flaky, status should be 'failed' to indicate initial failure, but final_status is 'passed'
    let testStatus = finalStatus;
    if (outcome === "flaky") {
      testStatus = "flaky";
    }

    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration);

    const processAllSteps = async (
      steps: PwStep[],
    ): Promise<PulseTestStep[]> => {
      let processed: PulseTestStep[] = [];

      for (const step of steps) {
        const processedStep = await this.processStep(
          step,
          uniqueTestId,
          browserDetails,
          test,
        );
        processed.push(processedStep);

        if (step.steps && step.steps.length > 0) {
          processedStep.steps = await processAllSteps(step.steps);
        }
      }
      return processed;
    };

    let codeSnippet: string = "";
    if (test.location?.file && test.location?.line && test.location?.column) {
      codeSnippet = this.extractCodeSnippet(
        test.location.file,
        test.location.line,
        test.location.column,
      );
    }
    // 1. Get Spec File Name
    const specFileName = test.location?.file
      ? path.basename(test.location.file)
      : "n/a";

    // 2. Get Describe Block Name
    // Check if the immediate parent is a 'describe' block
    let describeBlockName = "n/a";
    if (test.parent?.type === "describe") {
      describeBlockName = test.parent.title;
    }

    const stdoutMessages: string[] = result.stdout.map((item) =>
      typeof item === "string" ? item : item.toString(),
    );
    const stderrMessages: string[] = result.stderr.map((item) =>
      typeof item === "string" ? item : item.toString(),
    );

    const maxWorkers = this.config.workers;
    let mappedWorkerId: number =
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

    const pulseResult: TestResult = {
      id: uniqueTestId,
      runId: "TBD",
      describe: describeBlockName,
      spec_file: specFileName,
      name: test.titlePath().join(" > "),
      suiteName:
        project?.name || this.config.projects[0]?.name || "Default Suite",
      status: testStatus,
      outcome: outcome === "flaky" ? outcome : undefined, // Only Include if flaky
      final_status: finalStatus, // New Field
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserDetails,
      retries: result.retry,
      steps: result.steps ? await processAllSteps(result.steps) : [],
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      snippet: result.error?.snippet,
      codeSnippet: codeSnippet,
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag,
      ),
      severity: this._getSeverity(test.annotations) as any,
      screenshots: [],
      videoPath: [],
      tracePath: undefined,
      attachments: [],
      stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
      stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
      annotations: test.annotations?.length > 0 ? test.annotations : undefined,
      ...testSpecificData,
    };

    for (const [index, attachment] of result.attachments.entries()) {
      if (!attachment.path) continue;

      try {
        const testSubfolder = uniqueTestId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const safeAttachmentName = path
          .basename(attachment.path)
          .replace(/[^a-zA-Z0-9_.-]/g, "_");
        const uniqueFileName = `${index}-${Date.now()}-${safeAttachmentName}`;
        const relativeDestPath = path.join(
          ATTACHMENTS_SUBDIR,
          testSubfolder,
          uniqueFileName,
        );
        const absoluteDestPath = path.join(this.outputDir, relativeDestPath);
        await this._ensureDirExists(path.dirname(absoluteDestPath));

        // Copy file first
        await fs.copyFile(attachment.path, absoluteDestPath);

        // Compress in-place (preserves path/name)
        await compressAttachment(absoluteDestPath, attachment.contentType);

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
          `Pulse Reporter: Failed to process attachment "${attachment.name}" for test ${pulseResult.name}. Error: ${err.message}`,
        );
      }
    }

    this.results.push(pulseResult);
  }

  private _getFinalizedResults(allResults: TestResult[]): TestResult[] {
    const resultsMap = new Map<string, TestResult[]>();

    for (const result of allResults) {
      if (!resultsMap.has(result.id)) {
        resultsMap.set(result.id, []);
      }
      resultsMap.get(result.id)!.push(result);
    }

    const finalResults: TestResult[] = [];

    for (const [testId, attempts] of resultsMap.entries()) {
      // Sort by retry count (ASC) then timestamp (DESC) to ensure stable resolution
      attempts.sort((a, b) => {
        if (a.retries !== b.retries) return a.retries - b.retries;
        return (
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        );
      });

      const firstAttempt = attempts[0];
      const retryAttempts = attempts.slice(1);

      // Only populate retryHistory if there were actual failures that triggered retries
      // If all attempts passed, we don't need to show retry history
      const hasActualRetries =
        retryAttempts.length > 0 &&
        retryAttempts.some(
          (attempt) =>
            attempt.status === "failed" ||
            attempt.status === "flaky" ||
            firstAttempt.status === "failed" ||
            firstAttempt.status === "flaky",
        );

      if (hasActualRetries) {
        firstAttempt.retryHistory = retryAttempts;

        // Calculate final status and outcome from the last attempt if retries exist
        const lastAttempt = attempts[attempts.length - 1];
        firstAttempt.final_status = lastAttempt.status;

        // If the last attempt was flaky, ensure outcome is set on the main result
        if (lastAttempt.outcome === "flaky" || lastAttempt.status === "flaky") {
          firstAttempt.outcome = "flaky";
          firstAttempt.status = "flaky";
        }
      } else {
        // If no actual retries (all attempts passed), ensure final_status and retryHistory are removed
        delete firstAttempt.final_status;
        delete firstAttempt.retryHistory;
      }

      finalResults.push(firstAttempt);
    }

    return finalResults;
  }

  onError(error: any): void {
    console.error(
      `PlaywrightPulseReporter: Error encountered (Shard: ${
        this.shardIndex ?? "Main"
      }):`,
      error?.message || error,
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
      `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`,
    );
    try {
      await fs.writeFile(
        tempFilePath,
        JSON.stringify(
          this.results,
          (key, value) => (value instanceof Date ? value.toISOString() : value),
          2,
        ),
      );
    } catch (error) {
      console.error(
        `Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`,
        error,
      );
    }
  }

  private async _mergeShardResults(
    finalRunData: TestRun,
  ): Promise<PlaywrightPulseReport> {
    let allShardProcessedResults: TestResult[] = [];
    const totalShards = this.config.shard ? this.config.shard.total : 1;

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`,
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        const shardResults = JSON.parse(content) as TestResult[];
        allShardProcessedResults =
          allShardProcessedResults.concat(shardResults);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          console.warn(
            `Pulse Reporter: Shard results file not found: ${tempFilePath}. This might be normal if a shard had no tests or failed early.`,
          );
        } else {
          console.error(
            `Pulse Reporter: Could not read/parse results from shard ${i} (${tempFilePath}). Error:`,
            error,
          );
        }
      }
    }

    const finalResultsList = this._getFinalizedResults(
      allShardProcessedResults,
    );
    finalResultsList.forEach((r) => (r.runId = finalRunData.id));

    finalRunData.passed = finalResultsList.filter(
      (r) => (r.final_status || r.status) === "passed",
    ).length;
    finalRunData.failed = finalResultsList.filter(
      (r) => (r.final_status || r.status) === "failed",
    ).length;
    finalRunData.skipped = finalResultsList.filter(
      (r) => (r.final_status || r.status) === "skipped",
    ).length;
    finalRunData.flaky = finalResultsList.filter(
      (r) => (r.final_status || r.status) === "flaky",
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
      reviveDates,
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
        f.startsWith(TEMP_SHARD_FILE_PREFIX),
      );
      if (tempFiles.length > 0) {
        await Promise.all(
          tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f))),
        );
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        console.warn(
          "Pulse Reporter: Warning during cleanup of temporary files:",
          error.message,
        );
      }
    }
  }

  /**
   * Removes all individual run JSON files from the `pulse-results/` directory
   * that were left over from previous test sessions.
   *
   * When `resetOnEachRun: false`, each run writes its own timestamped JSON to
   * `pulse-results/` and then `_mergeAllRunReports()` merges them all. However,
   * if files from *older* sessions accumulate there (e.g. because a previous run
   * was interrupted before the post-merge cleanup, or because the user ran tests
   * on a previous day), `_getFinalizedResults()` de-duplicates by `test.id` and
   * collapses results from both sessions into a single entry — producing a
   * `totalTests` count lower than the actual number of tests that ran.
   *
   * Cleaning up at `onBegin` time guarantees each run starts with a fresh slate.
   */
  private async _cleanupStaleRunReports(): Promise<void> {
    const pulseResultsDir = path.join(
      this.outputDir,
      INDIVIDUAL_REPORTS_SUBDIR,
    );
    try {
      const files = await fs.readdir(pulseResultsDir);
      const staleFiles = files.filter(
        (f) => f.startsWith("playwright-pulse-report-") && f.endsWith(".json"),
      );
      if (staleFiles.length > 0) {
        await Promise.all(
          staleFiles.map((f) => fs.unlink(path.join(pulseResultsDir, f))),
        );
        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: Cleaned up ${staleFiles.length} stale run report(s) from ${pulseResultsDir}`,
          );
        }
      }
    } catch (error: any) {
      // ENOENT simply means no previous runs exist — that's fine
      if (error?.code !== "ENOENT") {
        console.warn(
          "Pulse Reporter: Warning during cleanup of stale run reports:",
          error.message,
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
          error,
        );
        throw error;
      }
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    // Wait for ALL in-flight onTestEnd calls to finish before reading this.results.
    // This guards against Playwright calling onEnd() concurrently with (or just
    // before) the last onTestEnd() finishing its async attachment I/O — which
    // would cause that test to be silently dropped from the report.
    await Promise.allSettled(this._pendingTestEnds);

    if (this.shardIndex !== undefined) {
      await this._writeShardResults();
      return;
    }

    // De-duplicate and handle retries here, in a safe, single-threaded context.
    const finalResults = this._getFinalizedResults(this.results);

    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runId = `run-${this.runStartTime}-581d5ad8-ce75-4ca5-94a6-ed29c466c815`;
    const environmentDetails = this._getEnvDetails();

    const runData: TestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      // Use the length of the de-duplicated array for all counts
      totalTests: finalResults.length,
      passed: finalResults.filter(
        (r) => (r.final_status || r.status) === "passed",
      ).length,
      failed: finalResults.filter(
        (r) => (r.final_status || r.status) === "failed",
      ).length,
      skipped: finalResults.filter(
        (r) => (r.final_status || r.status) === "skipped",
      ).length,
      flaky: finalResults.filter(
        (r) => (r.final_status || r.status) === "flaky",
      ).length,
      duration,
      environment: environmentDetails,
    };

    finalResults.forEach((r) => (r.runId = runId));

    let finalReport: PlaywrightPulseReport | undefined = undefined;

    if (this.isSharded) {
      // The _mergeShardResults method will handle its own de-duplication
      finalReport = await this._mergeShardResults(runData);
    } else {
      finalReport = {
        run: runData,
        // Use the de-duplicated results
        results: finalResults,
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

    if (!finalReport) {
      console.error(
        "PlaywrightPulseReporter: CRITICAL - finalReport object was not generated. Cannot create summary.",
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
          JSON.stringify(finalReport, jsonReplacer, 2),
        );
        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`,
          );
        }
      } catch (error: any) {
        console.error(
          `Pulse Reporter: Failed to write final JSON report to ${finalOutputPath}. Error: ${error.message}`,
        );
      }
    } else {
      // Logic for appending/merging reports
      const pulseResultsDir = path.join(
        this.outputDir,
        INDIVIDUAL_REPORTS_SUBDIR,
      );
      const individualReportPath = path.join(
        pulseResultsDir,
        `playwright-pulse-report-${Date.now()}.json`,
      );

      try {
        await this._ensureDirExists(pulseResultsDir);
        await fs.writeFile(
          individualReportPath,
          JSON.stringify(finalReport, jsonReplacer, 2),
        );

        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: Individual run report for merging written to ${individualReportPath}`,
          );
        }
        await this._mergeAllRunReports();
      } catch (error: any) {
        console.error(
          `Pulse Reporter: Failed to write or merge report. Error: ${error.message}`,
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
      INDIVIDUAL_REPORTS_SUBDIR,
    );
    const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);

    let reportFiles: string[];
    try {
      const allFiles = await fs.readdir(pulseResultsDir);
      reportFiles = allFiles.filter(
        (file) =>
          file.startsWith("playwright-pulse-report-") && file.endsWith(".json"),
      );
    } catch (error: any) {
      if (error.code === "ENOENT") {
        if (this.printsToStdio()) {
          console.log(
            `Pulse Reporter: No individual reports directory found at ${pulseResultsDir}. Skipping merge.`,
          );
        }
        return;
      }
      console.error(
        `Pulse Reporter: Error reading report directory ${pulseResultsDir}:`,
        error,
      );
      return;
    }

    if (reportFiles.length === 0) {
      if (this.printsToStdio()) {
        console.log(
          "Pulse Reporter: No matching JSON report files found to merge.",
        );
      }
      return;
    }

    const allResultsFromAllFiles: TestResult[] = [];
    let latestTimestamp = new Date(0);
    let lastRunEnvironment: any = undefined;
    let totalDuration = 0;

    for (const file of reportFiles) {
      const filePath = path.join(pulseResultsDir, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const json: PlaywrightPulseReport = JSON.parse(content);

        if (json.run) {
          const runTimestamp = new Date(json.run.timestamp);
          if (runTimestamp > latestTimestamp) {
            latestTimestamp = runTimestamp;
            lastRunEnvironment = json.run.environment || undefined;
          }
        }
        if (json.results) {
          allResultsFromAllFiles.push(...json.results);
        }
      } catch (err: any) {
        console.warn(
          `Pulse Reporter: Could not parse report file ${filePath}. Skipping. Error: ${err.message}`,
        );
      }
    }

    // De-duplicate the results from ALL merged files using the helper function
    const finalMergedResults = this._getFinalizedResults(
      allResultsFromAllFiles,
    );

    // Sum the duration from the final, de-duplicated list of tests
    totalDuration = finalMergedResults.reduce(
      (acc, r) => acc + (r.duration || 0),
      0,
    );

    const combinedRun: TestRun = {
      id: `merged-${Date.now()}`,
      timestamp: latestTimestamp,
      environment: lastRunEnvironment,
      // Recalculate counts based on the truly final, de-duplicated list
      totalTests: finalMergedResults.length,
      passed: finalMergedResults.filter(
        (r) => (r.final_status || r.status) === "passed",
      ).length,
      failed: finalMergedResults.filter(
        (r) => (r.final_status || r.status) === "failed",
      ).length,
      skipped: finalMergedResults.filter(
        (r) => (r.final_status || r.status) === "skipped",
      ).length,
      flaky: finalMergedResults.filter(
        (r) => (r.final_status || r.status) === "flaky",
      ).length,
      duration: totalDuration,
    };

    const finalReport: PlaywrightPulseReport = {
      run: combinedRun,
      results: finalMergedResults, // Use the de-duplicated list
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
          2,
        ),
      );
      if (this.printsToStdio()) {
        console.log(
          `PlaywrightPulseReporter: ✅ Merged report with ${finalMergedResults.length} total results saved to ${finalOutputPath}`,
        );
      }

      // Clean up the pulse-results directory after a successful merge
      try {
        await fs.rm(pulseResultsDir, { recursive: true, force: true });
        if (this.printsToStdio()) {
          console.log(
            `PlaywrightPulseReporter: Cleaned up individual reports directory at ${pulseResultsDir}`,
          );
        }
      } catch (cleanupErr: any) {
        console.warn(
          `Pulse Reporter: Could not clean up individual reports directory. Error: ${cleanupErr.message}`,
        );
      }
    } catch (err: any) {
      console.error(
        `Pulse Reporter: Failed to write final merged report to ${finalOutputPath}. Error: ${err.message}`,
      );
    }
  }
}

export default PlaywrightPulseReporter;
