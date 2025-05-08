
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
import type { PlaywrightPulseReport } from "../lib/report-types"; // Use relative path
import type {
  TestResult,
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
  // Special case: test was expected to fail (test.fail())
  if (testCase?.expectedStatus === "failed") {
    return status === "failed" ? "passed" : "failed";
  }

  // Special case: test was expected to skip (test.skip())
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
const ATTACHMENTS_SUBDIR = "attachments"; // Centralized definition

export class PlaywrightPulseReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;
  private results: TestResult[] = [];
  private runStartTime!: number;
  private options: PlaywrightPulseReporterOptions; // Store reporter options
  private outputDir: string; // Resolved final output directory for the report
  private attachmentsDir: string; // Base directory for attachments (e.g., pulse-report/attachments)
  private baseOutputFile: string = "playwright-pulse-report.json";
  private isSharded: boolean = false;
  private shardIndex: number | undefined = undefined;

  constructor(options: PlaywrightPulseReporterOptions = {}) {
    this.options = options; // Store provided options
    this.baseOutputFile = options.outputFile ?? this.baseOutputFile;
    // Determine outputDir relative to config file or rootDir
    // The actual resolution happens in onBegin where config is available
    this.outputDir = options.outputDir ?? "pulse-report";
    this.attachmentsDir = path.join(this.outputDir, ATTACHMENTS_SUBDIR); // Initial path, resolved fully in onBegin
    // console.log(`Pulse Reporter Init: Configured outputDir option: ${options.outputDir}, Base file: ${this.baseOutputFile}`);
  }

  printsToStdio() {
    return this.shardIndex === undefined || this.shardIndex === 0;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runStartTime = Date.now();

    // --- Resolve outputDir relative to config file or rootDir ---
    const configDir = this.config.rootDir;
    // Use config file directory if available, otherwise rootDir
    const configFileDir = this.config.configFile
      ? path.dirname(this.config.configFile)
      : configDir;
    this.outputDir = path.resolve(
      configFileDir,
      this.options.outputDir ?? "pulse-report"
    );
    // Resolve attachmentsDir relative to the final outputDir
    this.attachmentsDir = path.resolve(this.outputDir, ATTACHMENTS_SUBDIR);
    // Update options with the resolved absolute path for internal use
    this.options.outputDir = this.outputDir;

    // console.log(`Pulse Reporter onBegin: Final Report Output dir resolved to ${this.outputDir}`);
    // console.log(`Pulse Reporter onBegin: Attachments base dir resolved to ${this.attachmentsDir}`);

    const totalShards = this.config.shard ? this.config.shard.total : 1;
    this.isSharded = totalShards > 1;
    this.shardIndex = this.config.shard
      ? this.config.shard.current - 1
      : undefined;

    // Ensure base output directory exists (attachments handled by attachFiles util)
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
          // Clean up old shard files only in the main process
          return this._cleanupTemporaryFiles();
        } else {
          // console.log(`Pulse Reporter (Shard ${this.shardIndex + 1}/${totalShards}): Starting. Temp results to ${this.outputDir}`);
          return Promise.resolve();
        }
      })
      .catch((err) =>
        console.error("Pulse Reporter: Error during initialization:", err)
      );
  }

  onTestBegin(test: TestCase): void {
    // Optional: Log test start if needed
    // console.log(`Starting test: ${test.title}`);
  }

  private async processStep(
    step: PwStep,
    testId: string,
    browserName: string
  ): Promise<PulseTestStep> {
    // Determine actual step status (don't inherit from parent)
    let stepStatus: PulseTestStatus = "passed";
    let errorMessage = step.error?.message || undefined;

    if (step.error?.message?.startsWith("Test is skipped:")) {
      stepStatus = "skipped";
      errorMessage = "Info: Test is skipped:";
    } else {
      stepStatus = convertStatus(step.error ? "failed" : "passed");
    }

    const duration = step.duration;
    const startTime = new Date(step.startTime);
    const endTime = new Date(startTime.getTime() + Math.max(0, duration));

    // Capture code location if available
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
      steps: [], // Will be populated recursively
    };
  }

  async onTestEnd(test: TestCase, result: PwTestResult): Promise<void> {
    // Get the most accurate browser name
    const project = test.parent?.project();
    const browserName = project?.use?.defaultBrowserType || "unknown";

    const testStatus = convertStatus(result.status, test);
    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration);

    // Generate a slightly more robust ID for attachments, especially if test.id is missing
    const testIdForFiles =
      test.id ||
      `${test
        .titlePath()
        .join("_")
        .replace(/[^a-zA-Z0-9]/g, "_")}_${startTime.getTime()}`;

    // --- Process Steps Recursively ---
    const processAllSteps = async (
      steps: PwStep[],
      parentTestStatus: PulseTestStatus
    ): Promise<PulseTestStep[]> => {
      let processed: PulseTestStep[] = [];
      for (const step of steps) {
        const processedStep = await this.processStep(
          step,
          testIdForFiles,
          browserName
        );
        processed.push(processedStep);
        if (step.steps && step.steps.length > 0) {
          const nestedSteps = await processAllSteps(
            step.steps,
            processedStep.status
          );
          // Assign nested steps correctly
          processedStep.steps = nestedSteps;
        }
      }
      return processed;
    };

    // --- Extract Code Snippet ---
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

    // --- Prepare Base TestResult ---
    const pulseResult: TestResult = {
      id: test.id || `${test.title}-${startTime.toISOString()}-${randomUUID()}`, // Use the original ID logic here
      runId: "TBD", // Will be set later
      name: test.titlePath().join(" > "),
      suiteName: this.config.projects[0]?.name || "Default Suite",
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      browser: browserName,
      retries: result.retry,
      steps: result.steps?.length
        ? await processAllSteps(result.steps, testStatus)
        : [],
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      codeSnippet: codeSnippet,
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag
      ),
      screenshots: [],
      videoPath: undefined,
      tracePath: undefined,
    };

    // --- Process Attachments using the new utility ---
    try {
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
      console.warn(
        "Pulse Reporter: _writeShardResults called unexpectedly in main process. Skipping."
      );
      return;
    }
    const tempFilePath = path.join(
      this.outputDir,
      `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`
    );
    try {
      // No need to ensureDirExists here, should be done in onBegin
      await fs.writeFile(
        tempFilePath,
        JSON.stringify(
          this.results,
          (key, value) => {
            if (value instanceof Date) {
              return value.toISOString();
            }
            return value;
          },
          2
        )
      );
      // console.log(`Pulse Reporter: Shard ${this.shardIndex} wrote ${this.results.length} results to ${tempFilePath}`);
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
    // console.log('Pulse Reporter: Merging results from shards...');
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
        // console.log(`Pulse Reporter: Successfully merged ${shardResults.length} results from shard ${i}`);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          console.warn(
            `Pulse Reporter: Shard results file not found: ${tempFilePath}. This might happen if shard ${i} had no tests or failed early.`
          );
        } else {
          console.error(
            `Pulse Reporter: Could not read or parse results from shard ${i} (${tempFilePath}). Error:`,
            error
          );
        }
      }
    }
    // console.log(`Pulse Reporter: Merged a total of ${allResults.length} results from ${totalShards} shards.`);

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
        if (!isNaN(date.getTime())) {
          return date;
        }
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
      // No need to ensure dir exists here if handled in onBegin
      const files = await fs.readdir(this.outputDir);
      const tempFiles = files.filter((f) =>
        f.startsWith(TEMP_SHARD_FILE_PREFIX)
      );
      if (tempFiles.length > 0) {
        // console.log(`Pulse Reporter: Cleaning up ${tempFiles.length} temporary shard files...`);
        await Promise.all(
          tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f)))
        );
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        // Ignore if the directory doesn't exist
        console.error(
          "Pulse Reporter: Error cleaning up temporary files:",
          error
        );
      }
    }
  }

  private async _ensureDirExists(
    dirPath: string,
    clean: boolean = false
  ): Promise<void> {
    try {
      if (clean) {
        // console.log(`Pulse Reporter: Cleaning directory ${dirPath}...`);
        await fs.rm(dirPath, { recursive: true, force: true });
      }
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      // Ignore EEXIST error if the directory already exists
      if (error.code !== "EEXIST") {
        console.error(
          `Pulse Reporter: Failed to ensure directory exists: ${dirPath}`,
          error
        );
        throw error; // Re-throw other errors
      }
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.shardIndex !== undefined) {
      await this._writeShardResults();
      // console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1} finished writing results.`);
      return;
    }

    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runId = `run-${this.runStartTime}-${randomUUID()}`;

    const runData: TestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      totalTests: 0, // Will be updated after merging/processing
      passed: 0,
      failed: 0,
      skipped: 0,
      duration,
    };

    let finalReport: PlaywrightPulseReport;

    if (this.isSharded) {
      // console.log("Pulse Reporter: Run ended, main process merging shard results...");
      finalReport = await this._mergeShardResults(runData);
    } else {
      // console.log("Pulse Reporter: Run ended, processing results directly (no sharding)...");
      this.results.forEach((r) => (r.runId = runId)); // Assign runId to directly collected results
      runData.passed = this.results.filter((r) => r.status === "passed").length;
      runData.failed = this.results.filter((r) => r.status === "failed").length;
      runData.skipped = this.results.filter(
        (r) => r.status === "skipped"
      ).length;
      runData.totalTests = this.results.length;
      finalReport = {
        run: runData,
        results: this.results, // Use directly collected results
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

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
      // Ensure directory exists before writing final report
      await this._ensureDirExists(this.outputDir);

      // --- Write Final JSON Report ---
      await fs.writeFile(
        finalOutputPath,
        JSON.stringify(
          finalReport,
          (key, value) => {
            if (value instanceof Date) {
              return value.toISOString(); // Ensure dates are ISO strings in JSON
            }
            // Handle potential BigInt if used elsewhere, though unlikely here
            if (typeof value === "bigint") {
              return value.toString();
            }
            return value;
          },
          2
        )
      );
      console.log(
        `PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`
      );

      // REMOVED Static HTML Generation Call
      // The reporter's responsibility is now only to create the JSON file.
      // The user will run `npx generate-pulse-report` separately.
    } catch (error: any) {
      console.error(
        `Pulse Reporter: Failed to write final JSON report to ${finalOutputPath}. Error: ${error.message}`
      );
    } finally {
      if (this.isSharded) {
        // console.log("Pulse Reporter: Cleaning up temporary shard files...");
        await this._cleanupTemporaryFiles();
      }
    }
  }
}

export default PlaywrightPulseReporter;
