
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

  constructor(options: { outputFile?: string; outputDir?: string } = {}) {
    this.baseOutputFile = options.outputFile ?? this.baseOutputFile;
    // Initial outputDir setup (will be refined in onBegin)
    const baseDir = options.outputDir
      ? path.resolve(options.outputDir)
      : process.cwd();
    this.outputDir = baseDir;
    console.log(
      `PlaywrightPulseReporter: Initial Output dir configured to ${this.outputDir}`
    );
  }

  printsToStdio() {
    return this.shardIndex === undefined || this.shardIndex === 0;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runStartTime = Date.now();

    const totalShards = parseInt(process.env.PLAYWRIGHT_SHARD_TOTAL || "1", 10);
    this.isSharded = totalShards > 1;
    if (process.env.PLAYWRIGHT_SHARD_INDEX !== undefined) {
      this.shardIndex = parseInt(process.env.PLAYWRIGHT_SHARD_INDEX, 10);
    }

    const configDir = this.config.rootDir;
    this.outputDir = this.outputDir
      ? path.resolve(configDir, this.outputDir)
      : path.resolve(configDir, "pulse-report-output");
    console.log(
      `PlaywrightPulseReporter: Final Output dir resolved to ${this.outputDir}`
    );

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
      console.log(
        `PlaywrightPulseReporter: Shard ${
          this.shardIndex + 1
        }/${totalShards} starting. Outputting temp results to ${this.outputDir}`
      );
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

    return {
      id: `${step.title}-${startTime.toISOString()}-${duration}-${Math.random()
        .toString(16)
        .slice(2)}`,
      title: step.title,
      status: inherentStatus,
      duration: duration,
      startTime: startTime,
      endTime: endTime,
      errorMessage: step.error?.message,
      screenshot: undefined, // Placeholder
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
        codeSnippet = `Test defined at: ${test.location.file}:${test.location.line}:${test.location.column}`;
      }
    } catch (e) {
      console.warn(
        `Pulse Reporter: Could not extract code snippet for ${test.title}`,
        e
      );
    }

    const pulseResult: PulseTestResult = {
      id:
        test.id ||
        `${test.title}-${startTime.toISOString()}-${Math.random()
          .toString(16)
          .slice(2)}`,
      runId: "TBD",
      name: test.titlePath().join(" > "),
      suiteName: test.parent.title,
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      retries: result.retry,
      steps: processAllSteps(result.steps, testStatus),
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      codeSnippet: codeSnippet,
      screenshot: result.attachments.find((a) => a.name === "screenshot")?.path,
      video: result.attachments.find((a) => a.name === "video")?.path,
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
      await fs.writeFile(tempFilePath, JSON.stringify(this.results, null, 2));
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
    console.log("Pulse Reporter: Merging results from shards...");
    let allResults: PulseTestResult[] = [];
    const totalShards = parseInt(process.env.PLAYWRIGHT_SHARD_TOTAL || "1", 10);

    for (let i = 0; i < totalShards; i++) {
      const tempFilePath = path.join(
        this.outputDir,
        `${TEMP_SHARD_FILE_PREFIX}${i}.json`
      );
      try {
        const content = await fs.readFile(tempFilePath, "utf-8");
        const shardResults = JSON.parse(content) as PulseTestResult[];
        shardResults.forEach((r) => (r.runId = finalRunData.id));
        allResults = allResults.concat(shardResults);
      } catch (error: any) {
        if (error && error.code === "ENOENT") {
          console.warn(
            `Pulse Reporter: Shard results file not found: ${tempFilePath}.`
          );
        } else {
          console.warn(
            `Pulse Reporter: Could not read or parse results from shard ${i} (${tempFilePath}). Error: ${error}`
          );
        }
      }
    }
    console.log(
      `Pulse Reporter: Merged a total of ${allResults.length} results from ${totalShards} shards.`
    );

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
        console.log(
          `Pulse Reporter: Cleaning up ${tempFiles.length} temporary shard files...`
        );
        await Promise.all(
          tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f)))
        );
      }
    } catch (error: any) {
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
      if (error && error.code !== "EEXIST") {
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
      console.log(
        `PlaywrightPulseReporter: Shard ${this.shardIndex + 1} finished.`
      );
      return;
    }

    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runId = `run-${this.runStartTime}-${Math.random()
      .toString(16)
      .slice(2)}`;

    const runData: PulseTestRun = {
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

    const finalRunStatus =
      finalReport.run?.failed ?? 0 > 0 ? "failed" : "passed";
    console.log(
      `PlaywrightPulseReporter: Test run finished with overall status: ${finalRunStatus}`
    );
    console.log(
      `  Passed: ${finalReport.run?.passed}, Failed: ${finalReport.run?.failed}, Skipped: ${finalReport.run?.skipped}`
    );
    console.log(`  Total tests: ${finalReport.run?.totalTests}`);
    console.log(`  Total time: ${(duration / 1000).toFixed(2)}s`);

    const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);

    try {
      await this._ensureDirExists(this.outputDir);
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
        `PlaywrightPulseReporter: Final report written to ${finalOutputPath}`
      );
    } catch (error) {
      console.error(
        `PlaywrightPulseReporter: Failed to write final report to ${finalOutputPath}`,
        error
      );
    } finally {
      if (this.isSharded) {
        await this._cleanupTemporaryFiles();
      }
    }
  }
}
  
  // No module.exports needed for ES modules
  