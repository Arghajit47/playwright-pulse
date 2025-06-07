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
const ua_parser_js_1 = require("ua-parser-js");
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
        this.options.outputDir = this.outputDir; // Ensure options has the resolved path
        const totalShards = this.config.shard ? this.config.shard.total : 1;
        this.isSharded = totalShards > 1;
        this.shardIndex = this.config.shard
            ? this.config.shard.current - 1
            : undefined;
        this._ensureDirExists(this.outputDir)
            .then(() => this._ensureDirExists(this.attachmentsDir)) // Also ensure attachmentsDir exists
            .then(() => {
            if (this.shardIndex === undefined || this.shardIndex === 0) {
                console.log(`PlaywrightPulseReporter: Starting test run with ${suite.allTests().length} tests${this.isSharded ? ` across ${totalShards} shards` : ""}. Pulse outputting to ${this.outputDir}`);
                if (this.shardIndex === undefined ||
                    (this.isSharded && this.shardIndex === 0)) {
                    return this._cleanupTemporaryFiles();
                }
            }
        })
            .catch((err) => console.error("Pulse Reporter: Error during initialization:", err));
    }
    onTestBegin(test) {
        // Optional: console.log(`Starting test: ${test.titlePath().join(' > ')} for project ${test.parent?.project()?.name}`);
    }
    async processStep(step, testId, browserName, // This will be the detailed browser info string
    testCase) {
        var _a, _b, _c, _d, _e;
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
        if ((_d = step.location) === null || _d === void 0 ? void 0 : _d.file) {
            // Check if file path exists
            codeLocation = `${path.relative(this.config.rootDir, step.location.file)}:${step.location.line}:${step.location.column}`;
        }
        let stepTitle = step.title;
        return {
            id: `${testId}_step_${startTime.toISOString()}-${duration}-${(0, crypto_1.randomUUID)()}`,
            title: stepTitle,
            status: stepStatus,
            duration: duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserName, // Store the detailed browser string for the step
            errorMessage: errorMessage,
            stackTrace: ((_e = step.error) === null || _e === void 0 ? void 0 : _e.stack) || undefined,
            codeLocation: codeLocation || undefined,
            isHook: step.category === "hook",
            hookType: step.category === "hook"
                ? step.title.toLowerCase().includes("before")
                    ? "before"
                    : "after"
                : undefined,
            steps: [], // Will be populated by recursive calls in onTestEnd
        };
    }
    getBrowserInfo(test) {
        var _a, _b, _c, _d;
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        const configuredBrowserType = (_c = (_b = project === null || project === void 0 ? void 0 : project.use) === null || _b === void 0 ? void 0 : _b.defaultBrowserType) === null || _c === void 0 ? void 0 : _c.toLowerCase();
        const userAgentString = (_d = project === null || project === void 0 ? void 0 : project.use) === null || _d === void 0 ? void 0 : _d.userAgent;
        // --- DEBUG LOGS (IMPORTANT! Check these in your console output) ---
        console.log(`[PulseReporter DEBUG] Project: ${(project === null || project === void 0 ? void 0 : project.name) || "N/A"}`);
        console.log(`[PulseReporter DEBUG] Configured Browser Type: "${configuredBrowserType}"`);
        console.log(`[PulseReporter DEBUG] User Agent String for UAParser: "${userAgentString}"`);
        // --- END DEBUG LOGS ---
        let parsedBrowserName;
        let parsedVersion;
        let parsedOsName;
        let parsedOsVersion;
        let deviceModel;
        let deviceType;
        if (userAgentString) {
            try {
                const parser = new ua_parser_js_1.UAParser(userAgentString);
                const uaResult = parser.getResult();
                // --- DEBUG LOGS (IMPORTANT! Check these in your console output) ---
                console.log("[PulseReporter DEBUG] UAParser Result:", JSON.stringify(uaResult, null, 2));
                // --- END DEBUG LOGS ---
                parsedBrowserName = uaResult.browser.name;
                parsedVersion = uaResult.browser.version;
                parsedOsName = uaResult.os.name;
                parsedOsVersion = uaResult.os.version;
                deviceModel = uaResult.device.model;
                deviceType = uaResult.device.type;
                if (deviceType === "mobile" || deviceType === "tablet") {
                    if (parsedOsName === null || parsedOsName === void 0 ? void 0 : parsedOsName.toLowerCase().includes("android")) {
                        if (parsedBrowserName === null || parsedBrowserName === void 0 ? void 0 : parsedBrowserName.toLowerCase().includes("chrome")) {
                            parsedBrowserName = "Chrome Mobile";
                        }
                        else if (parsedBrowserName === null || parsedBrowserName === void 0 ? void 0 : parsedBrowserName.toLowerCase().includes("firefox")) {
                            parsedBrowserName = "Firefox Mobile";
                        }
                        else if (uaResult.engine.name === "Blink" && !parsedBrowserName) {
                            parsedBrowserName = "Android WebView";
                        }
                        else if (parsedBrowserName) {
                            // Parsed name is likely okay
                        }
                        else {
                            parsedBrowserName = "Android Browser";
                        }
                    }
                    else if (parsedOsName === null || parsedOsName === void 0 ? void 0 : parsedOsName.toLowerCase().includes("ios")) {
                        parsedBrowserName = "Mobile Safari";
                    }
                }
                else if (parsedBrowserName === "Electron") {
                    parsedBrowserName = "Electron App";
                }
            }
            catch (error) {
                console.warn(`Pulse Reporter: Error parsing User-Agent string "${userAgentString}":`, error);
            }
        }
        let finalDisplayName;
        if (parsedBrowserName) {
            finalDisplayName = parsedBrowserName;
            if (parsedVersion) {
                finalDisplayName += ` v${parsedVersion.split(".")[0]}`;
            }
        }
        else if (configuredBrowserType && configuredBrowserType !== "unknown") {
            finalDisplayName =
                configuredBrowserType.charAt(0).toUpperCase() +
                    configuredBrowserType.slice(1);
        }
        else {
            finalDisplayName = "Unknown Browser";
        }
        if (parsedOsName) {
            finalDisplayName += ` on ${parsedOsName}`;
            if (parsedOsVersion) {
                finalDisplayName += ` ${parsedOsVersion.split(".")[0]}`;
            }
        }
        // Example: Append device model if it's a mobile/tablet and model exists
        // if ((deviceType === "mobile" || deviceType === "tablet") && deviceModel && !finalDisplayName.includes(deviceModel)) {
        //   finalDisplayName += ` (${deviceModel})`;
        // }
        return finalDisplayName.trim();
    }
    async onTestEnd(test, result) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        const browserDisplayInfo = this.getBrowserInfo(test);
        const testStatus = convertStatus(result.status, test);
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration);
        const testIdForFiles = test.id || // Playwright's internal unique ID for the test case
            `${test
                .titlePath()
                .join("_")
                .replace(/[^a-zA-Z0-9]/g, "_")}_${startTime.getTime()}`;
        const processAllSteps = async (steps) => {
            let processed = [];
            for (const step of steps) {
                const processedStep = await this.processStep(step, testIdForFiles, browserDisplayInfo, // Pass the detailed browser info string
                test);
                processed.push(processedStep);
                if (step.steps && step.steps.length > 0) {
                    processedStep.steps = await processAllSteps(step.steps); // Recursive call
                }
            }
            return processed;
        };
        let codeSnippet = undefined;
        try {
            if (((_b = test.location) === null || _b === void 0 ? void 0 : _b.file) &&
                ((_c = test.location) === null || _c === void 0 ? void 0 : _c.line) !== undefined &&
                ((_d = test.location) === null || _d === void 0 ? void 0 : _d.column) !== undefined) {
                const relativePath = path.relative(this.config.rootDir, test.location.file);
                codeSnippet = `Test defined at: ${relativePath}:${test.location.line}:${test.location.column}`;
            }
        }
        catch (e) {
            // console.warn(`Pulse Reporter: Could not extract code snippet for ${test.title}`, e);
        }
        const stdoutMessages = ((_e = result.stdout) === null || _e === void 0 ? void 0 : _e.map((item) => typeof item === "string" ? item : item.toString())) || [];
        const stderrMessages = ((_f = result.stderr) === null || _f === void 0 ? void 0 : _f.map((item) => typeof item === "string" ? item : item.toString())) || [];
        const uniqueTestId = test.id; // test.id is Playwright's unique ID for a test case instance
        const pulseResult = {
            id: uniqueTestId,
            runId: "TBD", // Will be set during final report generation
            name: test.titlePath().join(" > "),
            suiteName: (project === null || project === void 0 ? void 0 : project.name) || ((_g = this.config.projects[0]) === null || _g === void 0 ? void 0 : _g.name) || "Default Suite",
            status: testStatus,
            duration: result.duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserDisplayInfo, // Use the detailed browser string
            retries: result.retry,
            steps: ((_h = result.steps) === null || _h === void 0 ? void 0 : _h.length) ? await processAllSteps(result.steps) : [],
            errorMessage: (_j = result.error) === null || _j === void 0 ? void 0 : _j.message,
            stackTrace: (_k = result.error) === null || _k === void 0 ? void 0 : _k.stack,
            codeSnippet: codeSnippet,
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag),
            screenshots: [], // To be populated by attachFiles
            videoPath: undefined, // To be populated by attachFiles
            tracePath: undefined, // To be populated by attachFiles
            stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
            stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
        };
        try {
            // IMPORTANT: attachFiles logic
            (0, attachment_utils_1.attachFiles)(testIdForFiles, result, pulseResult, this.options);
        }
        catch (attachError) {
            console.error(`Pulse Reporter: Error processing attachments for test ${pulseResult.name} (ID: ${testIdForFiles}): ${attachError.message}`);
        }
        const existingTestIndex = this.results.findIndex((r) => r.id === uniqueTestId);
        if (existingTestIndex !== -1) {
            if (pulseResult.retries >= this.results[existingTestIndex].retries) {
                this.results[existingTestIndex] = pulseResult;
            }
        }
        else {
            this.results.push(pulseResult);
        }
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
    async _mergeShardResults(finalRunData // Pass the TestRun object to populate
    ) {
        var _a, _b;
        let allShardProcessedResults = [];
        const totalShards = (_b = (_a = this.config.shard) === null || _a === void 0 ? void 0 : _a.total) !== null && _b !== void 0 ? _b : 1;
        for (let i = 0; i < totalShards; i++) {
            const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${i}.json`);
            try {
                const content = await fs.readFile(tempFilePath, "utf-8");
                const shardResults = JSON.parse(content); // Dates are already ISO strings
                allShardProcessedResults.push(...shardResults);
            }
            catch (error) {
                if ((error === null || error === void 0 ? void 0 : error.code) === "ENOENT") {
                    // console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}.`);
                }
                else {
                    console.error(`Pulse Reporter: Could not read/parse results from shard ${i} (${tempFilePath}). Error:`, error);
                }
            }
        }
        const finalUniqueResultsMap = new Map();
        for (const result of allShardProcessedResults) {
            const existing = finalUniqueResultsMap.get(result.id);
            if (!existing || result.retries >= existing.retries) {
                finalUniqueResultsMap.set(result.id, result);
            }
        }
        const finalResultsList = Array.from(finalUniqueResultsMap.values());
        finalResultsList.forEach((r) => (r.runId = finalRunData.id)); // Assign runId to each test result
        // Update the passed finalRunData object with aggregated stats
        finalRunData.passed = finalResultsList.filter((r) => r.status === "passed").length;
        finalRunData.failed = finalResultsList.filter((r) => r.status === "failed").length;
        finalRunData.skipped = finalResultsList.filter((r) => r.status === "skipped").length;
        finalRunData.totalTests = finalResultsList.length;
        return {
            run: finalRunData, // Contains Date object for timestamp
            results: finalResultsList, // Contains ISO strings for dates from shards
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
                // console.warn("Pulse Reporter: Warning during cleanup of temporary files:", error.message);
            }
        }
    }
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
        var _a, _b;
        if (this.shardIndex !== undefined) {
            await this._writeShardResults();
            return;
        }
        const runEndTime = Date.now();
        const duration = runEndTime - this.runStartTime;
        const runId = `run-${this.runStartTime}-${(0, crypto_1.randomUUID)()}`;
        const runData = {
            // This is the single source of truth for current run's data
            id: runId,
            timestamp: new Date(this.runStartTime), // Stored as Date object
            totalTests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration,
        };
        let finalReport;
        if (this.isSharded) {
            // _mergeShardResults will populate the runData object passed to it
            finalReport = await this._mergeShardResults(runData);
        }
        else {
            this.results.forEach((r) => (r.runId = runId));
            runData.passed = this.results.filter((r) => r.status === "passed").length;
            runData.failed = this.results.filter((r) => r.status === "failed").length;
            runData.skipped = this.results.filter((r) => r.status === "skipped").length;
            runData.totalTests = this.results.length;
            finalReport = {
                run: runData, // runData contains a Date object for timestamp
                results: this.results, // results contain Date objects for startTime, endTime
                metadata: { generatedAt: new Date().toISOString() },
            };
        }
        // This check should be robust now
        if (!finalReport ||
            !finalReport.run ||
            typeof finalReport.run.totalTests !== "number") {
            console.error("PlaywrightPulseReporter: CRITICAL - finalReport object or its run data was malformed. Cannot create summary.");
            const errorReportMinimal = {
                run: {
                    id: runId,
                    timestamp: new Date(this.runStartTime),
                    totalTests: 0,
                    passed: 0,
                    failed: 0,
                    skipped: 0,
                    duration,
                },
                results: [],
                metadata: {
                    generatedAt: new Date().toISOString(),
                },
            };
            try {
                const errorPath = path.join(this.outputDir, this.baseOutputFile);
                await this._ensureDirExists(this.outputDir);
                // Stringify with Date conversion for the minimal error report
                await fs.writeFile(errorPath, JSON.stringify(errorReportMinimal, (key, value) => value instanceof Date ? value.toISOString() : value, 2));
                console.warn(`PlaywrightPulseReporter: Wrote a minimal error report to ${errorPath}.`);
            }
            catch (e) {
                console.error("PlaywrightPulseReporter: Failed to write minimal error report.", e);
            }
            return;
        }
        // At this point, finalReport.run is guaranteed to be populated by either _mergeShardResults or the non-sharded path.
        const reportRunData = finalReport.run;
        const finalRunStatus = ((_a = reportRunData.failed) !== null && _a !== void 0 ? _a : 0) > 0
            ? "failed"
            : ((_b = reportRunData.totalTests) !== null && _b !== void 0 ? _b : 0) === 0 && result.status !== "passed"
                ? result.status === "interrupted"
                    ? "interrupted"
                    : "no tests or error"
                : "passed";
        const summary = `
PlaywrightPulseReporter: Run Finished
-----------------------------------------
  Overall Status: ${finalRunStatus.toUpperCase()}
  Total Tests:    ${reportRunData.totalTests}
  Passed:         ${reportRunData.passed}
  Failed:         ${reportRunData.failed}
  Skipped:        ${reportRunData.skipped}
  Duration:       ${(reportRunData.duration / 1000).toFixed(2)}s 
-----------------------------------------`;
        if (this.printsToStdio()) {
            console.log(summary);
        }
        const finalOutputPath = path.join(this.outputDir, this.baseOutputFile);
        try {
            await this._ensureDirExists(this.outputDir);
            // Custom replacer for JSON.stringify to handle Date objects correctly
            await fs.writeFile(finalOutputPath, JSON.stringify(finalReport, (key, value) => {
                if (value instanceof Date) {
                    return value.toISOString();
                }
                return value;
            }, 2));
            if (this.printsToStdio()) {
                console.log(`PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`);
            }
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
