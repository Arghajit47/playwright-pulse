
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
  private outputDir: string;
  private baseOutputFile: string = "playwright-pulse-report.json";
  private isSharded: boolean = false;
  private shardIndex: number | undefined = undefined;
  private playwrightOutputDir: string = ""; // Store Playwright's outputDir

  constructor(options: { outputFile?: string; outputDir?: string } = {}) {
    this.baseOutputFile = options.outputFile ?? this.baseOutputFile;
    // Initial outputDir setup (will be refined in onBegin)
    const baseDir = options.outputDir
      ? path.resolve(options.outputDir)
      : process.cwd();
    this.outputDir = baseDir;
    // console.log(`PlaywrightPulseReporter: Initial Pulse Output dir configured to ${this.outputDir}`);
  }

  printsToStdio() {
    return this.shardIndex === undefined || this.shardIndex === 0;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runStartTime = Date.now();
    this.playwrightOutputDir = config.outputDir; // Store Playwright's outputDir

    const totalShards = parseInt(process.env.PLAYWRIGHT_SHARD_TOTAL || "1", 10);
    this.isSharded = totalShards > 1;
    if (process.env.PLAYWRIGHT_SHARD_INDEX !== undefined) {
      this.shardIndex = parseInt(process.env.PLAYWRIGHT_SHARD_INDEX, 10);
    }

    const configDir = this.config.rootDir;
    // Resolve pulse output directory relative to config file location
    this.outputDir = this.outputDir
      ? path.resolve(
          path.dirname(this.config.configFile || configDir),
          this.outputDir
        )
      : path.resolve(
          path.dirname(this.config.configFile || configDir),
          "pulse-report-output"
        );

    // console.log(`PlaywrightPulseReporter: Final Pulse Output dir resolved to ${this.outputDir}`);
    // console.log(`PlaywrightPulseReporter: Playwright Output dir (for attachments): ${this.playwrightOutputDir}`);

    if (this.shardIndex === undefined) {
      // Main process
      console.log(
        `PlaywrightPulseReporter: Starting test run with ${
          suite.allTests().length
        } tests${
          this.isSharded ? ` across ${totalShards} shards` : ""
        }. Outputting to ${this.outputDir}`
      );
      this._cleanupTemporaryFiles().catch((err) =>
        console.error("Pulse Reporter: Error cleaning up temp files:", err)
      );
    } else {
      // Shard process
      // console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1}/${totalShards} starting. Outputting temp results to ${this.outputDir}`);
    }
  }

  onTestBegin(test: TestCase): void {
    // Optional: Log test start
  }

  private processStep(
    step: TestStep,
    parentStatus: PulseTestStatus
  ): PulseTestStep {
    const inherentStatus =
      parentStatus === "failed" || parentStatus === "skipped"
        ? parentStatus
        : convertStatus(step.error ? "failed" : "passed");
    const duration = step.duration;
    const startTime = new Date(step.startTime);
    const endTime = new Date(startTime.getTime() + Math.max(0, duration));

    // Find screenshot within this specific step's attachments
    const stepScreenshotAttachment = step.attachments?.find(
      (a) => a.name === "screenshot" && a.path
    );
    const screenshotPath = stepScreenshotAttachment
      ? path.resolve(this.playwrightOutputDir, stepScreenshotAttachment.path)
      : undefined;

    return {
      id: `${step.title}-${startTime.toISOString()}-${duration}-${Math.random()
        .toString(16)
        .slice(2)}`, // More unique ID
      title: step.title,
      status: inherentStatus,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      errorMessage: step.error?.message,
      screenshot: screenshotPath, // Save absolute path
    };
  }

  onTestEnd(test: TestCase, result: PwTestResult): void {
    const testStatus = convertStatus(result.status);
    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration);

    const processAllSteps = (
      steps: TestStep[],
      parentTestStatus: PulseTestStatus
    ): PulseTestStep[] => {
      let processed: PulseTestStep[] = [];
      for (const step of steps) {
        const processedStep = this.processStep(step, parentTestStatus);
        processed.push(processedStep);
        if (step.steps.length > 0) {
          // Pass the *current* step's status down, not the parent test status
          processed = processed.concat(
            processAllSteps(step.steps, processedStep.status)
          );
        }
      }
      return processed;
    };

    let codeSnippet: string | undefined = undefined;
    try {
      if (test.location?.file) {
        // Make path relative to project root for consistency
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

    // Resolve attachment paths to be absolute
    const screenshotAttachment = result.attachments.find(
      (a) => a.name === "screenshot" && a.path
    );
    const videoAttachment = result.attachments.find(
      (a) => a.name === "video" && a.path
    );

    const absoluteScreenshotPath = screenshotAttachment
      ? path.resolve(this.playwrightOutputDir, screenshotAttachment.path)
      : undefined;
    const absoluteVideoPath = videoAttachment
      ? path.resolve(this.playwrightOutputDir, videoAttachment.path)
      : undefined;

    const pulseResult: PulseTestResult = {
      id:
        test.id ||
        `${test.title}-${startTime.toISOString()}-${Math.random()
          .toString(16)
          .slice(2)}`,
      runId: "TBD", // Will be set later
      name: test.titlePath().join(" > "),
      suiteName: test.parent.title || "Default Suite", // Use default if parent title is empty
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      retries: result.retry,
      steps: processAllSteps(result.steps, testStatus),
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      codeSnippet: codeSnippet,
      screenshot: absoluteScreenshotPath, // Store absolute path
      video: absoluteVideoPath, // Store absolute path
      tags: test.tags.map((tag) =>
        tag.startsWith("@") ? tag.substring(1) : tag
      ),
    };
    this.results.push(pulseResult);
  }

  onError(error: any): void {
    console.error(
      `PlaywrightPulseReporter: Error encountered (Shard: ${
        this.shardIndex ?? "Main"
      }):`,
      error
    );
  }

  private async _writeShardResults(): Promise<void> {
    if (this.shardIndex === undefined) {
      console.warn(
        "Pulse Reporter: _writeShardResults called in main process. Skipping."
      );
      return;
    }
    const tempFilePath = path.join(
      this.outputDir,
      `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`
    );
    try {
      await this._ensureDirExists(this.outputDir);
      // Use the same replacer as in onEnd to handle dates consistently
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
    // console.log('Pulse Reporter: Merging results from shards...');
    let allResults: PulseTestResult[] = [];
    const totalShards = parseInt(process.env.PLAYWRIGHT_SHARD_TOTAL || "1", 10);

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        const shardResults = JSON.parse(content) as PulseTestResult[]; // Assume dates are already strings here
        shardResults.forEach((r) => (r.runId = finalRunData.id));
        allResults = allResults.concat(shardResults);
      } catch (error: any) {
        if (error && error.code === "ENOENT") {
          console.warn(
            `Pulse Reporter: Shard results file not found: ${tempFilePath}. This might happen if a shard had no tests or failed early.`
          );
        } else {
          console.warn(
            `Pulse Reporter: Could not read or parse results from shard ${i} (${tempFilePath}). Error: ${error}`
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

    return {
      run: finalRunData,
      results: allResults,
      metadata: { generatedAt: new Date().toISOString() },
    };
  }

  private async _cleanupTemporaryFiles(): Promise<void> {
    try {
      await this._ensureDirExists(this.outputDir);
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
      // Ignore ENOENT (directory not found) which might happen if no shards wrote files
      if (error && error.code !== "ENOENT") {
        console.error(
          "Pulse Reporter: Error cleaning up temporary files:",
          error
        );
      }
    }
  }

  private async _ensureDirExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      // Ignore EEXIST (directory already exists)
      if (error && error.code !== "EEXIST") {
        console.error(
          `Pulse Reporter: Failed to ensure directory exists: ${dirPath}`,
          error
        );
        throw error; // Rethrow other errors
      }
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    // If this is a shard process, write its results and exit
    if (this.shardIndex !== undefined) {
      await this._writeShardResults();
      // console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1} finished.`);
      return; // Shard process work is done
    }

    // --- Main Process Logic ---
    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runId = `run-${this.runStartTime}-${Math.random()
      .toString(16)
      .slice(2)}`;

    const runData: PulseTestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      totalTests: 0, // Will be calculated after merging/processing
      passed: 0,
      failed: 0,
      skipped: 0,
      duration,
    };

    let finalReport: PlaywrightPulseReport;

    if (this.isSharded) {
      // Merge results from all shard temp files
      finalReport = await this._mergeShardResults(runData);
    } else {
      // Process results directly if not sharded
      this.results.forEach((r) => (r.runId = runId));
      runData.passed = this.results.filter((r) => r.status === "passed").length;
      runData.failed = this.results.filter((r) => r.status === "failed").length;
      runData.skipped = this.results.filter(
        (r) => r.status === "skipped"
      ).length;
      runData.totalTests = this.results.length;
      finalReport = {
        run: runData,
        results: this.results, // Already populated in onTestEnd
        metadata: { generatedAt: new Date().toISOString() },
      };
    }

    const finalRunStatus =
      finalReport.run?.failed ?? 0 > 0
        ? "failed"
        : finalReport.run?.totalTests === 0
        ? "no tests"
        : "passed";
    console.log(`\nPlaywrightPulseReporter: Run Finished`);
    console.log(`-----------------------------------------`);
    console.log(`  Overall Status: ${finalRunStatus}`);
    console.log(`  Total Tests:    ${finalReport.run?.totalTests}`);
    console.log(`  Passed:         ${finalReport.run?.passed}`);
    console.log(`  Failed:         ${finalReport.run?.failed}`);
    console.log(`  Skipped:        ${finalReport.run?.skipped}`);
    console.log(`  Duration:       ${(duration / 1000).toFixed(2)}s`);
    console.log(`-----------------------------------------`);

    const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);

    try {
      await this._ensureDirExists(this.outputDir);
      // Write the final JSON report, stringifying Dates to ISO format
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
      console.log(
        `PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`
      );

      // --- Trigger Static HTML Generation ---
      // Check if generate-static-report.mjs exists and try to run it
      const staticScriptPath = path.resolve(
        __dirname,
        "../../scripts/generate-static-report.mjs"
      ); // Adjust path if needed
      try {
        await fs.access(staticScriptPath); // Check if script exists
        // Use dynamic import to execute the script
        const generateStaticReport = (await import(staticScriptPath)).default;
        if (typeof generateStaticReport === "function") {
          await generateStaticReport(); // Assuming it exports a default function to run
        } else {
          // Fallback: try running as a command if default export is not a function
          const { exec } = await import("child_process");
          console.log(
            `PlaywrightPulseReporter: Attempting to generate static HTML report via command...`
          );
          exec(`node "${staticScriptPath}"`, (error, stdout, stderr) => {
            if (error) {
              console.error(
                `Pulse Reporter: Error executing static report generation script: ${error}`
              );
              return;
            }
            if (stderr) {
              console.error(
                `Pulse Reporter: Static report script stderr: ${stderr}`
              );
            }
            // console.log(`Pulse Reporter: Static report script stdout: ${stdout}`);
          });
        }
      } catch (scriptError) {
        if (scriptError.code === "ENOENT") {
          console.warn(
            `Pulse Reporter: Static report generation script not found at ${staticScriptPath}. Skipping HTML generation.`
          );
        } else {
          console.error(
            `Pulse Reporter: Error trying to run static report generation script:`,
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
      // Cleanup temporary shard files only if sharding was used
      if (this.isSharded) {
        await this._cleanupTemporaryFiles();
      }
    }
  }
}

    