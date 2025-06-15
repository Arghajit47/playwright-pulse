// input_file_0.ts

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult as PwTestResult, // Renamed to avoid conflict if TestResult is imported locally
  TestStep as PwStep,
} from "@playwright/test/reporter";
import * as fs from "fs/promises";
import * as path from "path";
import type { PlaywrightPulseReport } from "../lib/report-types"; // Use relative path
import type {
  TestResult, // Your custom TestResult type
  TestRun,
  TestStatus as PulseTestStatus,
  TestStep as PulseTestStep,
  PlaywrightPulseReporterOptions,
} from "../types"; // Use relative path
import { randomUUID } from "crypto";
import { attachFiles } from "./attachment-utils"; // Use relative path
import { UAParser } from "ua-parser-js"; // Added UAParser import
import * as os from "os";

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

export class PlaywrightPulseReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;
  private results: TestResult[] = [];
  private runStartTime!: number;
  private options: PlaywrightPulseReporterOptions;
  private outputDir: string;
  private attachmentsDir: string;
  private baseOutputFile: string = "playwright-pulse-report.json";
  private isSharded: boolean = false;
  private shardIndex: number | undefined = undefined;

  constructor(options: PlaywrightPulseReporterOptions = {}) {
    this.options = options;
    this.baseOutputFile = options.outputFile ?? this.baseOutputFile;
    this.outputDir = options.outputDir ?? "pulse-report";
    this.attachmentsDir = path.join(this.outputDir, ATTACHMENTS_SUBDIR);
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
        if (this.shardIndex === undefined || this.shardIndex === 0) {
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

  onTestBegin(test: TestCase): void {
    console.log(`Starting test: ${test.title}`);
  }

  private getBrowserDetails(test: TestCase): string {
    const project = test.parent?.project(); // project() can return undefined if not in a project context

    const projectConfig = project?.use; // This is where options like userAgent, defaultBrowserType are
    const userAgent = projectConfig?.userAgent;
    const configuredBrowserType = projectConfig?.browserName?.toLowerCase();

    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    let browserName = result.browser.name;
    const browserVersion = result.browser.version
      ? ` v${result.browser.version.split(".")[0]}`
      : ""; // Major version
    const osName = result.os.name ? ` on ${result.os.name}` : "";
    const osVersion = result.os.version
      ? ` ${result.os.version.split(".")[0]}`
      : ""; // Major version
    const deviceType = result.device.type; // "mobile", "tablet", etc.
    let finalString;

    // If UAParser couldn't determine browser name, fallback to configured type
    if (browserName === undefined) {
      browserName = configuredBrowserType;
      finalString = `${browserName}`;
    } else {
      // Specific refinements for mobile based on parsed OS and device type
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
            // Keep it as is, e.g. "Samsung Browser" is specific enough
          } else {
            browserName = "Android Browser"; // default for android if not specific
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
    testCase?: TestCase
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
    if (step.location) {
      codeLocation = `${path.relative(
        this.config.rootDir,
        step.location.file
      )}:${step.location.line}:${step.location.column}`;
    }

    let stepTitle = step.title;

    return {
      id: `${testId}_step_${startTime.toISOString()}-${duration}-${randomUUID()}`,
      title: stepTitle,
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
    const testStatus = convertStatus(result.status, test);
    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration);
    const testIdForFiles =
      test.id ||
      `${test
        .titlePath()
        .join("_")
        .replace(/[^a-zA-Z0-9]/g, "_")}_${startTime.getTime()}`;

    const processAllSteps = async (
      steps: PwStep[]
    ): Promise<PulseTestStep[]> => {
      let processed: PulseTestStep[] = [];
      for (const step of steps) {
        const processedStep = await this.processStep(
          step,
          testIdForFiles,
          browserDetails,
          test
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

    const stdoutMessages: string[] = [];
    if (result.stdout && result.stdout.length > 0) {
      result.stdout.forEach((item) => {
        stdoutMessages.push(typeof item === "string" ? item : item.toString());
      });
    }

    const stderrMessages: string[] = [];
    if (result.stderr && result.stderr.length > 0) {
      result.stderr.forEach((item) => {
        stderrMessages.push(typeof item === "string" ? item : item.toString());
      });
    }

    const uniqueTestId = test.id;

    // --- REFINED THIS SECTION for testData ---
    const maxWorkers = this.config.workers;
    let mappedWorkerId: number;

    // First, check for the special case where a test is not assigned a worker (e.g., global setup failure).
    if (result.workerIndex === -1) {
      mappedWorkerId = -1; // Keep it as -1 to clearly identify this special case.
    } else if (maxWorkers && maxWorkers > 0) {
      // If there's a valid worker, map it to the concurrency slot...
      const zeroBasedId = result.workerIndex % maxWorkers;
      // ...and then shift it to be 1-based (1 to n).
      mappedWorkerId = zeroBasedId + 1;
    } else {
      // Fallback for when maxWorkers is not defined: just use the original index (and shift to 1-based).
      mappedWorkerId = result.workerIndex + 1;
    }

    const testSpecificData = {
      workerId: mappedWorkerId,
      uniqueWorkerIndex: result.workerIndex, // We'll keep the original for diagnostics
      totalWorkers: maxWorkers,
      configFile: this.config.configFile,
      metadata: this.config.metadata
        ? JSON.stringify(this.config.metadata)
        : undefined,
    };

    const pulseResult: TestResult = {
      id: uniqueTestId,
      runId: "TBD",
      name: test.titlePath().join(" > "),
      suiteName:
        project?.name || this.config.projects[0]?.name || "Default Suite",
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserDetails,
      retries: result.retry,
      steps: result.steps?.length ? await processAllSteps(result.steps) : [],
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      codeSnippet: codeSnippet,
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag
      ),
      screenshots: [],
      videoPath: undefined,
      tracePath: undefined,
      stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
      stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
      // --- UPDATED THESE LINES from testSpecificData ---
      ...testSpecificData,
    };

    try {
      attachFiles(testIdForFiles, result, pulseResult, this.options);
    } catch (attachError: any) {
      console.error(
        `Pulse Reporter: Error processing attachments for test ${pulseResult.name} (ID: ${testIdForFiles}): ${attachError.message}`
      );
    }

    const existingTestIndex = this.results.findIndex(
      (r) => r.id === uniqueTestId
    );

    if (existingTestIndex !== -1) {
      if (pulseResult.retries >= this.results[existingTestIndex].retries) {
        this.results[existingTestIndex] = pulseResult;
      }
    } else {
      this.results.push(pulseResult);
    }
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
        model: os.cpus()[0] ? os.cpus()[0].model : "N/A", // Handle cases with no CPU info
        cores: os.cpus().length,
      },
      memory: `${(os.totalmem() / 1024 ** 3).toFixed(2)}GB`, // Total RAM in GB
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
    let allShardProcessedResults: TestResult[] = [];
    const totalShards = this.config.shard ? this.config.shard.total : 1;

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        const shardResults = JSON.parse(content) as TestResult[];
        allShardProcessedResults =
          allShardProcessedResults.concat(shardResults);
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

    let finalUniqueResultsMap = new Map<string, TestResult>();
    for (const result of allShardProcessedResults) {
      const existing = finalUniqueResultsMap.get(result.id);
      if (!existing || result.retries >= existing.retries) {
        finalUniqueResultsMap.set(result.id, result);
      }
    }
    const finalResultsList = Array.from(finalUniqueResultsMap.values());

    finalResultsList.forEach((r) => (r.runId = finalRunData.id));

    finalRunData.passed = finalResultsList.filter(
      (r) => r.status === "passed"
    ).length;
    finalRunData.failed = finalResultsList.filter(
      (r) => r.status === "failed"
    ).length;
    finalRunData.skipped = finalResultsList.filter(
      (r) => r.status === "skipped"
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

    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runId = `run-${this.runStartTime}-581d5ad8-ce75-4ca5-94a6-ed29c466c815`; // Need not to change
    // --- CALLING _getEnvDetails HERE ---
    const environmentDetails = this._getEnvDetails();

    const runData: TestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration,
      // --- ADDED environmentDetails HERE ---
      environment: environmentDetails,
    };

    let finalReport: PlaywrightPulseReport | undefined = undefined; // Initialize as undefined

    if (this.isSharded) {
      finalReport = await this._mergeShardResults(runData);
      // Ensured environment details are on the final merged runData if not already
      if (finalReport && finalReport.run && !finalReport.run.environment) {
        finalReport.run.environment = environmentDetails;
      }
    } else {
      this.results.forEach((r) => (r.runId = runId));
      runData.passed = this.results.filter((r) => r.status === "passed").length;
      runData.failed = this.results.filter((r) => r.status === "failed").length;
      runData.skipped = this.results.filter(
        (r) => r.status === "skipped"
      ).length;
      runData.totalTests = this.results.length;

      const reviveDates = (key: string, value: any): any => {
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
        if (typeof value === "string" && isoDateRegex.test(value)) {
          const date = new Date(value);
          return !isNaN(date.getTime()) ? date : value;
        }
        return value;
      };
      const properlyTypedResults = JSON.parse(
        JSON.stringify(this.results),
        reviveDates
      );

      finalReport = {
        run: runData,
        results: properlyTypedResults,
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

    if (!finalReport) {
      console.error(
        "PlaywrightPulseReporter: CRITICAL - finalReport object was not generated. Cannot create summary."
      );
      const errorSummary = `
PlaywrightPulseReporter: Run Finished
-----------------------------------------
  Overall Status: ERROR (Report data missing)
  Total Tests:    N/A
  Passed:         N/A
  Failed:         N/A
  Skipped:        N/A
  Duration:       N/A
-----------------------------------------`;
      if (this.printsToStdio()) {
        console.log(errorSummary);
      }

      const errorReport: PlaywrightPulseReport = {
        run: {
          id: runId,
          timestamp: new Date(this.runStartTime),
          totalTests: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: duration,
          environment: environmentDetails,
        },
        results: [],
        metadata: {
          generatedAt: new Date().toISOString(),
        },
      };
      const finalOutputPathOnError = path.join(
        this.outputDir,
        this.baseOutputFile
      );
      try {
        await this._ensureDirExists(this.outputDir);
        await fs.writeFile(
          finalOutputPathOnError,
          JSON.stringify(errorReport, null, 2)
        );
        console.warn(
          `PlaywrightPulseReporter: Wrote an error report to ${finalOutputPathOnError} as finalReport was missing.`
        );
      } catch (writeError: any) {
        console.error(
          `PlaywrightPulseReporter: Failed to write error report: ${writeError.message}`
        );
      }
      return;
    }

    const reportRunData = finalReport.run;

    const finalRunStatus =
      (reportRunData?.failed ?? 0) > 0
        ? "failed"
        : (reportRunData?.totalTests ?? 0) === 0 && result.status !== "passed"
        ? result.status === "interrupted"
          ? "interrupted"
          : "no tests or error"
        : "passed";

    const summary = `
PlaywrightPulseReporter: Run Finished
-----------------------------------------
  Overall Status: ${finalRunStatus.toUpperCase()}
  Total Tests:    ${reportRunData?.totalTests || 0}
  Passed:         ${reportRunData?.passed}
  Failed:         ${reportRunData?.failed}
  Skipped:        ${reportRunData?.skipped}
  Duration:       ${((reportRunData?.duration ?? 0) / 1000).toFixed(2)}s 
-----------------------------------------`;

    if (this.printsToStdio()) {
      console.log(summary);
    }

    const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);

    try {
      await this._ensureDirExists(this.outputDir);
      await fs.writeFile(
        finalOutputPath,
        JSON.stringify(
          finalReport,
          (key, value) => {
            if (value instanceof Date) return value.toISOString();
            if (typeof value === "bigint") return value.toString();
            return value;
          },
          2
        )
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
    } finally {
      if (this.isSharded) {
        await this._cleanupTemporaryFiles();
      }
    }
  }
}

export default PlaywrightPulseReporter;
