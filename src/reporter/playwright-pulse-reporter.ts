
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult as PwTestResult,
  TestStep,
} from "@playwright/test/reporter";
import * as fs from "fs/promises";
import * as path from "path";
import type { PlaywrightPulseReport } from "../lib/report-types"; // Use relative path
import type {
  TestResult as PulseTestResult,
  TestRun as PulseTestRun,
  TestStatus as PulseTestStatus,
  TestStep as PulseTestStep,
} from "../types"; // Use relative path

// Helper to convert Playwright status to Pulse status
const convertStatus = (
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted"
): PulseTestStatus => {
  if (status === "passed") return "passed";
  if (status === "failed" || status === "timedOut" || status === "interrupted")
    return "failed";
  return "skipped";
};

const TEMP_SHARD_FILE_PREFIX = ".pulse-shard-results-";

// Use standard ES module export
export class PlaywrightPulseReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;
  private results: PulseTestResult[] = []; // Holds results *per process* (main or shard)
  private runStartTime!: number;
  private outputDir: string; // Directory for pulse-report.json and temp files
  private baseOutputFile: string = "playwright-pulse-report.json";
  private isSharded: boolean = false;
  private shardIndex: number | undefined = undefined;
  // private playwrightOutputDir: string = ''; // Removed direct reliance on this

  constructor(options: { outputFile?: string; outputDir?: string } = {}) {
    this.baseOutputFile = options.outputFile ?? this.baseOutputFile;
    // Initial outputDir setup for Pulse report (will be refined in onBegin)
    // Store the provided option, defaulting to 'pulse-report-output' relative to config/root
    this.outputDir = options.outputDir ?? "pulse-report-output";
    // console.log(`PlaywrightPulseReporter: Initial Pulse Output dir option: ${this.outputDir}`);
  }

  printsToStdio() {
    // Only the main process (or the first shard if no main process coordination exists) should print summary logs.
    // Let's assume shard 0 prints if sharded, otherwise the single process prints.
    return this.shardIndex === undefined || this.shardIndex === 0;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runStartTime = Date.now();

    // Resolve pulse output directory relative to config file location or rootDir as fallback
    const configDir = this.config.rootDir;
    const configFileDir = this.config.configFile
      ? path.dirname(this.config.configFile)
      : configDir;
    // Resolve the outputDir relative to the config file directory
    this.outputDir = path.resolve(configFileDir, this.outputDir);
    // console.log(`PlaywrightPulseReporter: Final Pulse Output dir resolved to ${this.outputDir}`);

    // --- Sharding Detection ---
    const totalShards = this.config.shard ? this.config.shard.total : 1;
    this.isSharded = totalShards > 1;
    this.shardIndex = this.config.shard
      ? this.config.shard.current - 1
      : undefined; // Playwright shards are 1-based

    if (this.shardIndex === undefined) {
      // Main process (or single process run)
      console.log(
        `PlaywrightPulseReporter: Starting test run with ${
          suite.allTests().length
        } tests${
          this.isSharded ? ` across ${totalShards} shards` : ""
        }. Pulse outputting to ${this.outputDir}`
      );
      // Clean up any potential leftover shard files from previous runs
      this._cleanupTemporaryFiles().catch((err) =>
        console.error("Pulse Reporter: Error cleaning up temp files:", err)
      );
    } else {
      // Shard process
      // console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1}/${totalShards} starting. Outputting temp results to ${this.outputDir}`);
    }
  }

  onTestBegin(test: TestCase): void {
    // Optional: Log test start if needed
    // console.log(`Starting test: ${test.title}`);
  }

  private processStep(
    step: TestStep,
    parentStatus: PulseTestStatus
  ): PulseTestStep {
    // Step status inherits failure/skip from parent unless it passes inherently
    const inherentStatus =
      parentStatus === "failed" || parentStatus === "skipped"
        ? parentStatus
        : convertStatus(step.error ? "failed" : "passed");
    const duration = step.duration;
    const startTime = new Date(step.startTime);
    const endTime = new Date(startTime.getTime() + Math.max(0, duration)); // Ensure duration is non-negative

    // Find screenshot within this specific step's attachments and store RELATIVE path
    const stepScreenshotAttachment = step.attachments?.find(
      (a) => a.name === "screenshot" && a.path && typeof a.path === "string"
    );
    // Store the path as provided by Playwright (relative to Playwright's outputDir)
    const screenshotRelativePath: string | undefined =
      stepScreenshotAttachment?.path;

    return {
      id: `${step.title}-${startTime.toISOString()}-${duration}-${Math.random()
        .toString(16)
        .slice(2)}`, // Attempt at a more unique ID
      title: step.title,
      status: inherentStatus,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      errorMessage: step.error?.message,
      screenshot: screenshotRelativePath, // Store relative path
      // videoTimestamp: undefined, // Placeholder if needed later
    };
  }

  onTestEnd(test: TestCase, result: PwTestResult): void {
    const testStatus = convertStatus(result.status);
    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration); // Calculate end time

    // Recursive function to process steps and their nested steps
    const processAllSteps = (
      steps: TestStep[],
      parentTestStatus: PulseTestStatus
    ): PulseTestStep[] => {
      let processed: PulseTestStep[] = [];
      for (const step of steps) {
        const processedStep = this.processStep(step, parentTestStatus);
        processed.push(processedStep);
        // Recursively process nested steps, passing the *current* step's resolved status
        if (step.steps && step.steps.length > 0) {
          processed = processed.concat(
            processAllSteps(step.steps, processedStep.status)
          );
        }
      }
      return processed;
    };

    // Extract code snippet location
    let codeSnippet: string | undefined = undefined;
    try {
      if (test.location?.file && test.location?.line && test.location?.column) {
        // Make path relative to project rootDir for consistency and brevity
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

    // Get relative attachment paths (screenshot on failure, video)
    const screenshotAttachment = result.attachments.find(
      (a) => a.name === "screenshot" && a.path && typeof a.path === "string"
    );
    const videoAttachment = result.attachments.find(
      (a) => a.name === "video" && a.path && typeof a.path === "string"
    );

    const relativeScreenshotPath: string | undefined =
      screenshotAttachment?.path;
    const relativeVideoPath: string | undefined = videoAttachment?.path;

    const pulseResult: PulseTestResult = {
      id:
        test.id ||
        `${test.title}-${startTime.toISOString()}-${Math.random()
          .toString(16)
          .slice(2)}`, // Use test.id if available
      runId: "TBD", // Placeholder, will be set in onEnd or merge
      name: test.titlePath().join(" > "), // Get full descriptive name
      suiteName: test.parent.title || "Default Suite", // Use parent suite title, fallback if empty
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      retries: result.retry,
      steps: processAllSteps(result.steps, testStatus), // Process all steps recursively
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      codeSnippet: codeSnippet,
      screenshot: relativeScreenshotPath, // Store relative path
      video: relativeVideoPath, // Store relative path
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag
      ), // Remove leading '@' from tags
    };
    this.results.push(pulseResult);
  }

  onError(error: any): void {
    // Log errors encountered during the test run
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
    // Writes the results collected by this specific shard process to a temporary file.
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
      await this._ensureDirExists(this.outputDir);
      // Use the same Date replacer as in onEnd to ensure consistency
      await fs.writeFile(
        tempFilePath,
        JSON.stringify(
          this.results,
          (key, value) => {
            if (value instanceof Date) {
              return value.toISOString(); // Convert Dates to ISO strings
            }
            return value;
          },
          2
        )
      ); // Use indentation for readability of temp files (optional)
      // console.log(`Pulse Reporter: Shard ${this.shardIndex} wrote ${this.results.length} results to ${tempFilePath}`);
    } catch (error) {
      console.error(
        `Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`,
        error
      );
    }
  }

  private async _mergeShardResults(
    finalRunData: PulseTestRun
  ): Promise<PlaywrightPulseReport> {
    // Reads temporary files from all shards and merges them into a single report object.
    // console.log('Pulse Reporter: Merging results from shards...');
    let allResults: PulseTestResult[] = [];
    const totalShards = this.config.shard ? this.config.shard.total : 1; // Use config value

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        // Parse the shard results - Dates should already be strings here
        const shardResults = JSON.parse(content) as PulseTestResult[];
        // Assign the final run ID to each result from the shard
        shardResults.forEach((r) => (r.runId = finalRunData.id));
        allResults = allResults.concat(shardResults);
        // console.log(`Pulse Reporter: Successfully merged ${shardResults.length} results from shard ${i}`);
      } catch (error: any) {
        // Handle cases where a shard file might be missing (e.g., shard failed early)
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

    // Recalculate final counts based on merged results
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

    // Re-parse merged results with date reviver for the final report object in memory
    // (although we'll stringify again for the file)
    const finalParsedResults = JSON.parse(
      JSON.stringify(allResults),
      (key, value) => {
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
        if (typeof value === "string" && isoDateRegex.test(value)) {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
        return value;
      }
    );

    return {
      run: finalRunData,
      results: finalParsedResults, // Use the results with revived Dates
      metadata: { generatedAt: new Date().toISOString() }, // Add generation timestamp
    };
  }

  private async _cleanupTemporaryFiles(): Promise<void> {
    // Removes the temporary shard result files after merging.
    try {
      await this._ensureDirExists(this.outputDir); // Ensure directory exists before reading
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
      // Ignore ENOENT (directory not found) which can happen if no shards wrote files
      // or if the directory was cleaned up by another process.
      if (error?.code !== "ENOENT") {
        console.error(
          "Pulse Reporter: Error cleaning up temporary files:",
          error
        );
      }
    }
  }

  private async _ensureDirExists(dirPath: string): Promise<void> {
    // Creates a directory if it doesn't exist, ignoring errors if it already exists.
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      // Ignore EEXIST (directory already exists) error
      if (error?.code !== "EEXIST") {
        console.error(
          `Pulse Reporter: Failed to ensure directory exists: ${dirPath}`,
          error
        );
        throw error; // Rethrow other unexpected errors
      }
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    // This method is called once per process.
    // If this is a shard process, it writes its results and finishes.
    if (this.shardIndex !== undefined) {
      await this._writeShardResults();
      // console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1} finished writing results.`);
      return; // Shard process work is done here
    }

    // --- Main Process Logic (or single-process run) ---
    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runId = `run-${this.runStartTime}-${Math.random()
      .toString(16)
      .slice(2)}`;

    // Initialize run data (counts will be updated after potential merge)
    const runData: PulseTestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      totalTests: 0, // Placeholder
      passed: 0, // Placeholder
      failed: 0, // Placeholder
      skipped: 0, // Placeholder
      duration, // Calculated duration
    };

    let finalReport: PlaywrightPulseReport;

    if (this.isSharded) {
      // If sharded, merge results from all shard temporary files
      // console.log("Pulse Reporter: Run ended, main process merging shard results...");
      finalReport = await this._mergeShardResults(runData);
    } else {
      // If not sharded, process results directly from this instance
      // console.log("Pulse Reporter: Run ended, processing results directly (no sharding)...");
      this.results.forEach((r) => (r.runId = runId)); // Assign runId to results
      runData.passed = this.results.filter((r) => r.status === "passed").length;
      runData.failed = this.results.filter((r) => r.status === "failed").length;
      runData.skipped = this.results.filter(
        (r) => r.status === "skipped"
      ).length;
      runData.totalTests = this.results.length;
      finalReport = {
        run: runData,
        results: this.results, // Use results collected by this instance
        metadata: { generatedAt: new Date().toISOString() }, // Add generation timestamp
      };
    }

    // Print summary to console (only from main process)
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
      await this._ensureDirExists(this.outputDir); // Make sure output directory exists

      // Write the final combined JSON report
      // Use a replacer function to convert Date objects back to ISO strings for JSON
      await fs.writeFile(
        finalOutputPath,
        JSON.stringify(
          finalReport,
          (key, value) => {
            if (value instanceof Date) {
              return value.toISOString();
            }
            // Preserve relative paths for attachments
            // if (key === 'screenshot' || key === 'video') {
            //     return value; // Keep as is (should be relative)
            // }
            return value;
          },
          2
        )
      ); // Indent for readability
      console.log(
        `PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`
      );

      // --- Trigger Static HTML Generation ---
      // Locate the script relative to the current file's directory
      // This makes it more robust regardless of where node_modules is installed
      // Correct path assuming script is in project_root/scripts/
      const staticScriptPath = path.resolve(
        this.config.rootDir,
        "node_modules",
        this.config.reporter.find(
          (r) => r[0] === "playwright-pulse-reporter"
        )![0],
        "../../scripts/generate-static-report.mjs"
      );

      try {
        await fs.access(staticScriptPath); // Check if script exists and is accessible

        // Use dynamic import for ES Modules
        const generateStaticReportModule = await import(staticScriptPath);
        const generateStaticReport = generateStaticReportModule.default; // Access the default export

        if (typeof generateStaticReport === "function") {
          // console.log(`PlaywrightPulseReporter: Generating static HTML report using function from ${staticScriptPath}...`);
          // Pass the pulse output directory to the generation script
          await generateStaticReport(this.outputDir);
          console.log(
            `PlaywrightPulseReporter: Static HTML report generated in ${this.outputDir}`
          );
        } else {
          console.warn(
            `Pulse Reporter: Default export of ${staticScriptPath} is not a function. Cannot generate static report.`
          );
        }
      } catch (scriptError: unknown) {
        // Use unknown type for error
        // Type guard to check if it's an error object with a 'code' property
        if (
          scriptError instanceof Error &&
          "code" in scriptError &&
          scriptError.code === "ENOENT"
        ) {
          console.warn(
            `Pulse Reporter: Static report generation script not found at ${staticScriptPath}. Looked relative to project root. Skipping HTML generation.`
          );
        } else if (scriptError instanceof Error) {
          console.error(
            `Pulse Reporter: Error trying to run static report generation script: ${scriptError.message}`,
            scriptError.stack
          );
        } else {
          console.error(
            `Pulse Reporter: Unknown error trying to run static report generation script:`,
            scriptError
          );
        }
      }
    } catch (error) {
      console.error(
        `PlaywrightPulseReporter: Failed to write final JSON report to ${finalOutputPath}`,
        error
      );
    } finally {
      // Cleanup temporary shard files *only* if sharding was actually used
      if (this.isSharded) {
        // console.log("Pulse Reporter: Cleaning up temporary shard files...");
        await this._cleanupTemporaryFiles();
      }
    }
  }
}

    