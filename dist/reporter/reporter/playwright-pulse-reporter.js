"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
// Helper to convert Playwright status to Pulse status
const convertStatus = (status) => {
    if (status === "passed")
        return "passed";
    if (status === "failed" || status === "timedOut" || status === "interrupted")
        return "failed";
    return "skipped";
};
const TEMP_SHARD_FILE_PREFIX = ".pulse-shard-results-";
class PlaywrightPulseReporter {
    constructor(options = {}) {
        var _a;
        this.results = []; // Holds results *per process* (main or shard)
        this.baseOutputFile = "playwright-pulse-report.json";
        this.isSharded = false;
        this.shardIndex = undefined;
        this.baseOutputFile = (_a = options.outputFile) !== null && _a !== void 0 ? _a : this.baseOutputFile;
        // Resolve outputDir relative to playwright config directory or cwd if not specified
        // Ensure options.outputDir exists before trying to resolve
        const baseDir = options.outputDir
            ? path.resolve(options.outputDir)
            : process.cwd();
        this.outputDir = baseDir;
        // Note: Final resolution happens in onBegin after config is available
        console.log(`PlaywrightPulseReporter: Initial Output dir configured to ${this.outputDir}`);
    }
    printsToStdio() {
        // Prevent shard processes other than the first from printing duplicate status updates
        // The main process (index undefined) or the first shard (index 0) can print.
        return this.shardIndex === undefined || this.shardIndex === 0;
    }
    onBegin(config, suite) {
      this.config = config;
      this.suite = suite;
      this.runStartTime = Date.now();
      // Determine sharding configuration
      const totalShards = parseInt(
        process.env.PLAYWRIGHT_SHARD_TOTAL || "1",
        10
      );
      this.isSharded = totalShards > 1;
      if (process.env.PLAYWRIGHT_SHARD_INDEX !== undefined) {
        this.shardIndex = parseInt(process.env.PLAYWRIGHT_SHARD_INDEX, 10);
      }
      // Resolve outputDir relative to playwright config directory if possible, otherwise use cwd
      // This needs the config object, so it's done in onBegin
      const configDir = this.config.rootDir; // Playwright config directory
      // Use outputDir from options if provided and resolve it relative to configDir, otherwise default
      this.outputDir = this.outputDir
        ? path.resolve(configDir, this.outputDir)
        : path.resolve(configDir, "pulse-report"); // Default to 'pulse-report' relative to config
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
        // Clean up any leftover temp files from previous runs in the main process
        this._cleanupTemporaryFiles().catch((err) =>
          console.error("Pulse Reporter: Error cleaning up temp files:", err)
        );
      } else {
        // Shard process
        console.log(
          `PlaywrightPulseReporter: Shard ${
            this.shardIndex + 1
          }/${totalShards} starting. Outputting temp results to ${
            this.outputDir
          }`
        );
      }
    }
    onTestBegin(test) {
        // Optional: Log test start (maybe only in main process or first shard?)
        // if (this.printsToStdio()) {
        //    console.log(`Starting test: ${test.title}`);
        // }
    }
    processStep(step, parentStatus) {
        var _a;
        // If parent failed or was skipped, all child steps inherit that status
        const inherentStatus = parentStatus === "failed" || parentStatus === "skipped"
            ? parentStatus
            : convertStatus(step.error ? "failed" : "passed");
        const duration = step.duration;
        const startTime = new Date(step.startTime);
        // Ensure endTime is calculated correctly, respecting duration might be 0
        const endTime = new Date(startTime.getTime() + Math.max(0, duration));
        return {
            // Create a somewhat unique ID combining title and timing details
            id: `${step.title}-${startTime.toISOString()}-${duration}-${Math.random()
                .toString(16)
                .slice(2)}`, // Add random suffix for uniqueness
            title: step.title,
            status: inherentStatus,
            duration: duration,
            startTime: startTime,
            endTime: endTime,
            errorMessage: (_a = step.error) === null || _a === void 0 ? void 0 : _a.message,
            // We won't embed screenshots directly, maybe paths later
            screenshot: undefined, // Placeholder for potential future enhancement
        };
    }
    onTestEnd(test, result) {
        // This runs in each SHARD PROCESS
        var _a, _b, _c, _d, _e;
        const testStatus = convertStatus(result.status);
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration);
        const processAllSteps = (steps, parentTestStatus) => {
            let processed = [];
            for (const step of steps) {
                // Pass the overall test status down, as a step cannot pass if the test failed/skipped
                const processedStep = this.processStep(step, parentTestStatus);
                processed.push(processedStep);
                if (step.steps.length > 0) {
                    // Use the processed step's status for its children
                    processed = processed.concat(processAllSteps(step.steps, processedStep.status));
                }
            }
            return processed;
        };
        // Extract code snippet if available (experimental, might not be reliable)
        let codeSnippet = undefined;
        try {
            if ((_a = test.location) === null || _a === void 0 ? void 0 : _a.file) {
                // This requires reading the file, which might be slow or have permissions issues
                // const fileContent = fs.readFileSync(test.location.file, 'utf-8');
                // const lines = fileContent.split('\n');
                // // Extract lines around the test definition (this is a rough guess)
                // const startLine = Math.max(0, test.location.line - 5);
                // const endLine = Math.min(lines.length, test.location.line + 10);
                // codeSnippet = lines.slice(startLine, endLine).join('\n');
                codeSnippet = `Test defined at: ${test.location.file}:${test.location.line}:${test.location.column}`; // Simpler placeholder
            }
        }
        catch (e) {
            console.warn(`Pulse Reporter: Could not extract code snippet for ${test.title}`, e);
        }
        const pulseResult = {
            id: test.id ||
                `${test.title}-${startTime.toISOString()}-${Math.random()
                    .toString(16)
                    .slice(2)}`, // Fallback ID if test.id is missing
            runId: "TBD", // Placeholder, will be set by main process later
            name: test.titlePath().join(" > "), // Use full title path
            suiteName: test.parent.title,
            status: testStatus,
            duration: result.duration,
            startTime: startTime,
            endTime: endTime,
            retries: result.retry,
            // Process steps recursively, passing the final test status
            steps: processAllSteps(result.steps, testStatus),
            errorMessage: (_b = result.error) === null || _b === void 0 ? void 0 : _b.message,
            stackTrace: (_c = result.error) === null || _c === void 0 ? void 0 : _c.stack,
            codeSnippet: codeSnippet,
            // Get relative paths for attachments if possible, otherwise use absolute
            screenshot: (_d = result.attachments.find((a) => a.name === "screenshot")) === null || _d === void 0 ? void 0 : _d.path,
            video: (_e = result.attachments.find((a) => a.name === "video")) === null || _e === void 0 ? void 0 : _e.path,
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag),
        };
        this.results.push(pulseResult);
        // console.log(`Finished test: ${test.title} - ${result.status}`); // Optional: Log test end per shard
    }
    onError(error) {
        var _a;
        // This can run in shards or main process
        console.error(`PlaywrightPulseReporter: Error encountered (Shard: ${(_a = this.shardIndex) !== null && _a !== void 0 ? _a : "Main"}):`, error);
    }
    _writeShardResults() {
        return __awaiter(this, void 0, void 0, function* () {
            // Writes the results gathered in *this specific shard process* to a temp file
            if (this.shardIndex === undefined) {
                console.warn("Pulse Reporter: _writeShardResults called in main process. Skipping.");
                return;
            }
            const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`);
            try {
                yield this._ensureDirExists(this.outputDir);
                yield fs.writeFile(tempFilePath, JSON.stringify(this.results, null, 2));
                // console.log(`Pulse Reporter: Shard ${this.shardIndex} results written to ${tempFilePath}`);
            }
            catch (error) {
                console.error(`Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`, error);
            }
        });
    }
    _mergeShardResults(finalRunData) {
        return __awaiter(this, void 0, void 0, function* () {
            // Runs *only* in the main process to merge results from all shards
            console.log("Pulse Reporter: Merging results from shards...");
            let allResults = [];
            const totalShards = parseInt(process.env.PLAYWRIGHT_SHARD_TOTAL || "1", 10);
            for (let i = 0; i < totalShards; i++) {
                const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${i}.json`);
                try {
                    const content = yield fs.readFile(tempFilePath, "utf-8");
                    const shardResults = JSON.parse(content);
                    // Assign the final runId to results from this shard
                    shardResults.forEach((r) => (r.runId = finalRunData.id));
                    allResults = allResults.concat(shardResults);
                    // console.log(`Pulse Reporter: Merged ${shardResults.length} results from shard ${i}`);
                }
                catch (error) {
                    if (error &&
                        typeof error === "object" &&
                        "code" in error &&
                        error.code === "ENOENT") {
                        console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}. This might happen if a shard had no tests or failed early.`);
                    }
                    else {
                        console.warn(`Pulse Reporter: Could not read or parse results from shard ${i} (${tempFilePath}). Error: ${error}`);
                    }
                }
            }
            console.log(`Pulse Reporter: Merged a total of ${allResults.length} results from ${totalShards} shards.`);
            // Recalculate final counts based on merged results
            finalRunData.passed = allResults.filter((r) => r.status === "passed").length;
            finalRunData.failed = allResults.filter((r) => r.status === "failed").length;
            finalRunData.skipped = allResults.filter((r) => r.status === "skipped").length;
            finalRunData.totalTests = allResults.length;
            return {
                run: finalRunData,
                results: allResults,
                metadata: { generatedAt: new Date().toISOString() },
            };
        });
    }
    _cleanupTemporaryFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            // Runs *only* in the main process after merging or on error
            try {
                yield this._ensureDirExists(this.outputDir); // Ensure dir exists before reading
                const files = yield fs.readdir(this.outputDir);
                const tempFiles = files.filter((f) => f.startsWith(TEMP_SHARD_FILE_PREFIX));
                if (tempFiles.length > 0) {
                    console.log(`Pulse Reporter: Cleaning up ${tempFiles.length} temporary shard files...`);
                    yield Promise.all(tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f))));
                }
            }
            catch (error) {
                // Ignore ENOENT (directory not found) errors, log others
                if (error &&
                    typeof error === "object" &&
                    "code" in error &&
                    error.code !== "ENOENT") {
                    console.error("Pulse Reporter: Error cleaning up temporary files:", error);
                }
            }
        });
    }
    _ensureDirExists(dirPath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield fs.mkdir(dirPath, { recursive: true });
            }
            catch (error) {
                // Ignore EEXIST errors (directory already exists)
                if (error &&
                    typeof error === "object" &&
                    "code" in error &&
                    error.code !== "EEXIST") {
                    console.error(`Pulse Reporter: Failed to ensure directory exists: ${dirPath}`, error); // Log error if mkdir fails unexpectedly
                    throw error; // Re-throw other errors
                }
            }
        });
    }
    onEnd(result) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            if (this.shardIndex !== undefined) {
                // This is a shard process, write its results to a temp file and exit
                yield this._writeShardResults();
                console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1} finished.`);
                return;
            }
            // ---- This is the MAIN PROCESS ----
            const runEndTime = Date.now();
            const duration = runEndTime - this.runStartTime;
            // The main process result.status might not be accurate with sharding, recalculate later
            // const runStatus = convertStatus(result.status);
            const runId = `run-${this.runStartTime}-${Math.random()
                .toString(16)
                .slice(2)}`; // Add randomness to run ID for uniqueness
            // Initial run data (counts will be recalculated after merging)
            const runData = {
                id: runId,
                timestamp: new Date(this.runStartTime),
                totalTests: 0, // Placeholder
                passed: 0, // Placeholder
                failed: 0, // Placeholder
                skipped: 0, // Placeholder
                duration,
            };
            let finalReport;
            if (this.isSharded) {
                // Merge results from all shard temp files
                finalReport = yield this._mergeShardResults(runData);
            }
            else {
                // No sharding, use the results gathered in this main process
                this.results.forEach((r) => (r.runId = runId)); // Assign runId
                runData.passed = this.results.filter((r) => r.status === "passed").length;
                runData.failed = this.results.filter((r) => r.status === "failed").length;
                runData.skipped = this.results.filter((r) => r.status === "skipped").length;
                runData.totalTests = this.results.length;
                finalReport = {
                    run: runData,
                    results: this.results,
                    metadata: { generatedAt: new Date().toISOString() },
                };
            }
            // Log final summary from the main process
            const finalRunStatus = ((_b = (_a = finalReport.run) === null || _a === void 0 ? void 0 : _a.failed) !== null && _b !== void 0 ? _b : 0 > 0) ? "failed" : "passed"; // Simplified overall status
            console.log(`PlaywrightPulseReporter: Test run finished with overall status: ${finalRunStatus}`);
            console.log(`  Passed: ${(_c = finalReport.run) === null || _c === void 0 ? void 0 : _c.passed}, Failed: ${(_d = finalReport.run) === null || _d === void 0 ? void 0 : _d.failed}, Skipped: ${(_e = finalReport.run) === null || _e === void 0 ? void 0 : _e.skipped}`);
            console.log(`  Total tests: ${(_f = finalReport.run) === null || _f === void 0 ? void 0 : _f.totalTests}`);
            console.log(`  Total time: ${(duration / 1000).toFixed(2)}s`);
            const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);
            try {
                yield this._ensureDirExists(this.outputDir);
                yield fs.writeFile(finalOutputPath, JSON.stringify(finalReport, (key, value) => {
                    // Custom replacer to handle Date objects -> ISO strings
                    if (value instanceof Date) {
                        return value.toISOString();
                    }
                    return value;
                }, 2));
                console.log(`PlaywrightPulseReporter: Final report written to ${finalOutputPath}`);
            }
            catch (error) {
                console.error(`PlaywrightPulseReporter: Failed to write final report to ${finalOutputPath}`, error);
            }
            finally {
                // Clean up temporary shard files after merging (or if merge failed)
                if (this.isSharded) {
                    yield this._cleanupTemporaryFiles();
                }
            }
        });
    }
}
// Use CommonJS export for compatibility
module.exports = PlaywrightPulseReporter;
