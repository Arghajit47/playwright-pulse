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
import { UAParser } from "ua-parser-js";

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
    this.options.outputDir = this.outputDir; // Ensure options has the resolved path

    const totalShards = this.config.shard ? this.config.shard.total : 1;
    this.isSharded = totalShards > 1;
    this.shardIndex = this.config.shard
      ? this.config.shard.current - 1
      : undefined;

    this._ensureDirExists(this.outputDir)
      .then(() => this._ensureDirExists(this.attachmentsDir)) // Also ensure attachmentsDir exists
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
    // Optional: console.log(`Starting test: ${test.titlePath().join(' > ')} for project ${test.parent?.project()?.name}`);
  }

  private async processStep(
    step: PwStep,
    testId: string,
    browserName: string, // This will be the detailed browser info string
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
    if (step.location?.file) {
      // Check if file path exists
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
      browser: browserName, // Store the detailed browser string for the step
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
      steps: [], // Will be populated by recursive calls in onTestEnd
    };
  }

  getBrowserInfo(test: TestCase): string {
    const project = test.parent?.project();
    const configuredBrowserType =
      project?.use?.defaultBrowserType?.toLowerCase();
    const userAgentString = test.info().project.use.userAgent;

    // --- DEBUG LOGS (IMPORTANT! Check these in your console output) ---
    console.log(`[PulseReporter DEBUG] Project: ${project?.name || "N/A"}`);
    console.log(
      `[PulseReporter DEBUG] Configured Browser Type: "${configuredBrowserType}"`
    );
    console.log(
      `[PulseReporter DEBUG] User Agent String for UAParser: "${userAgentString}"`
    );
    // --- END DEBUG LOGS ---

    let parsedBrowserName: string | undefined;
    let parsedVersion: string | undefined;
    let parsedOsName: string | undefined;
    let parsedOsVersion: string | undefined;
    let deviceModel: string | undefined;
    let deviceType: string | undefined;

    if (userAgentString) {
      try {
        const parser = new UAParser(userAgentString);
        const uaResult = parser.getResult();

        // --- DEBUG LOGS (IMPORTANT! Check these in your console output) ---
        console.log(
          "[PulseReporter DEBUG] UAParser Result:",
          JSON.stringify(uaResult, null, 2)
        );
        // --- END DEBUG LOGS ---

        parsedBrowserName = uaResult.browser.name;
        parsedVersion = uaResult.browser.version;
        parsedOsName = uaResult.os.name;
        parsedOsVersion = uaResult.os.version;
        deviceModel = uaResult.device.model;
        deviceType = uaResult.device.type;

        if (deviceType === "mobile" || deviceType === "tablet") {
          if (parsedOsName?.toLowerCase().includes("android")) {
            if (parsedBrowserName?.toLowerCase().includes("chrome")) {
              parsedBrowserName = "Chrome Mobile";
            } else if (parsedBrowserName?.toLowerCase().includes("firefox")) {
              parsedBrowserName = "Firefox Mobile";
            } else if (uaResult.engine.name === "Blink" && !parsedBrowserName) {
              parsedBrowserName = "Android WebView";
            } else if (parsedBrowserName) {
              // Parsed name is likely okay
            } else {
              parsedBrowserName = "Android Browser";
            }
          } else if (parsedOsName?.toLowerCase().includes("ios")) {
            parsedBrowserName = "Mobile Safari";
          }
        } else if (parsedBrowserName === "Electron") {
          parsedBrowserName = "Electron App";
        }
      } catch (error) {
        console.warn(
          `Pulse Reporter: Error parsing User-Agent string "${userAgentString}":`,
          error
        );
      }
    }

    let finalDisplayName: string;

    if (parsedBrowserName) {
      finalDisplayName = parsedBrowserName;
      if (parsedVersion) {
        finalDisplayName += ` v${parsedVersion.split(".")[0]}`;
      }
    } else if (configuredBrowserType && configuredBrowserType !== "unknown") {
      finalDisplayName =
        configuredBrowserType.charAt(0).toUpperCase() +
        configuredBrowserType.slice(1);
    } else {
      finalDisplayName = "Unknown Browser";
    }

    if (parsedOsName) {
      finalDisplayName += ` on ${parsedOsName}`;
      if (parsedOsVersion) {
        finalDisplayName += ` ${parsedOsVersion.split(".")[0]}`;
      }
    }

    // Example: Append device model if it's a mobile/tablet and model exists
    // if ((deviceType === "mobile" || deviceType === "tablet") && deviceModel && !finalDisplayName.includes(deviceModel)) {
    //   finalDisplayName += ` (${deviceModel})`;
    // }

    return finalDisplayName.trim();
  }

  async onTestEnd(test: TestCase, result: PwTestResult): Promise<void> {
    const project = test.parent?.project();
    // const browserDisplayInfo = this.getBrowserInfo(test);
    const ua = test.info().project.use.userAgent;
    const parser = new UAParser(ua);
    const res = parser.getResult();
    const browserDisplayInfo = res.browser.name || "";

    const testStatus = convertStatus(result.status, test);
    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration);
    const testIdForFiles =
      test.id || // Playwright's internal unique ID for the test case
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
          browserDisplayInfo, // Pass the detailed browser info string
          test
        );
        processed.push(processedStep);
        if (step.steps && step.steps.length > 0) {
          processedStep.steps = await processAllSteps(step.steps); // Recursive call
        }
      }
      return processed;
    };

    let codeSnippet: string | undefined = undefined;
    try {
      if (
        test.location?.file &&
        test.location?.line !== undefined &&
        test.location?.column !== undefined
      ) {
        const relativePath = path.relative(
          this.config.rootDir,
          test.location.file
        );
        codeSnippet = `Test defined at: ${relativePath}:${test.location.line}:${test.location.column}`;
      }
    } catch (e) {
      // console.warn(`Pulse Reporter: Could not extract code snippet for ${test.title}`, e);
    }

    const stdoutMessages: string[] =
      result.stdout?.map((item) =>
        typeof item === "string" ? item : item.toString()
      ) || [];
    const stderrMessages: string[] =
      result.stderr?.map((item) =>
        typeof item === "string" ? item : item.toString()
      ) || [];

    const uniqueTestId = test.id; // test.id is Playwright's unique ID for a test case instance

    const pulseResult: TestResult = {
      id: uniqueTestId,
      runId: "TBD", // Will be set during final report generation
      name: test.titlePath().join(" > "),
      suiteName:
        project?.name || this.config.projects[0]?.name || "Default Suite",
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserDisplayInfo, // Use the detailed browser string
      retries: result.retry,
      steps: result.steps?.length ? await processAllSteps(result.steps) : [],
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      codeSnippet: codeSnippet,
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag
      ),
      screenshots: [], // To be populated by attachFiles
      videoPath: undefined, // To be populated by attachFiles
      tracePath: undefined, // To be populated by attachFiles
      stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
      stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
    };

    try {
      // IMPORTANT: attachFiles logic
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
    finalRunData: TestRun // Pass the TestRun object to populate
  ): Promise<PlaywrightPulseReport> {
    let allShardProcessedResults: TestResult[] = [];
    const totalShards = this.config.shard?.total ?? 1;

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        const shardResults = JSON.parse(content) as TestResult[]; // Dates are already ISO strings
        allShardProcessedResults.push(...shardResults);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          // console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}.`);
        } else {
          console.error(
            `Pulse Reporter: Could not read/parse results from shard ${i} (${tempFilePath}). Error:`,
            error
          );
        }
      }
    }

    const finalUniqueResultsMap = new Map<string, TestResult>();
    for (const result of allShardProcessedResults) {
      const existing = finalUniqueResultsMap.get(result.id);
      if (!existing || result.retries >= existing.retries) {
        finalUniqueResultsMap.set(result.id, result);
      }
    }
    const finalResultsList = Array.from(finalUniqueResultsMap.values());

    finalResultsList.forEach((r) => (r.runId = finalRunData.id)); // Assign runId to each test result

    // Update the passed finalRunData object with aggregated stats
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

    return {
      run: finalRunData, // Contains Date object for timestamp
      results: finalResultsList, // Contains ISO strings for dates from shards
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
        // console.warn("Pulse Reporter: Warning during cleanup of temporary files:", error.message);
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
    const runId = `run-${this.runStartTime}-${randomUUID()}`;

    const runData: TestRun = {
      // This is the single source of truth for current run's data
      id: runId,
      timestamp: new Date(this.runStartTime), // Stored as Date object
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration,
    };

    let finalReport: PlaywrightPulseReport;

    if (this.isSharded) {
      // _mergeShardResults will populate the runData object passed to it
      finalReport = await this._mergeShardResults(runData);
    } else {
      this.results.forEach((r) => (r.runId = runId));
      runData.passed = this.results.filter((r) => r.status === "passed").length;
      runData.failed = this.results.filter((r) => r.status === "failed").length;
      runData.skipped = this.results.filter(
        (r) => r.status === "skipped"
      ).length;
      runData.totalTests = this.results.length;

      finalReport = {
        run: runData, // runData contains a Date object for timestamp
        results: this.results, // results contain Date objects for startTime, endTime
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

    // This check should be robust now
    if (
      !finalReport ||
      !finalReport.run ||
      typeof finalReport.run.totalTests !== "number"
    ) {
      console.error(
        "PlaywrightPulseReporter: CRITICAL - finalReport object or its run data was malformed. Cannot create summary."
      );
      const errorReportMinimal: PlaywrightPulseReport = {
        run: {
          id: runId,
          timestamp: new Date(this.runStartTime),
          totalTests: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration,
        },
        results: [],
        metadata: {
          generatedAt: new Date().toISOString(),
        },
      };
      try {
        const errorPath = path.join(this.outputDir, this.baseOutputFile);
        await this._ensureDirExists(this.outputDir);
        // Stringify with Date conversion for the minimal error report
        await fs.writeFile(
          errorPath,
          JSON.stringify(
            errorReportMinimal,
            (key, value) =>
              value instanceof Date ? value.toISOString() : value,
            2
          )
        );
        console.warn(
          `PlaywrightPulseReporter: Wrote a minimal error report to ${errorPath}.`
        );
      } catch (e) {
        console.error(
          "PlaywrightPulseReporter: Failed to write minimal error report.",
          e
        );
      }
      return;
    }

    // At this point, finalReport.run is guaranteed to be populated by either _mergeShardResults or the non-sharded path.
    const reportRunData = finalReport.run;

    const finalRunStatus =
      (reportRunData.failed ?? 0) > 0
        ? "failed"
        : (reportRunData.totalTests ?? 0) === 0 && result.status !== "passed"
        ? result.status === "interrupted"
          ? "interrupted"
          : "no tests or error"
        : "passed";

    const summary = `
PlaywrightPulseReporter: Run Finished
-----------------------------------------
  Overall Status: ${finalRunStatus.toUpperCase()}
  Total Tests:    ${reportRunData.totalTests}
  Passed:         ${reportRunData.passed}
  Failed:         ${reportRunData.failed}
  Skipped:        ${reportRunData.skipped}
  Duration:       ${(reportRunData.duration / 1000).toFixed(2)}s 
-----------------------------------------`;

    if (this.printsToStdio()) {
      console.log(summary);
    }

    const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);

    try {
      await this._ensureDirExists(this.outputDir);
      // Custom replacer for JSON.stringify to handle Date objects correctly
      await fs.writeFile(
        finalOutputPath,
        JSON.stringify(
          finalReport,
          (key, value) => {
            if (value instanceof Date) {
              return value.toISOString();
            }
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