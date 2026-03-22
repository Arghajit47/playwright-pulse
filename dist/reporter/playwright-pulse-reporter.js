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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightPulseReporter = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const ua_parser_js_1 = __importDefault(require("ua-parser-js"));
const os = __importStar(require("os"));
const compression_utils_1 = require("../utils/compression-utils");
const convertStatus = (status, testCase) => {
    if ((testCase === null || testCase === void 0 ? void 0 : testCase.expectedStatus) === "failed") {
        return "failed";
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
        var _a, _b, _c, _d;
        this.results = [];
        this._pendingTestEnds = [];
        this.baseOutputFile = "playwright-pulse-report.json";
        this.individualReportsSubDir = "pulse-results";
        this.isSharded = false;
        this.shardIndex = undefined;
        this.options = options;
        this.baseOutputFile = (_a = options.outputFile) !== null && _a !== void 0 ? _a : this.baseOutputFile;
        this.outputDir = (_b = options.outputDir) !== null && _b !== void 0 ? _b : "pulse-report";
        this.individualReportsSubDir = (_c = options.individualReportsSubDir) !== null && _c !== void 0 ? _c : "pulse-results";
        this.attachmentsDir = path.join(this.outputDir, ATTACHMENTS_SUBDIR);
        this.resetOnEachRun = (_d = options.resetOnEachRun) !== null && _d !== void 0 ? _d : true;
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
            .then(async () => {
            if (this.printsToStdio()) {
                console.log(`PlaywrightPulseReporter: Starting test run with ${suite.allTests().length} tests${this.isSharded ? ` across ${totalShards} shards` : ""}. Pulse outputting to ${this.outputDir}`);
                if (this.shardIndex === undefined ||
                    (this.isSharded && this.shardIndex === 0)) {
                    await this._cleanupTemporaryFiles();
                }
            }
        })
            .catch((err) => console.error("Pulse Reporter: Error during initialization:", err));
    }
    onTestBegin(test) {
        console.log(`Starting test: ${test.title}`);
    }
    _getSeverity(annotations) {
        const severityAnnotation = annotations.find((a) => a.type === "pulse_severity");
        return (severityAnnotation === null || severityAnnotation === void 0 ? void 0 : severityAnnotation.description) || "Medium";
    }
    extractCodeSnippet(filePath, targetLine, targetColumn) {
        var _a;
        try {
            const fsSync = require("fs");
            if (!fsSync.existsSync(filePath)) {
                return "";
            }
            const content = fsSync.readFileSync(filePath, "utf8");
            const lines = content.split("\n");
            if (targetLine < 1 || targetLine > lines.length) {
                return "";
            }
            return ((_a = lines[targetLine - 1]) === null || _a === void 0 ? void 0 : _a.trim()) || "";
        }
        catch (e) {
            return "";
        }
    }
    getBrowserDetails(test) {
        var _a, _b, _c, _d;
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        const projectConfig = project === null || project === void 0 ? void 0 : project.use;
        const userAgent = projectConfig === null || projectConfig === void 0 ? void 0 : projectConfig.userAgent;
        const configuredBrowserType = (_b = projectConfig === null || projectConfig === void 0 ? void 0 : projectConfig.browserName) === null || _b === void 0 ? void 0 : _b.toLowerCase();
        const parser = new ua_parser_js_1.default(userAgent);
        const result = parser.getResult();
        let browserName = result.browser.name;
        const browserVersion = result.browser.version
            ? ` v${result.browser.version.split(".")[0]}`
            : "";
        const osName = result.os.name ? ` on ${result.os.name}` : "";
        const osVersion = result.os.version
            ? ` ${result.os.version.split(".")[0]}`
            : "";
        const deviceType = result.device.type;
        let finalString;
        if (browserName === undefined) {
            browserName = configuredBrowserType;
            finalString = `${browserName}`;
        }
        else {
            if (deviceType === "mobile" || deviceType === "tablet") {
                if ((_c = result.os.name) === null || _c === void 0 ? void 0 : _c.toLowerCase().includes("android")) {
                    if (browserName.toLowerCase().includes("chrome"))
                        browserName = "Chrome Mobile";
                    else if (browserName.toLowerCase().includes("firefox"))
                        browserName = "Firefox Mobile";
                    else if (result.engine.name === "Blink" && !result.browser.name)
                        browserName = "Android WebView";
                    else if (browserName &&
                        !browserName.toLowerCase().includes("mobile")) {
                        // Keep it as is
                    }
                    else {
                        browserName = "Android Browser";
                    }
                }
                else if ((_d = result.os.name) === null || _d === void 0 ? void 0 : _d.toLowerCase().includes("ios")) {
                    browserName = "Mobile Safari";
                }
            }
            else if (browserName === "Electron") {
                browserName = "Electron App";
            }
            finalString = `${browserName}${browserVersion}${osName}${osVersion}`;
        }
        return finalString.trim();
    }
    async processStep(step, testId, browserDetails, testCase) {
        var _a, _b, _c, _d;
        let stepStatus = "passed";
        let errorMessage = ((_a = step.error) === null || _a === void 0 ? void 0 : _a.message) || undefined;
        if ((_c = (_b = step.error) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.startsWith("Test is skipped:")) {
            stepStatus = "skipped";
        }
        else {
            stepStatus = convertStatus(step.error ? "failed" : "passed", testCase);
        }
        const duration = step.duration;
        const startTime = new Date(step.startTime);
        const endTime = new Date(startTime.getTime() + Math.max(0, duration));
        let codeLocation = "";
        let codeSnippet = "";
        if (step.location) {
            codeLocation = `${path.relative(this.config.rootDir, step.location.file)}:${step.location.line}:${step.location.column}`;
            codeSnippet = this.extractCodeSnippet(step.location.file, step.location.line, step.location.column);
        }
        return {
            id: `${testId}_step_${startTime.toISOString()}-${duration}-${(0, crypto_1.randomUUID)()}`,
            title: step.title,
            status: stepStatus,
            duration: duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserDetails,
            errorMessage: errorMessage,
            stackTrace: ((_d = step.error) === null || _d === void 0 ? void 0 : _d.stack) || undefined,
            codeLocation: codeLocation || undefined,
            codeSnippet: codeSnippet,
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
        // Track this async call so onEnd() can wait for all in-flight processing
        // before it reads this.results. This prevents the race condition where
        // onEnd() fires before an interrupted test's onTestEnd() has finished
        // its async attachment I/O and pushed to this.results.
        const p = this._processTestEnd(test, result);
        this._pendingTestEnds.push(p);
        await p;
    }
    async _processTestEnd(test, result) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        const browserDetails = this.getBrowserDetails(test);
        const uniqueTestId = `${(project === null || project === void 0 ? void 0 : project.name) || "default"}-${test.id}`;
        // Captured outcome from Playwright
        const outcome = test.outcome();
        // Calculate final status based on the last result (Last-Run-Wins)
        // result.status in onTestEnd is typically the status of the test run (passed if flaky passed)
        // But we double check the last result in test.results just to be sure/consistent
        const lastResult = test.results[test.results.length - 1];
        const finalStatus = convertStatus(lastResult ? lastResult.status : result.status, test);
        // Existing behavior: fail if flaky (implied by user request "existing status field should remain failed")
        // If outcome is flaky, status should be 'failed' to indicate initial failure, but final_status is 'passed'
        let testStatus = finalStatus;
        if (outcome === "flaky") {
            testStatus = "flaky";
        }
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration);
        const processAllSteps = async (steps) => {
            let processed = [];
            for (const step of steps) {
                const processedStep = await this.processStep(step, uniqueTestId, browserDetails, test);
                processed.push(processedStep);
                if (step.steps && step.steps.length > 0) {
                    processedStep.steps = await processAllSteps(step.steps);
                }
            }
            return processed;
        };
        let codeSnippet = "";
        if (((_b = test.location) === null || _b === void 0 ? void 0 : _b.file) && ((_c = test.location) === null || _c === void 0 ? void 0 : _c.line) && ((_d = test.location) === null || _d === void 0 ? void 0 : _d.column)) {
            codeSnippet = this.extractCodeSnippet(test.location.file, test.location.line, test.location.column);
        }
        // 1. Get Spec File Name
        const specFileName = ((_e = test.location) === null || _e === void 0 ? void 0 : _e.file)
            ? path.basename(test.location.file)
            : "n/a";
        // 2. Get Describe Block Name
        // Check if the immediate parent is a 'describe' block
        let describeBlockName = "n/a";
        if (((_f = test.parent) === null || _f === void 0 ? void 0 : _f.type) === "describe") {
            describeBlockName = test.parent.title;
        }
        const stdoutMessages = result.stdout.map((item) => typeof item === "string" ? item : item.toString());
        const stderrMessages = result.stderr.map((item) => typeof item === "string" ? item : item.toString());
        const maxWorkers = this.config.workers;
        let mappedWorkerId = result.workerIndex === -1
            ? -1
            : (result.workerIndex % (maxWorkers > 0 ? maxWorkers : 1)) + 1;
        const testSpecificData = {
            workerId: mappedWorkerId,
            totalWorkers: maxWorkers,
            configFile: this.config.configFile,
            metadata: this.config.metadata
                ? JSON.stringify(this.config.metadata)
                : undefined,
        };
        const pulseResult = {
            id: uniqueTestId,
            runId: "TBD",
            describe: describeBlockName,
            spec_file: specFileName,
            name: test.titlePath().join(" > "),
            suiteName: (project === null || project === void 0 ? void 0 : project.name) || ((_g = this.config.projects[0]) === null || _g === void 0 ? void 0 : _g.name) || "Default Suite",
            status: testStatus,
            outcome: outcome === "flaky" ? outcome : undefined, // Only Include if flaky
            final_status: finalStatus, // New Field
            duration: result.duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserDetails,
            retries: result.retry,
            steps: result.steps ? await processAllSteps(result.steps) : [],
            errorMessage: (_h = result.error) === null || _h === void 0 ? void 0 : _h.message,
            stackTrace: (_j = result.error) === null || _j === void 0 ? void 0 : _j.stack,
            snippet: (_k = result.error) === null || _k === void 0 ? void 0 : _k.snippet,
            codeSnippet: codeSnippet,
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag),
            severity: this._getSeverity(test.annotations),
            screenshots: [],
            videoPath: [],
            tracePath: undefined,
            attachments: [],
            stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
            stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
            annotations: ((_l = test.annotations) === null || _l === void 0 ? void 0 : _l.length) > 0 ? test.annotations : undefined,
            ...testSpecificData,
        };
        for (const [index, attachment] of result.attachments.entries()) {
            if (!attachment.path)
                continue;
            try {
                const testSubfolder = uniqueTestId.replace(/[^a-zA-Z0-9_-]/g, "_");
                const safeAttachmentName = path
                    .basename(attachment.path)
                    .replace(/[^a-zA-Z0-9_.-]/g, "_");
                const uniqueFileName = `${index}-${Date.now()}-${safeAttachmentName}`;
                const relativeDestPath = path.join(ATTACHMENTS_SUBDIR, testSubfolder, uniqueFileName);
                const absoluteDestPath = path.join(this.outputDir, relativeDestPath);
                await this._ensureDirExists(path.dirname(absoluteDestPath));
                // Copy file first
                await fs.copyFile(attachment.path, absoluteDestPath);
                // Compress in-place (preserves path/name)
                await (0, compression_utils_1.compressAttachment)(absoluteDestPath, attachment.contentType);
                if (attachment.contentType.startsWith("image/")) {
                    (_m = pulseResult.screenshots) === null || _m === void 0 ? void 0 : _m.push(relativeDestPath);
                }
                else if (attachment.contentType.startsWith("video/")) {
                    (_o = pulseResult.videoPath) === null || _o === void 0 ? void 0 : _o.push(relativeDestPath);
                }
                else if (attachment.name === "trace") {
                    pulseResult.tracePath = relativeDestPath;
                }
                else {
                    (_p = pulseResult.attachments) === null || _p === void 0 ? void 0 : _p.push({
                        name: attachment.name,
                        path: relativeDestPath,
                        contentType: attachment.contentType,
                    });
                }
            }
            catch (err) {
                console.error(`Pulse Reporter: Failed to process attachment "${attachment.name}" for test ${pulseResult.name}. Error: ${err.message}`);
            }
        }
        this.results.push(pulseResult);
    }
    _getFinalizedResults(allResults) {
        const resultsMap = new Map();
        for (const result of allResults) {
            if (!resultsMap.has(result.id)) {
                resultsMap.set(result.id, []);
            }
            resultsMap.get(result.id).push(result);
        }
        const finalResults = [];
        for (const [testId, attempts] of resultsMap.entries()) {
            // Sort by retry count (ASC) then timestamp (DESC) to ensure stable resolution
            attempts.sort((a, b) => {
                if (a.retries !== b.retries)
                    return a.retries - b.retries;
                return (new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
            });
            const firstAttempt = attempts[0];
            const retryAttempts = attempts.slice(1);
            // Only populate retryHistory if there were actual failures that triggered retries
            // If all attempts passed, we don't need to show retry history
            const hasActualRetries = retryAttempts.length > 0 &&
                retryAttempts.some((attempt) => attempt.status === "failed" ||
                    attempt.status === "flaky" ||
                    firstAttempt.status === "failed" ||
                    firstAttempt.status === "flaky");
            if (hasActualRetries) {
                firstAttempt.retryHistory = retryAttempts;
                // Calculate final status and outcome from the last attempt if retries exist
                const lastAttempt = attempts[attempts.length - 1];
                firstAttempt.final_status = lastAttempt.status;
                // If the last attempt was flaky, ensure outcome is set on the main result
                if (lastAttempt.outcome === "flaky" || lastAttempt.status === "flaky") {
                    firstAttempt.outcome = "flaky";
                    firstAttempt.status = "flaky";
                }
            }
            else {
                // If no actual retries (all attempts passed), ensure final_status and retryHistory are removed
                delete firstAttempt.final_status;
                delete firstAttempt.retryHistory;
            }
            finalResults.push(firstAttempt);
        }
        return finalResults;
    }
    onError(error) {
        var _a;
        console.error(`PlaywrightPulseReporter: Error encountered (Shard: ${(_a = this.shardIndex) !== null && _a !== void 0 ? _a : "Main"}):`, (error === null || error === void 0 ? void 0 : error.message) || error);
        if (error === null || error === void 0 ? void 0 : error.stack) {
            console.error(error.stack);
        }
    }
    _getEnvDetails() {
        return {
            host: os.hostname(),
            os: `${os.platform()} ${os.release()}`,
            cpu: {
                model: os.cpus()[0] ? os.cpus()[0].model : "N/A",
                cores: os.cpus().length,
            },
            memory: `${(os.totalmem() / 1024 ** 3).toFixed(2)}GB`,
            node: process.version,
            v8: process.versions.v8,
            cwd: process.cwd(),
        };
    }
    async _writeShardResults() {
        if (this.shardIndex === undefined) {
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
        let allShardProcessedResults = [];
        const totalShards = this.config.shard ? this.config.shard.total : 1;
        for (let i = 0; i < totalShards; i++) {
            const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${i}.json`);
            try {
                const content = await fs.readFile(tempFilePath, "utf-8");
                const shardResults = JSON.parse(content);
                allShardProcessedResults =
                    allShardProcessedResults.concat(shardResults);
            }
            catch (error) {
                if ((error === null || error === void 0 ? void 0 : error.code) === "ENOENT") {
                    console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}. This might be normal if a shard had no tests or failed early.`);
                }
                else {
                    console.error(`Pulse Reporter: Could not read/parse results from shard ${i} (${tempFilePath}). Error:`, error);
                }
            }
        }
        const finalResultsList = this._getFinalizedResults(allShardProcessedResults);
        finalResultsList.forEach((r) => (r.runId = finalRunData.id));
        finalRunData.passed = finalResultsList.filter((r) => (r.final_status || r.status) === "passed").length;
        finalRunData.failed = finalResultsList.filter((r) => (r.final_status || r.status) === "failed").length;
        finalRunData.skipped = finalResultsList.filter((r) => (r.final_status || r.status) === "skipped").length;
        finalRunData.flaky = finalResultsList.filter((r) => (r.final_status || r.status) === "flaky").length;
        finalRunData.totalTests = finalResultsList.length;
        const reviveDates = (key, value) => {
            const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
            if (typeof value === "string" && isoDateRegex.test(value)) {
                const date = new Date(value);
                return !isNaN(date.getTime()) ? date : value;
            }
            return value;
        };
        const properlyTypedResults = JSON.parse(JSON.stringify(finalResultsList), reviveDates);
        return {
            run: finalRunData,
            results: properlyTypedResults,
            metadata: {
                generatedAt: new Date().toISOString(),
                reportDescription: this.options.reportDescription,
                logo: this.options.logo,
            },
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
                console.warn("Pulse Reporter: Warning during cleanup of temporary files:", error.message);
            }
        }
    }
    /**
     * Removes all individual run JSON files from the `pulse-results/` directory
     * that were left over from previous test sessions.
     *
     * When `resetOnEachRun: false`, each run writes its own timestamped JSON to
     * `pulse-results/` and then `_mergeAllRunReports()` merges them all. However,
     * if files from *older* sessions accumulate there (e.g. because a previous run
     * was interrupted before the post-merge cleanup, or because the user ran tests
     * on a previous day), `_getFinalizedResults()` de-duplicates by `test.id` and
     * collapses results from both sessions into a single entry — producing a
     * `totalTests` count lower than the actual number of tests that ran.
     *
     * Cleaning up at `onBegin` time guarantees each run starts with a fresh slate.
     */
    async _ensureDirExists(dirPath) {
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
        // Wait for ALL in-flight onTestEnd calls to finish before reading this.results.
        // This guards against Playwright calling onEnd() concurrently with (or just
        // before) the last onTestEnd() finishing its async attachment I/O — which
        // would cause that test to be silently dropped from the report.
        await Promise.allSettled(this._pendingTestEnds);
        if (this.shardIndex !== undefined) {
            await this._writeShardResults();
            return;
        }
        // De-duplicate and handle retries here, in a safe, single-threaded context.
        const finalResults = this._getFinalizedResults(this.results);
        const runEndTime = Date.now();
        const duration = runEndTime - this.runStartTime;
        const runId = `run-${this.runStartTime}-581d5ad8-ce75-4ca5-94a6-ed29c466c815`;
        const environmentDetails = this._getEnvDetails();
        const runData = {
            id: runId,
            timestamp: new Date(this.runStartTime),
            // Use the length of the de-duplicated array for all counts
            totalTests: finalResults.length,
            passed: finalResults.filter((r) => (r.final_status || r.status) === "passed").length,
            failed: finalResults.filter((r) => (r.final_status || r.status) === "failed").length,
            skipped: finalResults.filter((r) => (r.final_status || r.status) === "skipped").length,
            flaky: finalResults.filter((r) => (r.final_status || r.status) === "flaky").length,
            duration,
            environment: environmentDetails,
        };
        finalResults.forEach((r) => (r.runId = runId));
        let finalReport = undefined;
        if (this.isSharded) {
            // The _mergeShardResults method will handle its own de-duplication
            finalReport = await this._mergeShardResults(runData);
        }
        else {
            finalReport = {
                run: runData,
                // Use the de-duplicated results
                results: finalResults,
                metadata: {
                    generatedAt: new Date().toISOString(),
                    reportDescription: this.options.reportDescription,
                    logo: this.options.logo,
                },
            };
        }
        if (!finalReport) {
            console.error("PlaywrightPulseReporter: CRITICAL - finalReport object was not generated. Cannot create summary.");
            return;
        }
        const jsonReplacer = (key, value) => {
            if (value instanceof Date)
                return value.toISOString();
            if (typeof value === "bigint")
                return value.toString();
            return value;
        };
        if (this.resetOnEachRun) {
            const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);
            try {
                await this._ensureDirExists(this.outputDir);
                await fs.writeFile(finalOutputPath, JSON.stringify(finalReport, jsonReplacer, 2));
                if (this.printsToStdio()) {
                    console.log(`PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`);
                }
            }
            catch (error) {
                console.error(`Pulse Reporter: Failed to write final JSON report to ${finalOutputPath}. Error: ${error.message}`);
            }
        }
        else {
            // Logic for appending/merging reports
            const pulseResultsDir = path.join(this.outputDir, this.individualReportsSubDir);
            const shardPrefix = this.baseOutputFile.replace(".json", "-");
            const individualReportPath = path.join(pulseResultsDir, `${shardPrefix}${Date.now()}.json`);
            try {
                await this._ensureDirExists(pulseResultsDir);
                await fs.writeFile(individualReportPath, JSON.stringify(finalReport, jsonReplacer, 2));
                if (this.printsToStdio()) {
                    console.log(`PlaywrightPulseReporter: Individual run report for merging written to ${individualReportPath}`);
                }
                // DEFERRED MERGING: 
                // We do not call _mergeAllRunReports() here anymore when resetOnEachRun is false.
                // The individual JSON files in pulse-results/ will be collected and merged
                // into the main JSON when the user next runs one of the report generator commands.
            }
            catch (error) {
                console.error(`Pulse Reporter: Failed to write report. Error: ${error.message}`);
            }
        }
        if (this.isSharded) {
            await this._cleanupTemporaryFiles();
        }
    }
}
exports.PlaywrightPulseReporter = PlaywrightPulseReporter;
exports.default = PlaywrightPulseReporter;
