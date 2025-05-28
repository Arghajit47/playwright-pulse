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
const attachment_utils_1 = require("./attachment-utils"); // Use relative path
const XLSX = __importStar(require("xlsx"));
class ExcelTrendManager {
    constructor(outputDir) {
        this.maxRuns = 5;
        this.excelFilePath = path.join(outputDir, "trend.xls");
    }
    // Add this public getter method
    getExcelFilePath() {
        return this.excelFilePath;
    }
    async readExistingData() {
        try {
            await fs.access(this.excelFilePath);
            const buffer = await fs.readFile(this.excelFilePath);
            return XLSX.read(buffer);
        }
        catch (_a) {
            return null;
        }
    }
    shiftRuns(data) {
        if (data.length >= this.maxRuns) {
            data.shift();
        }
        return data;
    }
    async updateTrendData(runId, timestamp, results, duration) {
        let workbook = await this.readExistingData();
        // Initialize workbook if it doesn't exist or is empty
        if (!workbook) {
            workbook = XLSX.utils.book_new();
            // Create initial sheets with empty data
            const overallSheet = XLSX.utils.json_to_sheet([]);
            XLSX.utils.book_append_sheet(workbook, overallSheet, "overall");
        }
        // Ensure the workbook has at least the "overall" sheet
        if (!workbook.Sheets["overall"]) {
            const overallSheet = XLSX.utils.json_to_sheet([]);
            XLSX.utils.book_append_sheet(workbook, overallSheet, "overall");
        }
        // Prepare "overall" data
        const existingOverallData = workbook.Sheets["overall"]
            ? XLSX.utils.sheet_to_json(workbook.Sheets["overall"])
            : [];
        const newOverallRow = {
            RUN_ID: runId,
            DURATION: duration,
            TIMESTAMP: timestamp,
            TOTAL_TESTS: results.length,
            PASSED: results.filter((r) => r.status === "passed").length,
            FAILED: results.filter((r) => r.status === "failed").length,
            SKIPPED: results.filter((r) => r.status === "skipped").length,
        };
        const updatedOverallData = this.shiftRuns([
            ...existingOverallData,
            newOverallRow,
        ]);
        const overallSheet = XLSX.utils.json_to_sheet(updatedOverallData);
        workbook.Sheets["overall"] = overallSheet;
        // Prepare per-test data sheet
        const runKey = `test run ${runId}`;
        const testRunData = results.map((test) => ({
            "TEST RUN ID": runId,
            TEST_NAME: test.name,
            DURATION: test.duration,
            STATUS: test.status,
            TIMESTAMP: timestamp,
        }));
        const testRunSheet = XLSX.utils.json_to_sheet(testRunData);
        workbook.Sheets[runKey] = testRunSheet;
        if (!workbook.SheetNames.includes(runKey)) {
            workbook.SheetNames.push(runKey);
        }
        // Maintain max sheet count (excluding "overall")
        const sheetNames = workbook.SheetNames.filter((name) => name !== "overall");
        if (sheetNames.length > this.maxRuns) {
            const oldestRun = Math.min(...sheetNames.map((name) => parseInt(name.split(" ")[2], 10)));
            const oldestSheet = `test run ${oldestRun}`;
            delete workbook.Sheets[oldestSheet];
            workbook.SheetNames = workbook.SheetNames.filter((name) => name !== oldestSheet);
        }
        // Write workbook to file
        const buffer = XLSX.write(workbook, { bookType: "xls", type: "buffer" });
        await fs.writeFile(this.excelFilePath, buffer);
    }
    async generateExcel() {
        // The file is already generated in updateTrendData
        console.log(`Excel trend report updated at ${this.excelFilePath}`);
    }
}
const convertStatus = (status, testCase) => {
    // Special case: test was expected to fail (test.fail())
    if ((testCase === null || testCase === void 0 ? void 0 : testCase.expectedStatus) === "failed") {
        return status === "failed" ? "failed" : "failed"; // Always return failed for unexpected passes
    }
    // Special case: test was expected to skip (test.skip())
    if ((testCase === null || testCase === void 0 ? void 0 : testCase.expectedStatus) === "skipped") {
        return "skipped"; // Just return skipped status
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
const ATTACHMENTS_SUBDIR = "attachments"; // Centralized definition
class PlaywrightPulseReporter {
    constructor(options = {}) {
        var _a, _b;
        this.results = [];
        this.baseOutputFile = "playwright-pulse-report.json";
        this.isSharded = false;
        this.shardIndex = undefined;
        this.options = options; // Store provided options
        this.baseOutputFile = (_a = options.outputFile) !== null && _a !== void 0 ? _a : this.baseOutputFile;
        // Determine outputDir relative to config file or rootDir
        // The actual resolution happens in onBegin where config is available
        this.outputDir = (_b = options.outputDir) !== null && _b !== void 0 ? _b : "pulse-report";
        this.attachmentsDir = path.join(this.outputDir, ATTACHMENTS_SUBDIR); // Initial path, resolved fully in onBegin
        // console.log(`Pulse Reporter Init: Configured outputDir option: ${options.outputDir}, Base file: ${this.baseOutputFile}`);
        this.excelManager = new ExcelTrendManager(this.outputDir);
    }
    // Add this helper method to your PlaywrightPulseReporter class
    getNextRunNumber() {
        // Implement logic to determine the next run number
        // This could be stored in a file or derived from existing data
        // For simplicity, we'll use a timestamp-based approach here
        return Math.floor(Date.now() / 1000);
    }
    printsToStdio() {
        return this.shardIndex === undefined || this.shardIndex === 0;
    }
    onBegin(config, suite) {
        var _a;
        this.config = config;
        this.suite = suite;
        this.runStartTime = Date.now();
        // --- Resolve outputDir relative to config file or rootDir ---
        const configDir = this.config.rootDir;
        // Use config file directory if available, otherwise rootDir
        const configFileDir = this.config.configFile
            ? path.dirname(this.config.configFile)
            : configDir;
        this.outputDir = path.resolve(configFileDir, (_a = this.options.outputDir) !== null && _a !== void 0 ? _a : "pulse-report");
        // Resolve attachmentsDir relative to the final outputDir
        this.attachmentsDir = path.resolve(this.outputDir, ATTACHMENTS_SUBDIR);
        // Update options with the resolved absolute path for internal use
        this.options.outputDir = this.outputDir;
        // console.log(`Pulse Reporter onBegin: Final Report Output dir resolved to ${this.outputDir}`);
        // console.log(`Pulse Reporter onBegin: Attachments base dir resolved to ${this.attachmentsDir}`);
        const totalShards = this.config.shard ? this.config.shard.total : 1;
        this.isSharded = totalShards > 1;
        this.shardIndex = this.config.shard
            ? this.config.shard.current - 1
            : undefined;
        // Ensure base output directory exists (attachments handled by attachFiles util)
        this._ensureDirExists(this.outputDir)
            .then(() => {
            if (this.shardIndex === undefined) {
                console.log(`PlaywrightPulseReporter: Starting test run with ${suite.allTests().length} tests${this.isSharded ? ` across ${totalShards} shards` : ""}. Pulse outputting to ${this.outputDir}`);
                // Clean up old shard files only in the main process
                return this._cleanupTemporaryFiles();
            }
            else {
                // console.log(`Pulse Reporter (Shard ${this.shardIndex + 1}/${totalShards}): Starting. Temp results to ${this.outputDir}`);
                return Promise.resolve();
            }
        })
            .catch((err) => console.error("Pulse Reporter: Error during initialization:", err));
    }
    onTestBegin(test) {
        // Optional: Log test start if needed
        // console.log(`Starting test: ${test.title}`);
    }
    async processStep(step, testId, browserName, testCase // Add testCase parameter
    ) {
        var _a, _b, _c, _d;
        // Determine actual step status (don't inherit from parent)
        let stepStatus = "passed";
        let errorMessage = ((_a = step.error) === null || _a === void 0 ? void 0 : _a.message) || undefined;
        if ((_c = (_b = step.error) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.startsWith("Test is skipped:")) {
            stepStatus = "skipped";
            errorMessage = "Info: Test is skipped:";
        }
        else {
            // Pass testCase to convertStatus
            stepStatus = convertStatus(step.error ? "failed" : "passed", testCase);
        }
        const duration = step.duration;
        const startTime = new Date(step.startTime);
        const endTime = new Date(startTime.getTime() + Math.max(0, duration));
        // Capture code location if available
        let codeLocation = "";
        if (step.location) {
            codeLocation = `${path.relative(this.config.rootDir, step.location.file)}:${step.location.line}:${step.location.column}`;
        }
        // Modify title only for test steps (not hooks)
        let stepTitle = step.title;
        // Add warning/error messages for special cases
        if (step.category === "test" && testCase) {
            if (testCase.expectedStatus === "failed" && status === "passed") {
                errorMessage = "Expected to fail, but passed.";
            }
            else if (testCase.expectedStatus === "skipped") {
                errorMessage = "Test was explicitly skipped";
            }
        }
        return {
            id: `${testId}_step_${startTime.toISOString()}-${duration}-${(0, crypto_1.randomUUID)()}`,
            title: stepTitle, // Use modified title
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
            steps: [], // Will be populated recursively
        };
    }
    async onTestEnd(test, result) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        // Get the most accurate browser name
        const project = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project();
        const browserName = ((_b = project === null || project === void 0 ? void 0 : project.use) === null || _b === void 0 ? void 0 : _b.defaultBrowserType) || "unknown";
        const testStatus = convertStatus(result.status, test);
        const startTime = new Date(result.startTime);
        const endTime = new Date(startTime.getTime() + result.duration);
        // Generate a slightly more robust ID for attachments, especially if test.id is missing
        const testIdForFiles = test.id ||
            `${test
                .titlePath()
                .join("_")
                .replace(/[^a-zA-Z0-9]/g, "_")}_${startTime.getTime()}`;
        // --- Process Steps Recursively ---
        const processAllSteps = async (steps, parentTestStatus) => {
            let processed = [];
            for (const step of steps) {
                const processedStep = await this.processStep(step, testIdForFiles, browserName, test);
                processed.push(processedStep);
                if (step.steps && step.steps.length > 0) {
                    const nestedSteps = await processAllSteps(step.steps, processedStep.status);
                    // Assign nested steps correctly
                    processedStep.steps = nestedSteps;
                }
            }
            return processed;
        };
        // --- Extract Code Snippet ---
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
        // --- Prepare Base TestResult ---
        const pulseResult = {
            id: test.id || `${test.title}-${startTime.toISOString()}-${(0, crypto_1.randomUUID)()}`, // Use the original ID logic here
            runId: "TBD", // Will be set later
            name: test.titlePath().join(" > "),
            suiteName: ((_f = this.config.projects[0]) === null || _f === void 0 ? void 0 : _f.name) || "Default Suite",
            status: testStatus,
            duration: result.duration,
            startTime: startTime,
            endTime: endTime,
            browser: browserName,
            retries: result.retry,
            steps: ((_g = result.steps) === null || _g === void 0 ? void 0 : _g.length)
                ? await processAllSteps(result.steps, testStatus)
                : [],
            errorMessage: (_h = result.error) === null || _h === void 0 ? void 0 : _h.message,
            stackTrace: (_j = result.error) === null || _j === void 0 ? void 0 : _j.stack,
            codeSnippet: codeSnippet,
            tags: test.tags.map((tag) => tag.startsWith("@") ? tag.substring(1) : tag),
            screenshots: [],
            videoPath: undefined,
            tracePath: undefined,
        };
        // --- Process Attachments using the new utility ---
        try {
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
            console.warn("Pulse Reporter: _writeShardResults called unexpectedly in main process. Skipping.");
            return;
        }
        const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${this.shardIndex}.json`);
        try {
            // No need to ensureDirExists here, should be done in onBegin
            await fs.writeFile(tempFilePath, JSON.stringify(this.results, (key, value) => {
                if (value instanceof Date) {
                    return value.toISOString();
                }
                return value;
            }, 2));
            // console.log(`Pulse Reporter: Shard ${this.shardIndex} wrote ${this.results.length} results to ${tempFilePath}`);
        }
        catch (error) {
            console.error(`Pulse Reporter: Shard ${this.shardIndex} failed to write temporary results to ${tempFilePath}`, error);
        }
    }
    async _mergeShardResults(finalRunData) {
        // console.log('Pulse Reporter: Merging results from shards...');
        let allResults = [];
        const totalShards = this.config.shard ? this.config.shard.total : 1;
        for (let i = 0; i < totalShards; i++) {
            const tempFilePath = path.join(this.outputDir, `${TEMP_SHARD_FILE_PREFIX}${i}.json`);
            try {
                const content = await fs.readFile(tempFilePath, "utf-8");
                const shardResults = JSON.parse(content);
                shardResults.forEach((r) => (r.runId = finalRunData.id));
                allResults = allResults.concat(shardResults);
                // console.log(`Pulse Reporter: Successfully merged ${shardResults.length} results from shard ${i}`);
            }
            catch (error) {
                if ((error === null || error === void 0 ? void 0 : error.code) === "ENOENT") {
                    console.warn(`Pulse Reporter: Shard results file not found: ${tempFilePath}. This might happen if shard ${i} had no tests or failed early.`);
                }
                else {
                    console.error(`Pulse Reporter: Could not read or parse results from shard ${i} (${tempFilePath}). Error:`, error);
                }
            }
        }
        // console.log(`Pulse Reporter: Merged a total of ${allResults.length} results from ${totalShards} shards.`);
        finalRunData.passed = allResults.filter((r) => r.status === "passed").length;
        finalRunData.failed = allResults.filter((r) => r.status === "failed").length;
        finalRunData.skipped = allResults.filter((r) => r.status === "skipped").length;
        finalRunData.totalTests = allResults.length;
        const reviveDates = (key, value) => {
            const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
            if (typeof value === "string" && isoDateRegex.test(value)) {
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                    return date;
                }
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
            // No need to ensure dir exists here if handled in onBegin
            const files = await fs.readdir(this.outputDir);
            const tempFiles = files.filter((f) => f.startsWith(TEMP_SHARD_FILE_PREFIX));
            if (tempFiles.length > 0) {
                // console.log(`Pulse Reporter: Cleaning up ${tempFiles.length} temporary shard files...`);
                await Promise.all(tempFiles.map((f) => fs.unlink(path.join(this.outputDir, f))));
            }
        }
        catch (error) {
            if ((error === null || error === void 0 ? void 0 : error.code) !== "ENOENT") {
                // Ignore if the directory doesn't exist
                console.error("Pulse Reporter: Error cleaning up temporary files:", error);
            }
        }
    }
    async _ensureDirExists(dirPath, clean = false) {
        try {
            if (clean) {
                // console.log(`Pulse Reporter: Cleaning directory ${dirPath}...`);
                await fs.rm(dirPath, { recursive: true, force: true });
            }
            await fs.mkdir(dirPath, { recursive: true });
        }
        catch (error) {
            // Ignore EEXIST error if the directory already exists
            if (error.code !== "EEXIST") {
                console.error(`Pulse Reporter: Failed to ensure directory exists: ${dirPath}`, error);
                throw error; // Re-throw other errors
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
        const runId = `run-${this.runStartTime}-581d5ad8-ce75-4ca5-94a6-ed29c466c815`;
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
        // Generate Excel trend data
        try {
            const runNumber = this.getNextRunNumber();
            await this.excelManager.updateTrendData(runNumber, Date.now(), finalReport.results, duration);
            await this.excelManager.generateExcel();
            console.log(`PlaywrightPulseReporter: Excel trend report updated at ${this.excelManager.getExcelFilePath()}`);
        }
        catch (error) {
            console.error("Pulse Reporter: Failed to update Excel trend data:", error);
        }
        if (this.isSharded) {
            // console.log("Pulse Reporter: Run ended, main process merging shard results...");
            finalReport = await this._mergeShardResults(runData);
        }
        else {
            // console.log("Pulse Reporter: Run ended, processing results directly (no sharding)...");
            this.results.forEach((r) => (r.runId = runId)); // Assign runId to directly collected results
            runData.passed = this.results.filter((r) => r.status === "passed").length;
            runData.failed = this.results.filter((r) => r.status === "failed").length;
            runData.skipped = this.results.filter((r) => r.status === "skipped").length;
            runData.totalTests = this.results.length;
            finalReport = {
                run: runData,
                results: this.results, // Use directly collected results
                metadata: { generatedAt: new Date().toISOString() },
            };
        }
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
            // Ensure directory exists before writing final report
            await this._ensureDirExists(this.outputDir);
            // --- Write Final JSON Report ---
            await fs.writeFile(finalOutputPath, JSON.stringify(finalReport, (key, value) => {
                if (value instanceof Date) {
                    return value.toISOString(); // Ensure dates are ISO strings in JSON
                }
                // Handle potential BigInt if used elsewhere, though unlikely here
                if (typeof value === "bigint") {
                    return value.toString();
                }
                return value;
            }, 2));
            console.log(`PlaywrightPulseReporter: JSON report written to ${finalOutputPath}`);
            // REMOVED Static HTML Generation Call
            // The reporter's responsibility is now only to create the JSON file.
            // The user will run `npx generate-pulse-report` separately.
        }
        catch (error) {
            console.error(`Pulse Reporter: Failed to write final JSON report to ${finalOutputPath}. Error: ${error.message}`);
        }
        finally {
            if (this.isSharded) {
                // console.log("Pulse Reporter: Cleaning up temporary shard files...");
                await this._cleanupTemporaryFiles();
            }
        }
    }
}
exports.PlaywrightPulseReporter = PlaywrightPulseReporter;
exports.default = PlaywrightPulseReporter;
