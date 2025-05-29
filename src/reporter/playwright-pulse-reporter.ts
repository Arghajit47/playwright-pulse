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

const convertStatus = (
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted",
  testCase?: TestCase
): PulseTestStatus => {
  if (testCase?.expectedStatus === "failed") {
    return status === "failed" ? "failed" : "failed";
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
        if (this.shardIndex === undefined) {
          console.log(
            `PlaywrightPulseReporter: Starting test run with ${
              suite.allTests().length
            } tests${
              this.isSharded ? ` across ${totalShards} shards` : ""
            }. Pulse outputting to ${this.outputDir}`
          );
          return this._cleanupTemporaryFiles();
        }
      })
      .catch((err) =>
        console.error("Pulse Reporter: Error during initialization:", err)
      );
  }

  onTestBegin(test: TestCase): void {
    // console.log(`Starting test: ${test.title}`);
  }

  private async processStep(
    step: PwStep,
    testId: string,
    browserName: string, // Changed from browserName for clarity
    testCase?: TestCase
  ): Promise<PulseTestStep> {
    let stepStatus: PulseTestStatus = "passed";
    let errorMessage = step.error?.message || undefined;

    if (step.error?.message?.startsWith("Test is skipped:")) {
      stepStatus = "skipped";
      errorMessage = "Info: Test is skipped:";
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
    // This logic had a 'status' variable that was not defined in this scope.
    // Assuming it meant to check 'stepStatus' or 'testCase.expectedStatus' related to step.error.
    // Corrected to reflect comparison with testCase if step.category is 'test'.
    if (step.category === "test" && testCase) {
      // If a test step (not a hook) resulted in an error, but the test was expected to fail,
      // this specific logic might need refinement based on how you want to report step errors
      // within a test that is expected to fail.
      // The current convertStatus handles the overall testCase expectedStatus.
      // For step-specific error messages when testCase.expectedStatus === 'failed':
      if (testCase.expectedStatus === "failed") {
        if (step.error) {
          // If the step itself has an error
          // errorMessage is already set from step.error.message
        } else {
          // If a step within an expected-to-fail test passes, it's usually not an error for the step itself.
        }
      } else if (testCase.expectedStatus === "skipped") {
        // errorMessage is already set if step.error.message started with "Test is skipped:"
      }
    }

    return {
      id: `${testId}_step_${startTime.toISOString()}-${duration}-${randomUUID()}`,
      title: stepTitle,
      status: stepStatus,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserName,
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
    // Use project.name for a user-friendly display name
    const browserName = project?.use?.defaultBrowserType || "unknown";
    // If you need the engine name (chromium, firefox, webkit)
    // const browserEngineName = project?.use?.browserName || "unknown_engine";

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
      // parentTestStatus parameter was not used, removed for now.
      // If needed for inherited status logic for steps, it can be re-added.
    ): Promise<PulseTestStep[]> => {
      let processed: PulseTestStep[] = [];
      for (const step of steps) {
        const processedStep = await this.processStep(
          step,
          testIdForFiles,
          browserName, // Pass display name
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

    // --- Capture stdout and stderr ---
    const stdoutMessages: string[] = [];
    if (result.stdout && result.stdout.length > 0) {
      result.stdout.forEach((item) => {
        if (typeof item === "string") {
          stdoutMessages.push(item);
        } else {
          // If item is not a string, Playwright's typings indicate it's a Buffer (or Buffer-like).
          // We must call toString() on it.
          // The 'item' here is typed as 'Buffer' from the 'else' branch of '(string | Buffer)[]'
          stdoutMessages.push(item.toString());
        }
      });
    }

    const stderrMessages: string[] = [];
    if (result.stderr && result.stderr.length > 0) {
      result.stderr.forEach((item) => {
        if (typeof item === "string") {
          stderrMessages.push(item);
        } else {
          // If item is not a string, Playwright's typings indicate it's a Buffer (or Buffer-like).
          // We must call toString() on it.
          stderrMessages.push(item.toString());
        }
      });
    }
    // --- End capture stdout and stderr ---

    const pulseResult: TestResult = {
      id: test.id || `${test.title}-${startTime.toISOString()}-${randomUUID()}`,
      runId: "TBD",
      name: test.titlePath().join(" > "),
      // Use project.name for suiteName if desired, or fallback
      suiteName:
        project?.name || this.config.projects[0]?.name || "Default Suite",
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserName, // Use the user-friendly project name
      retries: result.retry,
      steps: result.steps?.length ? await processAllSteps(result.steps) : [],
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      codeSnippet: codeSnippet,
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag
      ),
      screenshots: [], // Will be populated by attachFiles
      videoPath: undefined,
      tracePath: undefined,
      // videoPath and tracePath might be deprecated if using the array versions above
      // Depending on attachFiles implementation

      // Add the captured console messages
      stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
      stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
    };

    try {
      // Pass this.options which should contain the resolved outputDir
      attachFiles(testIdForFiles, result, pulseResult, this.options);
    } catch (attachError: any) {
      console.error(
        `Pulse Reporter: Error processing attachments for test ${pulseResult.name} (ID: ${testIdForFiles}): ${attachError.message}`
      );
    }

    this.results.push(pulseResult);
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
      // console.warn("Pulse Reporter: _writeShardResults called unexpectedly in main process. Skipping.");
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
    let allResults: TestResult[] = [];
    const totalShards = this.config.shard ? this.config.shard.total : 1;

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        const shardResults = JSON.parse(content) as TestResult[];
        shardResults.forEach((r) => (r.runId = finalRunData.id));
        allResults = allResults.concat(shardResults);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          console.warn(
            `Pulse Reporter: Shard results file not found: ${tempFilePath}.`
          );
        } else {
          console.error(
            `Pulse Reporter: Could not read/parse results from shard ${i} (${tempFilePath}). Error:`,
            error
          );
        }
      }
    }

    finalRunData.passed = allResults.filter(
      (r) => r.status === "passed"
    ).length;
    finalRunData.failed = allResults.filter(
      (r) => r.status === "failed"
    ).length;
    finalRunData.skipped = allResults.filter(
      (r) => r.status === "skipped"
    ).length;
    finalRunData.totalTests = allResults.length;

    const reviveDates = (key: string, value: any): any => {
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
      if (typeof value === "string" && isoDateRegex.test(value)) {
        const date = new Date(value);
        return !isNaN(date.getTime()) ? date : value;
      }
      return value;
    };

    const finalParsedResults = JSON.parse(
      JSON.stringify(allResults),
      reviveDates
    );

    return {
      run: finalRunData,
      results: finalParsedResults,
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
        console.error(
          "Pulse Reporter: Error cleaning up temporary files:",
          error
        );
      }
    }
  }

  private async _ensureDirExists(dirPath: string): Promise<void> {
    // Removed 'clean' parameter as it was unused
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
    // Consider making the UUID part truly random for each run if this ID needs to be globally unique over time
    const runId = `run-${this.runStartTime}-${randomUUID()}`;

    const runData: TestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration,
    };

    let finalReport: PlaywrightPulseReport;

    if (this.isSharded) {
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
        run: runData,
        results: this.results,
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

    // This block seems redundant as finalReport is already assigned above.
    // if (this.isSharded) {
    //   finalReport = await this._mergeShardResults(runData);
    // } else {
    //   this.results.forEach((r) => (r.runId = runId));
    //   runData.passed = this.results.filter((r) => r.status === "passed").length;
    //   runData.failed = this.results.filter((r) => r.status === "failed").length;
    //   runData.skipped = this.results.filter((r) => r.status === "skipped").length;
    //   runData.totalTests = this.results.length;
    //   finalReport = {
    //     run: runData, results: this.results,
    //     metadata: { generatedAt: new Date().toISOString() },
    //   };
    // }

    const finalRunStatus =
      finalReport.run?.failed ?? 0 > 0
        ? "failed"
        : finalReport.run?.totalTests === 0
        ? "no tests"
        : "passed";
    const summary = `
PlaywrightPulseReporter: Run Finished
-----------------------------------------
  Overall Status: ${finalRunStatus.toUpperCase()}
  Total Tests:    ${finalReport.run?.totalTests ?? "N/A"}
  Passed:         ${finalReport.run?.passed ?? "N/A"}
  Failed:         ${finalReport.run?.failed ?? "N/A"}
  Skipped:        ${finalReport.run?.skipped ?? "N/A"}
  Duration:       ${(duration / 1000).toFixed(2)}s
-----------------------------------------`;
    console.log(summary);

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
      console.log(
        `PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`
      );
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
