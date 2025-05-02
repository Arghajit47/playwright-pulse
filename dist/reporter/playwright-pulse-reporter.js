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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightPulseReporter = void 0;
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
// Use standard ES module export
class PlaywrightPulseReporter {
    // private playwrightOutputDir: string = ''; // Removed direct reliance on this
    constructor(options = {}) {
        var _a, _b;
        this.results = []; // Holds results *per process* (main or shard)
        this.baseOutputFile = "playwright-pulse-report.json";
        this.isSharded = false;
        this.shardIndex = undefined;
        this.baseOutputFile = (_a = options.outputFile) !== null && _a !== void 0 ? _a : this.baseOutputFile;
        // Initial outputDir setup for Pulse report (will be refined in onBegin)
        // Store the provided option, defaulting to 'pulse-report-output' relative to config/root
        this.outputDir = (_b = options.outputDir) !== null && _b !== void 0 ? _b : "pulse-report-output";
        // console.log(`PlaywrightPulseReporter: Initial Pulse Output dir option: ${this.outputDir}`);
    }
    printsToStdio() {
        // Only the main process (or the first shard if no main process coordination exists) should print summary logs.
        // Let's assume shard 0 prints if sharded, otherwise the single process prints.
        return this.shardIndex === undefined || this.shardIndex === 0;
    }
    onBegin(config, suite) {
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
            console.log(`PlaywrightPulseReporter: Starting test run with ${suite.allTests().length} tests${this.isSharded ? ` across ${totalShards} shards` : ""}. Pulse outputting to ${this.outputDir}`);
            // Clean up any potential leftover shard files from previous runs
            this._cleanupTemporaryFiles().catch((err) => console.error("Pulse Reporter: Error cleaning up temp files:", err));
        }
        else {
            // Shard process
            // console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1}/${totalShards} starting. Outputting temp results to ${this.outputDir}`);
        }
    }
    onTestBegin(test) {
        // Optional: Log test start if needed
        // console.log(`Starting test: ${test.title}`);
    }
    processStep(step, parentStatus) {
        var _a, _b;
        // Step status inherits failure/skip from parent unless it passes inherently
        const inherentStatus = parentStatus === "failed" || parentStatus === "skipped"
            ? parentStatus
            : convertStatus(step.error ? "failed" : "passed");
        const duration = step.duration;
        const startTime = new Date(step.startTime);
        const endTime = new Date(startTime.getTime() + Math.max(0, duration)); // Ensure duration is non-negative
        // Find screenshot within this specific step's attachments and store RELATIVE path
        const stepScreenshotAttachment = (_a = step.attachments) === null || _a === void 0 ? void 0 : _a.find((a) => a.name === "screenshot" && a.path && typeof a.path === "string");
        // Store the path as provided by Playwright (relative to Playwright's outputDir)
        const screenshotRelativePath = stepScreenshotAttachment === null || stepScreenshotAttachment === void 0 ? void 0 : stepScreenshotAttachment.path;
        return {
            id: `${step.title}-${startTime.toISOString()}-${duration}-${Math.random()
                .toString(16)
                .slice(2)}`, // Attempt at a more unique ID
            title: step.title,
            status: inherentStatus,
            duration: duration,
            startTime: startTime,
            endTime: endTime,
            errorMessage: (_b = step.error) === null || _b === void 0 ? void 0 : _b.message,
            screenshot: screenshotRelativePath, // Store relative path
            // videoTimestamp: undefined, // Placeholder if needed later
        };
    }
    onTestEnd(test, result) {
        var _a, _b, _c, _d, _e;
        const testStatus = convertStatus(result.status);
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration); // Calculate end time
        // Recursive function to process steps and their nested steps
        const processAllSteps = (steps, parentTestStatus) => {
            let processed = [];
            for (const step of steps) {
                const processedStep = this.processStep(step, parentTestStatus);
                processed.push(processedStep);
                // Recursively process nested steps, passing the *current* step's resolved status
                if (step.steps && step.steps.length > 0) {
                    processed = processed.concat(processAllSteps(step.steps, processedStep.status));
                }
            }
            return processed;
        };
        // Extract code snippet location
        let codeSnippet = undefined;
        try {
            if (((_a = test.location) === null || _a === void 0 ? void 0 : _a.file) && ((_b = test.location) === null || _b === void 0 ? void 0 : _b.line) && ((_c = test.location) === null || _c === void 0 ? void 0 : _c.column)) {
                // Make path relative to project rootDir for consistency and brevity
                const relativePath = path.relative(this.config.rootDir, test.location.file);
                codeSnippet = `Test defined at: ${relativePath}:${test.location.line}:${test.location.column}`;
            }
        }
        catch (e) {
            console.warn(`Pulse Reporter: Could not extract code snippet for ${test.title}`, e);
        }
        // Get relative attachment paths (screenshot on failure, video)
        const screenshotAttachment = result.attachments.find((a) => a.name === "screenshot" && a.path && typeof a.path === "string");
        const videoAttachment = result.attachments.find((a) => a.name === "video" && a.path && typeof a.path === "string");
        const relativeScreenshotPath = screenshotAttachment === null || screenshotAttachment === void 0 ? void 0 : screenshotAttachment.path;
        const relativeVideoPath = videoAttachment === null || videoAttachment === void 0 ? void 0 : videoAttachment.path;
        const pulseResult = {
            id: test.id ||
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
            errorMessage: (_d = result.error) === null || _d === void 0 ? void 0 : _d.message,
            stackTrace: (_e = result.error) === null || _e === void 0 ? void 0 : _e.stack,
            codeSnippet: codeSnippet,
            screenshot: relativeScreenshotPath, // Store relative path
            video: relativeVideoPath, // Store relative path
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag), // Remove leading '@' from tags
        };
        this.results.push(pulseResult);
    }
    onError(error) {
        var _a;
        // Log errors encountered during the test run
        console.error(`PlaywrightPulseReporter: Error encountered (Shard: ${(_a = this.shardIndex) !== null && _a !== void 0 ? _a : "Main"}):`, (error === null || error === void 0 ? void 0 : error.message) || error);
        if (error === null || error === void 0 ? void 0 : error.stack) {
            console.error(error.stack);
        }
    }
    async _writeShardResults() {
        // Writes the results collected by this specific shard process to a temporary file.
        if (this.shardIndex === undefined) {
            console.warn("Pulse Reporter: _writeShardResults called unexpectedly in main process. Skipping.");
            return;
        }
        const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`);
        try {
            await this._ensureDirExists(this.outputDir);
            // Use the same Date replacer as in onEnd to ensure consistency
            await fs.writeFile(tempFilePath, JSON.stringify(this.results, (key, value) => {
                if (value instanceof Date) {
                    return value.toISOString(); // Convert Dates to ISO strings
                }
                return value;
            }, 2)); // Use indentation for readability of temp files (optional)
            // console.log(`Pulse Reporter: Shard ${this.shardIndex} wrote ${this.results.length} results to ${tempFilePath}`);
        }
        catch (error) {
            console.error(`Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`, error);
        }
    }
    async _mergeShardResults(finalRunData) {
        // Reads temporary files from all shards and merges them into a single report object.
        // console.log('Pulse Reporter: Merging results from shards...');
        let allResults = [];
        const totalShards = this.config.shard ? this.config.shard.total : 1; // Use config value
        for (let i = 0; i < totalShards; i++) {
            const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${i}.json`);
            try {
                const content = await fs.readFile(tempFilePath, "utf-8");
                // Parse the shard results - Dates should already be strings here
                const shardResults = JSON.parse(content);
                // Assign the final run ID to each result from the shard
                shardResults.forEach((r) => (r.runId = finalRunData.id));
                allResults = allResults.concat(shardResults);
                // console.log(`Pulse Reporter: Successfully merged ${shardResults.length} results from shard ${i}`);
            }
            catch (error) {
                // Handle cases where a shard file might be missing (e.g., shard failed early)
                if ((error === null || error === void 0 ? void 0 : error.code) === "ENOENT") {
                    console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}. This might happen if shard ${i} had no tests or failed early.`);
                }
                else {
                    console.error(`Pulse Reporter: Could not read or parse results from shard ${i} (${tempFilePath}). Error:`, error);
                }
            }
        }
        // console.log(`Pulse Reporter: Merged a total of ${allResults.length} results from ${totalShards} shards.`);
        // Recalculate final counts based on merged results
        finalRunData.passed = allResults.filter((r) => r.status === "passed").length;
        finalRunData.failed = allResults.filter((r) => r.status === "failed").length;
        finalRunData.skipped = allResults.filter((r) => r.status === "skipped").length;
        finalRunData.totalTests = allResults.length;
        // Re-parse merged results with date reviver for the final report object in memory
        // (although we'll stringify again for the file)
        const finalParsedResults = JSON.parse(JSON.stringify(allResults), (key, value) => {
            const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
            if (typeof value === "string" && isoDateRegex.test(value)) {
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                    return date;
                }
            }
            return value;
        });
        return {
            run: finalRunData,
            results: finalParsedResults, // Use the results with revived Dates
            metadata: { generatedAt: new Date().toISOString() }, // Add generation timestamp
        };
    }
    async _cleanupTemporaryFiles() {
        // Removes the temporary shard result files after merging.
        try {
            await this._ensureDirExists(this.outputDir); // Ensure directory exists before reading
            const files = await fs.readdir(this.outputDir);
            const tempFiles = files.filter((f) => f.startsWith(TEMP_SHARD_FILE_PREFIX));
            if (tempFiles.length > 0) {
                // console.log(`Pulse Reporter: Cleaning up ${tempFiles.length} temporary shard files...`);
                await Promise.all(tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f))));
            }
        }
        catch (error) {
            // Ignore ENOENT (directory not found) which can happen if no shards wrote files
            // or if the directory was cleaned up by another process.
            if ((error === null || error === void 0 ? void 0 : error.code) !== "ENOENT") {
                console.error("Pulse Reporter: Error cleaning up temporary files:", error);
            }
        }
    }
    async _ensureDirExists(dirPath) {
        // Creates a directory if it doesn't exist, ignoring errors if it already exists.
        try {
            await fs.mkdir(dirPath, { recursive: true });
        }
        catch (error) {
            // Ignore EEXIST (directory already exists) error
            if ((error === null || error === void 0 ? void 0 : error.code) !== "EEXIST") {
                console.error(`Pulse Reporter: Failed to ensure directory exists: ${dirPath}`, error);
                throw error; // Rethrow other unexpected errors
            }
        }
    }
    async onEnd(result) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
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
        const runData = {
            id: runId,
            timestamp: new Date(this.runStartTime),
            totalTests: 0, // Placeholder
            passed: 0, // Placeholder
            failed: 0, // Placeholder
            skipped: 0, // Placeholder
            duration, // Calculated duration
        };
        let finalReport;
        if (this.isSharded) {
            // If sharded, merge results from all shard temporary files
            // console.log("Pulse Reporter: Run ended, main process merging shard results...");
            finalReport = await this._mergeShardResults(runData);
        }
        else {
            // If not sharded, process results directly from this instance
            // console.log("Pulse Reporter: Run ended, processing results directly (no sharding)...");
            this.results.forEach((r) => (r.runId = runId)); // Assign runId to results
            runData.passed = this.results.filter((r) => r.status === "passed").length;
            runData.failed = this.results.filter((r) => r.status === "failed").length;
            runData.skipped = this.results.filter((r) => r.status === "skipped").length;
            runData.totalTests = this.results.length;
            finalReport = {
                run: runData,
                results: this.results, // Use results collected by this instance
                metadata: { generatedAt: new Date().toISOString() }, // Add generation timestamp
            };
        }
        // Print summary to console (only from main process)
        const finalRunStatus = ((_b = (_a = finalReport.run) === null || _a === void 0 ? void 0 : _a.failed) !== null && _b !== void 0 ? _b : 0 > 0)
            ? "failed"
            : ((_c = finalReport.run) === null || _c === void 0 ? void 0 : _c.totalTests) === 0
                ? "no tests"
                : "passed";
        const summary = `
PlaywrightPulseReporter: Run Finished
-----------------------------------------
  Overall Status: ${finalRunStatus.toUpperCase()}
  Total Tests:    ${(_e = (_d = finalReport.run) === null || _d === void 0 ? void 0 : _d.totalTests) !== null && _e !== void 0 ? _e : "N/A"}
  Passed:         ${(_g = (_f = finalReport.run) === null || _f === void 0 ? void 0 : _f.passed) !== null && _g !== void 0 ? _g : "N/A"}
  Failed:         ${(_j = (_h = finalReport.run) === null || _h === void 0 ? void 0 : _h.failed) !== null && _j !== void 0 ? _j : "N/A"}
  Skipped:        ${(_l = (_k = finalReport.run) === null || _k === void 0 ? void 0 : _k.skipped) !== null && _l !== void 0 ? _l : "N/A"}
  Duration:       ${(duration / 1000).toFixed(2)}s
-----------------------------------------`;
        console.log(summary);
        const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);
        try {
            await this._ensureDirExists(this.outputDir); // Make sure output directory exists
            // Write the final combined JSON report
            // Use a replacer function to convert Date objects back to ISO strings for JSON
            await fs.writeFile(finalOutputPath, JSON.stringify(finalReport, (key, value) => {
                if (value instanceof Date) {
                    return value.toISOString();
                }
                // Preserve relative paths for attachments
                // if (key === 'screenshot' || key === 'video') {
                //     return value; // Keep as is (should be relative)
                // }
                return value;
            }, 2)); // Indent for readability
            console.log(`PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`);
            // --- Trigger Static HTML Generation ---
            // Locate the script relative to the current file's directory
            // This makes it more robust regardless of where node_modules is installed
            // Correct path assuming script is in project_root/scripts/
            const staticScriptPath = path.resolve(this.config.rootDir, "node_modules", this.config.reporter.find((r) => r[0] === "playwright-pulse-reporter")[0], "../../scripts/generate-static-report.mjs");
            try {
                await fs.access(staticScriptPath); // Check if script exists and is accessible
                // Use dynamic import for ES Modules
                const generateStaticReportModule = await Promise.resolve(`${staticScriptPath}`).then(s => __importStar(require(s)));
                const generateStaticReport = generateStaticReportModule.default; // Access the default export
                if (typeof generateStaticReport === "function") {
                    // console.log(`PlaywrightPulseReporter: Generating static HTML report using function from ${staticScriptPath}...`);
                    // Pass the pulse output directory to the generation script
                    await generateStaticReport(this.outputDir);
                    console.log(`PlaywrightPulseReporter: Static HTML report generated in ${this.outputDir}`);
                }
                else {
                    console.warn(`Pulse Reporter: Default export of ${staticScriptPath} is not a function. Cannot generate static report.`);
                }
            }
            catch (scriptError) {
                // Use unknown type for error
                // Type guard to check if it's an error object with a 'code' property
                if (scriptError instanceof Error &&
                    "code" in scriptError &&
                    scriptError.code === "ENOENT") {
                    console.warn(`Pulse Reporter: Static report generation script not found at ${staticScriptPath}. Looked relative to project root. Skipping HTML generation.`);
                }
                else if (scriptError instanceof Error) {
                    console.error(`Pulse Reporter: Error trying to run static report generation script: ${scriptError.message}`, scriptError.stack);
                }
                else {
                    console.error(`Pulse Reporter: Unknown error trying to run static report generation script:`, scriptError);
                }
            }
        }
        catch (error) {
            console.error(`PlaywrightPulseReporter: Failed to write final JSON report to ${finalOutputPath}`, error);
        }
        finally {
            // Cleanup temporary shard files *only* if sharding was actually used
            if (this.isSharded) {
                // console.log("Pulse Reporter: Cleaning up temporary shard files...");
                await this._cleanupTemporaryFiles();
            }
        }
    }
}
exports.PlaywrightPulseReporter = PlaywrightPulseReporter;
