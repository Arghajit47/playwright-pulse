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
    constructor(options = {}) {
        var _a;
        this.results = []; // Holds results *per process* (main or shard)
        this.baseOutputFile = "playwright-pulse-report.json";
        this.isSharded = false;
        this.shardIndex = undefined;
        this.baseOutputFile = (_a = options.outputFile) !== null && _a !== void 0 ? _a : this.baseOutputFile;
        // Initial outputDir setup (will be refined in onBegin)
        const baseDir = options.outputDir
            ? path.resolve(options.outputDir)
            : process.cwd();
        this.outputDir = baseDir;
        console.log(`PlaywrightPulseReporter: Initial Output dir configured to ${this.outputDir}`);
    }
    printsToStdio() {
        return this.shardIndex === undefined || this.shardIndex === 0;
    }
    onBegin(config, suite) {
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
          : path.resolve(configDir, "pulse-report");
        console.log(`PlaywrightPulseReporter: Final Output dir resolved to ${this.outputDir}`);
        if (this.shardIndex === undefined) {
            // Main process
            console.log(`PlaywrightPulseReporter: Starting test run with ${suite.allTests().length} tests${this.isSharded ? ` across ${totalShards} shards` : ""}. Outputting to ${this.outputDir}`);
            this._cleanupTemporaryFiles().catch((err) => console.error("Pulse Reporter: Error cleaning up temp files:", err));
        }
        else {
            // Shard process
            console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1}/${totalShards} starting. Outputting temp results to ${this.outputDir}`);
        }
    }
    onTestBegin(test) {
        // Optional: Log test start
    }
    processStep(step, parentStatus) {
        var _a;
        const inherentStatus = parentStatus === "failed" || parentStatus === "skipped"
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
            errorMessage: (_a = step.error) === null || _a === void 0 ? void 0 : _a.message,
            screenshot: undefined, // Placeholder
        };
    }
    onTestEnd(test, result) {
        var _a, _b, _c, _d, _e;
        const testStatus = convertStatus(result.status);
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration);
        const processAllSteps = (steps, parentTestStatus) => {
            let processed = [];
            for (const step of steps) {
                const processedStep = this.processStep(step, parentTestStatus);
                processed.push(processedStep);
                if (step.steps.length > 0) {
                    processed = processed.concat(processAllSteps(step.steps, processedStep.status));
                }
            }
            return processed;
        };
        let codeSnippet = undefined;
        try {
            if ((_a = test.location) === null || _a === void 0 ? void 0 : _a.file) {
                codeSnippet = `Test defined at: ${test.location.file}:${test.location.line}:${test.location.column}`;
            }
        }
        catch (e) {
            console.warn(`Pulse Reporter: Could not extract code snippet for ${test.title}`, e);
        }
        const pulseResult = {
            id: test.id ||
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
            errorMessage: (_b = result.error) === null || _b === void 0 ? void 0 : _b.message,
            stackTrace: (_c = result.error) === null || _c === void 0 ? void 0 : _c.stack,
            codeSnippet: codeSnippet,
            screenshot: (_d = result.attachments.find((a) => a.name === "screenshot")) === null || _d === void 0 ? void 0 : _d.path,
            video: (_e = result.attachments.find((a) => a.name === "video")) === null || _e === void 0 ? void 0 : _e.path,
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag),
        };
        this.results.push(pulseResult);
    }
    onError(error) {
        var _a;
        console.error(`PlaywrightPulseReporter: Error encountered (Shard: ${(_a = this.shardIndex) !== null && _a !== void 0 ? _a : "Main"}):`, error);
    }
    async _writeShardResults() {
        if (this.shardIndex === undefined) {
            console.warn("Pulse Reporter: _writeShardResults called in main process. Skipping.");
            return;
        }
        const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`);
        try {
            await this._ensureDirExists(this.outputDir);
            await fs.writeFile(tempFilePath, JSON.stringify(this.results, null, 2));
        }
        catch (error) {
            console.error(`Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`, error);
        }
    }
    async _mergeShardResults(finalRunData) {
        console.log("Pulse Reporter: Merging results from shards...");
        let allResults = [];
        const totalShards = parseInt(process.env.PLAYWRIGHT_SHARD_TOTAL || "1", 10);
        for (let i = 0; i < totalShards; i++) {
            const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${i}.json`);
            try {
                const content = await fs.readFile(tempFilePath, "utf-8");
                const shardResults = JSON.parse(content);
                shardResults.forEach((r) => (r.runId = finalRunData.id));
                allResults = allResults.concat(shardResults);
            }
            catch (error) {
                if (error && error.code === "ENOENT") {
                    console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}.`);
                }
                else {
                    console.warn(`Pulse Reporter: Could not read or parse results from shard ${i} (${tempFilePath}). Error: ${error}`);
                }
            }
        }
        console.log(`Pulse Reporter: Merged a total of ${allResults.length} results from ${totalShards} shards.`);
        finalRunData.passed = allResults.filter((r) => r.status === "passed").length;
        finalRunData.failed = allResults.filter((r) => r.status === "failed").length;
        finalRunData.skipped = allResults.filter((r) => r.status === "skipped").length;
        finalRunData.totalTests = allResults.length;
        return {
            run: finalRunData,
            results: allResults,
            metadata: { generatedAt: new Date().toISOString() },
        };
    }
    async _cleanupTemporaryFiles() {
        try {
            await this._ensureDirExists(this.outputDir);
            const files = await fs.readdir(this.outputDir);
            const tempFiles = files.filter((f) => f.startsWith(TEMP_SHARD_FILE_PREFIX));
            if (tempFiles.length > 0) {
                console.log(`Pulse Reporter: Cleaning up ${tempFiles.length} temporary shard files...`);
                await Promise.all(tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f))));
            }
        }
        catch (error) {
            if (error && error.code !== "ENOENT") {
                console.error("Pulse Reporter: Error cleaning up temporary files:", error);
            }
        }
    }
    async _ensureDirExists(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        }
        catch (error) {
            if (error && error.code !== "EEXIST") {
                console.error(`Pulse Reporter: Failed to ensure directory exists: ${dirPath}`, error);
                throw error;
            }
        }
    }
    async onEnd(result) {
        var _a, _b, _c, _d, _e, _f;
        if (this.shardIndex !== undefined) {
            await this._writeShardResults();
            console.log(`PlaywrightPulseReporter: Shard ${this.shardIndex + 1} finished.`);
            return;
        }
        const runEndTime = Date.now();
        const duration = runEndTime - this.runStartTime;
        const runId = `run-${this.runStartTime}-${Math.random()
            .toString(16)
            .slice(2)}`;
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
        const finalRunStatus = ((_b = (_a = finalReport.run) === null || _a === void 0 ? void 0 : _a.failed) !== null && _b !== void 0 ? _b : 0 > 0) ? "failed" : "passed";
        console.log(`PlaywrightPulseReporter: Test run finished with overall status: ${finalRunStatus}`);
        console.log(`  Passed: ${(_c = finalReport.run) === null || _c === void 0 ? void 0 : _c.passed}, Failed: ${(_d = finalReport.run) === null || _d === void 0 ? void 0 : _d.failed}, Skipped: ${(_e = finalReport.run) === null || _e === void 0 ? void 0 : _e.skipped}`);
        console.log(`  Total tests: ${(_f = finalReport.run) === null || _f === void 0 ? void 0 : _f.totalTests}`);
        console.log(`  Total time: ${(duration / 1000).toFixed(2)}s`);
        const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);
        try {
            await this._ensureDirExists(this.outputDir);
            await fs.writeFile(finalOutputPath, JSON.stringify(finalReport, (key, value) => {
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
            if (this.isSharded) {
                await this._cleanupTemporaryFiles();
            }
        }
    }
}
exports.PlaywrightPulseReporter = PlaywrightPulseReporter;
// No module.exports needed for ES modules
