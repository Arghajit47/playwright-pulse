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
const crypto_1 = require("crypto");
const ua_parser_js_1 = require("ua-parser-js");
const os = __importStar(require("os"));
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
        this.options.outputDir = this.outputDir;
        const totalShards = this.config.shard ? this.config.shard.total : 1;
        this.isSharded = totalShards > 1;
        this.shardIndex = this.config.shard
            ? this.config.shard.current - 1
            : undefined;
        this._ensureDirExists(this.outputDir)
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
        console.log(`Starting test: ${test.title}`);
    }
    getBrowserDetails(test) {
        var _a, _b, _c, _d;
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        const projectConfig = project === null || project === void 0 ? void 0 : project.use;
        const userAgent = projectConfig === null || projectConfig === void 0 ? void 0 : projectConfig.userAgent;
        const configuredBrowserType = (_b = projectConfig === null || projectConfig === void 0 ? void 0 : projectConfig.browserName) === null || _b === void 0 ? void 0 : _b.toLowerCase();
        const parser = new ua_parser_js_1.UAParser(userAgent);
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
        if (step.location) {
            codeLocation = `${path.relative(this.config.rootDir, step.location.file)}:${step.location.line}:${step.location.column}`;
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        const browserDetails = this.getBrowserDetails(test);
        const testStatus = convertStatus(result.status, test);
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration);
        const processAllSteps = async (steps) => {
            let processed = [];
            for (const step of steps) {
                const processedStep = await this.processStep(step, test.id, browserDetails, test);
                processed.push(processedStep);
                if (step.steps && step.steps.length > 0) {
                    processedStep.steps = await processAllSteps(step.steps);
                }
            }
            return processed;
        };
        let codeSnippet = undefined;
        try {
            if (((_b = test.location) === null || _b === void 0 ? void 0 : _b.file) && ((_c = test.location) === null || _c === void 0 ? void 0 : _c.line) && ((_d = test.location) === null || _d === void 0 ? void 0 : _d.column)) {
                const relativePath = path.relative(this.config.rootDir, test.location.file);
                codeSnippet = `Test defined at: ${relativePath}:${test.location.line}:${test.location.column}`;
            }
        }
        catch (e) {
            console.warn(`Pulse Reporter: Could not extract code snippet for ${test.title}`, e);
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
            id: test.id,
            runId: "TBD",
            name: test.titlePath().join(" > "),
            suiteName: (project === null || project === void 0 ? void 0 : project.name) || ((_e = this.config.projects[0]) === null || _e === void 0 ? void 0 : _e.name) || "Default Suite",
            status: testStatus,
            duration: result.duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserDetails,
            retries: result.retry,
            steps: ((_f = result.steps) === null || _f === void 0 ? void 0 : _f.length) ? await processAllSteps(result.steps) : [],
            errorMessage: (_g = result.error) === null || _g === void 0 ? void 0 : _g.message,
            stackTrace: (_h = result.error) === null || _h === void 0 ? void 0 : _h.stack,
            codeSnippet: codeSnippet,
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag),
            screenshots: [],
            videoPath: [],
            tracePath: undefined,
            attachments: [],
            stdout: stdoutMessages.length > 0 ? stdoutMessages : undefined,
            stderr: stderrMessages.length > 0 ? stderrMessages : undefined,
            ...testSpecificData,
        };
        // --- CORRECTED ATTACHMENT PROCESSING LOGIC ---
        for (const [index, attachment] of result.attachments.entries()) {
            if (!attachment.path)
                continue;
            try {
                // Create a sanitized, unique folder name for this specific test
                const testSubfolder = test.id.replace(/[^a-zA-Z0-9_-]/g, "_");
                // Sanitize the original attachment name to create a safe filename
                const safeAttachmentName = path
                    .basename(attachment.path)
                    .replace(/[^a-zA-Z0-9_.-]/g, "_");
                // Create a unique filename to prevent collisions, especially in retries
                const uniqueFileName = `${index}-${Date.now()}-${safeAttachmentName}`;
                // This is the relative path that will be stored in the JSON report
                const relativeDestPath = path.join(ATTACHMENTS_SUBDIR, testSubfolder, uniqueFileName);
                // This is the absolute path used for the actual file system operation
                const absoluteDestPath = path.join(this.outputDir, relativeDestPath);
                // Ensure the unique, test-specific attachment directory exists
                await this._ensureDirExists(path.dirname(absoluteDestPath));
                await fs.copyFile(attachment.path, absoluteDestPath);
                // Categorize the attachment based on its content type
                if (attachment.contentType.startsWith("image/")) {
                    (_j = pulseResult.screenshots) === null || _j === void 0 ? void 0 : _j.push(relativeDestPath);
                }
                else if (attachment.contentType.startsWith("video/")) {
                    (_k = pulseResult.videoPath) === null || _k === void 0 ? void 0 : _k.push(relativeDestPath);
                }
                else if (attachment.name === "trace") {
                    pulseResult.tracePath = relativeDestPath;
                }
                else {
                    (_l = pulseResult.attachments) === null || _l === void 0 ? void 0 : _l.push({
                        name: attachment.name, // The original, human-readable name
                        path: relativeDestPath, // The safe, relative path for linking
                        contentType: attachment.contentType,
                    });
                }
            }
            catch (err) {
                console.error(`Pulse Reporter: Failed to process attachment "${attachment.name}" for test ${pulseResult.name}. Error: ${err.message}`);
            }
        }
        const existingTestIndex = this.results.findIndex((r) => r.id === test.id);
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
        let finalUniqueResultsMap = new Map();
        for (const result of allShardProcessedResults) {
            const existing = finalUniqueResultsMap.get(result.id);
            if (!existing || result.retries >= existing.retries) {
                finalUniqueResultsMap.set(result.id, result);
            }
        }
        const finalResultsList = Array.from(finalUniqueResultsMap.values());
        finalResultsList.forEach((r) => (r.runId = finalRunData.id));
        finalRunData.passed = finalResultsList.filter((r) => r.status === "passed").length;
        finalRunData.failed = finalResultsList.filter((r) => r.status === "failed").length;
        finalRunData.skipped = finalResultsList.filter((r) => r.status === "skipped").length;
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
                console.warn("Pulse Reporter: Warning during cleanup of temporary files:", error.message);
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
        if (this.shardIndex !== undefined) {
            await this._writeShardResults();
            return;
        }
        const runEndTime = Date.now();
        const duration = runEndTime - this.runStartTime;
        const runId = `run-${this.runStartTime}-581d5ad8-ce75-4ca5-94a6-ed29c466c815`;
        const environmentDetails = this._getEnvDetails();
        const runData = {
            id: runId,
            timestamp: new Date(this.runStartTime),
            totalTests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration,
            environment: environmentDetails,
        };
        let finalReport = undefined;
        if (this.isSharded) {
            finalReport = await this._mergeShardResults(runData);
            if (finalReport && finalReport.run && !finalReport.run.environment) {
                finalReport.run.environment = environmentDetails;
            }
        }
        else {
            this.results.forEach((r) => (r.runId = runId));
            runData.passed = this.results.filter((r) => r.status === "passed").length;
            runData.failed = this.results.filter((r) => r.status === "failed").length;
            runData.skipped = this.results.filter((r) => r.status === "skipped").length;
            runData.totalTests = this.results.length;
            const reviveDates = (key, value) => {
                const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
                if (typeof value === "string" && isoDateRegex.test(value)) {
                    const date = new Date(value);
                    return !isNaN(date.getTime()) ? date : value;
                }
                return value;
            };
            const properlyTypedResults = JSON.parse(JSON.stringify(this.results), reviveDates);
            finalReport = {
                run: runData,
                results: properlyTypedResults,
                metadata: { generatedAt: new Date().toISOString() },
            };
        }
        if (!finalReport) {
            console.error("PlaywrightPulseReporter: CRITICAL - finalReport object was not generated. Cannot create summary.");
            return;
        }
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
