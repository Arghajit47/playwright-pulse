"use strict";
// input_file_0.ts
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
const crypto_1 = require("crypto");
const attachment_utils_1 = require("./attachment-utils"); // Use relative path
const convertStatus = (status, testCase) => {
    if ((testCase === null || testCase === void 0 ? void 0 : testCase.expectedStatus) === "failed") {
        return status === "failed" ? "failed" : "failed";
    }
    if ((testCase === null || testCase === void 0 ? void 0 : testCase.expectedStatus) === "skipped") {
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
class PlaywrightPulseReporter {
    constructor(options = {}) {
        var _a, _b;
        this.results = [];
        this.baseOutputFile = "playwright-pulse-report.json";
        this.isSharded = false;
        this.shardIndex = undefined;
        this.options = options;
        this.baseOutputFile = (_a = options.outputFile) !== null && _a !== void 0 ? _a : this.baseOutputFile;
        this.outputDir = (_b = options.outputDir) !== null && _b !== void 0 ? _b : "pulse-report";
        this.attachmentsDir = path.join(this.outputDir, ATTACHMENTS_SUBDIR);
    }
    printsToStdio() {
        return this.shardIndex === undefined || this.shardIndex === 0;
    }
    onBegin(config, suite) {
        var _a;
        this.config = config;
        this.suite = suite;
        this.runStartTime = Date.now();
        const configDir = this.config.rootDir;
        const configFileDir = this.config.configFile
            ? path.dirname(this.config.configFile)
            : configDir;
        this.outputDir = path.resolve(configFileDir, (_a = this.options.outputDir) !== null && _a !== void 0 ? _a : "pulse-report");
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
                console.log(`PlaywrightPulseReporter: Starting test run with ${suite.allTests().length} tests${this.isSharded ? ` across ${totalShards} shards` : ""}. Pulse outputting to ${this.outputDir}`);
                return this._cleanupTemporaryFiles();
            }
        })
            .catch((err) => console.error("Pulse Reporter: Error during initialization:", err));
    }
    onTestBegin(test) {
        // console.log(`Starting test: ${test.title}`);
    }
    async processStep(step, testId, browserName, // Changed from browserName for clarity
    testCase) {
        var _a, _b, _c, _d;
        let stepStatus = "passed";
        let errorMessage = ((_a = step.error) === null || _a === void 0 ? void 0 : _a.message) || undefined;
        if ((_c = (_b = step.error) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.startsWith("Test is skipped:")) {
            stepStatus = "skipped";
            errorMessage = "Info: Test is skipped:";
        }
        else {
            stepStatus = convertStatus(step.error ? "failed" : "passed", testCase);
        }
        const duration = step.duration;
        const startTime = new Date(step.startTime);
        const endTime = new Date(startTime.getTime() + Math.max(0, duration));
        let codeLocation = "";
        if (step.location) {
            codeLocation = `${path.relative(this.config.rootDir, step.location.file)}:${step.location.line}:${step.location.column}`;
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
                }
                else {
                    // If a step within an expected-to-fail test passes, it's usually not an error for the step itself.
                }
            }
            else if (testCase.expectedStatus === "skipped") {
                // errorMessage is already set if step.error.message started with "Test is skipped:"
            }
        }
        return {
            id: `${testId}_step_${startTime.toISOString()}-${duration}-${(0, crypto_1.randomUUID)()}`,
            title: stepTitle,
            status: stepStatus,
            duration: duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserName,
            errorMessage: errorMessage,
            stackTrace: ((_d = step.error) === null || _d === void 0 ? void 0 : _d.stack) || undefined,
            codeLocation: codeLocation || undefined,
            isHook: step.category === "hook",
            hookType: step.category === "hook"
                ? step.title.toLowerCase().includes("before")
                    ? "before"
                    : "after"
                : undefined,
            steps: [],
        };
    }
    async onTestEnd(test, result) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        // Use project.name for a user-friendly display name
        const browserName = ((_b = project === null || project === void 0 ? void 0 : project.use) === null || _b === void 0 ? void 0 : _b.defaultBrowserType) || "unknown";
        // If you need the engine name (chromium, firefox, webkit)
        // const browserEngineName = project?.use?.browserName || "unknown_engine";
        const testStatus = convertStatus(result.status, test);
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration);
        const testIdForFiles = test.id ||
            `${test
                .titlePath()
                .join("_")
                .replace(/[^a-zA-Z0-9]/g, "_")}_${startTime.getTime()}`;
        const processAllSteps = async (steps
        // parentTestStatus parameter was not used, removed for now.
        // If needed for inherited status logic for steps, it can be re-added.
        ) => {
            let processed = [];
            for (const step of steps) {
                const processedStep = await this.processStep(step, testIdForFiles, browserName, // Pass display name
                test);
                processed.push(processedStep);
                if (step.steps && step.steps.length > 0) {
                    processedStep.steps = await processAllSteps(step.steps);
                }
            }
            return processed;
        };
        let codeSnippet = undefined;
        try {
            if (((_c = test.location) === null || _c === void 0 ? void 0 : _c.file) && ((_d = test.location) === null || _d === void 0 ? void 0 : _d.line) && ((_e = test.location) === null || _e === void 0 ? void 0 : _e.column)) {
                const relativePath = path.relative(this.config.rootDir, test.location.file);
                codeSnippet = `Test defined at: ${relativePath}:${test.location.line}:${test.location.column}`;
            }
        }
        catch (e) {
            console.warn(`Pulse Reporter: Could not extract code snippet for ${test.title}`, e);
        }
        // --- Capture stdout and stderr ---
        const stdoutMessages = [];
        if (result.stdout && result.stdout.length > 0) {
            result.stdout.forEach((item) => {
                if (typeof item === "string") {
                    stdoutMessages.push(item);
                }
                else {
                    // If item is not a string, Playwright's typings indicate it's a Buffer (or Buffer-like).
                    // We must call toString() on it.
                    // The 'item' here is typed as 'Buffer' from the 'else' branch of '(string | Buffer)[]'
                    stdoutMessages.push(item.toString());
                }
            });
        }
        const stderrMessages = [];
        if (result.stderr && result.stderr.length > 0) {
            result.stderr.forEach((item) => {
                if (typeof item === "string") {
                    stderrMessages.push(item);
                }
                else {
                    // If item is not a string, Playwright's typings indicate it's a Buffer (or Buffer-like).
                    // We must call toString() on it.
                    stderrMessages.push(item.toString());
                }
            });
        }
        // --- End capture stdout and stderr ---
        const pulseResult = {
            id: test.id || `${test.title}-${startTime.toISOString()}-${(0, crypto_1.randomUUID)()}`,
            runId: "TBD",
            name: test.titlePath().join(" > "),
            // Use project.name for suiteName if desired, or fallback
            suiteName: (project === null || project === void 0 ? void 0 : project.name) || ((_f = this.config.projects[0]) === null || _f === void 0 ? void 0 : _f.name) || "Default Suite",
            status: testStatus,
            duration: result.duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserName, // Use the user-friendly project name
            retries: result.retry,
            steps: ((_g = result.steps) === null || _g === void 0 ? void 0 : _g.length) ? await processAllSteps(result.steps) : [],
            errorMessage: (_h = result.error) === null || _h === void 0 ? void 0 : _h.message,
            stackTrace: (_j = result.error) === null || _j === void 0 ? void 0 : _j.stack,
            codeSnippet: codeSnippet,
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag),
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
            (0, attachment_utils_1.attachFiles)(testIdForFiles, result, pulseResult, this.options);
        }
        catch (attachError) {
            console.error(`Pulse Reporter: Error processing attachments for test ${pulseResult.name} (ID: ${testIdForFiles}): ${attachError.message}`);
        }
        this.results.push(pulseResult);
    }
    onError(error) {
        var _a;
        console.error(`PlaywrightPulseReporter: Error encountered (Shard: ${(_a = this.shardIndex) !== null && _a !== void 0 ? _a : "Main"}):`, (error === null || error === void 0 ? void 0 : error.message) || error);
        if (error === null || error === void 0 ? void 0 : error.stack) {
            console.error(error.stack);
        }
    }
    async _writeShardResults() {
        if (this.shardIndex === undefined) {
            // console.warn("Pulse Reporter: _writeShardResults called unexpectedly in main process. Skipping.");
            return;
        }
        const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`);
        try {
            await fs.writeFile(tempFilePath, JSON.stringify(this.results, (key, value) => (value instanceof Date ? value.toISOString() : value), 2));
        }
        catch (error) {
            console.error(`Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`, error);
        }
    }
    async _mergeShardResults(finalRunData) {
        let allResults = [];
        const totalShards = this.config.shard ? this.config.shard.total : 1;
        for (let i = 0; i < totalShards; i++) {
            const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${i}.json`);
            try {
                const content = await fs.readFile(tempFilePath, "utf-8");
                const shardResults = JSON.parse(content);
                shardResults.forEach((r) => (r.runId = finalRunData.id));
                allResults = allResults.concat(shardResults);
            }
            catch (error) {
                if ((error === null || error === void 0 ? void 0 : error.code) === "ENOENT") {
                    console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}.`);
                }
                else {
                    console.error(`Pulse Reporter: Could not read/parse results from shard ${i} (${tempFilePath}). Error:`, error);
                }
            }
        }
        finalRunData.passed = allResults.filter((r) => r.status === "passed").length;
        finalRunData.failed = allResults.filter((r) => r.status === "failed").length;
        finalRunData.skipped = allResults.filter((r) => r.status === "skipped").length;
        finalRunData.totalTests = allResults.length;
        const reviveDates = (key, value) => {
            const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
            if (typeof value === "string" && isoDateRegex.test(value)) {
                const date = new Date(value);
                return !isNaN(date.getTime()) ? date : value;
            }
            return value;
        };
        const finalParsedResults = JSON.parse(JSON.stringify(allResults), reviveDates);
        return {
            run: finalRunData,
            results: finalParsedResults,
            metadata: { generatedAt: new Date().toISOString() },
        };
    }
    async _cleanupTemporaryFiles() {
        try {
            const files = await fs.readdir(this.outputDir);
            const tempFiles = files.filter((f) => f.startsWith(TEMP_SHARD_FILE_PREFIX));
            if (tempFiles.length > 0) {
                await Promise.all(tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f))));
            }
        }
        catch (error) {
            if ((error === null || error === void 0 ? void 0 : error.code) !== "ENOENT") {
                console.error("Pulse Reporter: Error cleaning up temporary files:", error);
            }
        }
    }
    async _ensureDirExists(dirPath) {
        // Removed 'clean' parameter as it was unused
        try {
            await fs.mkdir(dirPath, { recursive: true });
        }
        catch (error) {
            if (error.code !== "EEXIST") {
                console.error(`Pulse Reporter: Failed to ensure directory exists: ${dirPath}`, error);
                throw error;
            }
        }
    }
    async onEnd(result) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        if (this.shardIndex !== undefined) {
            await this._writeShardResults();
            return;
        }
        const runEndTime = Date.now();
        const duration = runEndTime - this.runStartTime;
        // Consider making the UUID part truly random for each run if this ID needs to be globally unique over time
        const runId = `run-${this.runStartTime}-${(0, crypto_1.randomUUID)()}`;
        const runData = {
            id: runId,
            timestamp: new Date(this.runStartTime),
            totalTests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration,
        };
        let finalReport;
        if (this.isSharded) {
            finalReport = await this._mergeShardResults(runData);
        }
        else {
            this.results.forEach((r) => (r.runId = runId));
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
            await this._ensureDirExists(this.outputDir);
            await fs.writeFile(finalOutputPath, JSON.stringify(finalReport, (key, value) => {
                if (value instanceof Date)
                    return value.toISOString();
                if (typeof value === "bigint")
                    return value.toString();
                return value;
            }, 2));
            console.log(`PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`);
        }
        catch (error) {
            console.error(`Pulse Reporter: Failed to write final JSON report to ${finalOutputPath}. Error: ${error.message}`);
        }
        finally {
            if (this.isSharded) {
                await this._cleanupTemporaryFiles();
            }
        }
    }
}
exports.PlaywrightPulseReporter = PlaywrightPulseReporter;
exports.default = PlaywrightPulseReporter;
