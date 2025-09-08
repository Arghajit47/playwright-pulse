"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightPulseReporter = void 0;
const fs = {
    promises: {
        writeFile: async (path, data) => {
            console.log(`Would write to ${path}`);
        },
        readFile: async (path, encoding) => {
            console.log(`Would read from ${path}`);
            return "{}";
        },
        readdir: async (path) => {
            console.log(`Would read directory ${path}`);
            return [];
        },
        mkdir: async (path, options) => {
            console.log(`Would create directory ${path}`);
        },
        unlink: async (path) => {
            console.log(`Would delete ${path}`);
        },
    },
};
const path = {
    resolve: (...paths) => paths.join("/"),
    join: (...paths) => paths.join("/"),
    relative: (from, to) => to,
    dirname: (p) => p.split("/").slice(0, -1).join("/"),
    basename: (p, ext) => {
        const base = p.split("/").pop() || "";
        return ext ? base.replace(ext, "") : base;
    },
    extname: (p) => {
        const parts = p.split(".");
        return parts.length > 1 ? "." + parts.pop() : "";
    },
};
const randomUUID = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
});
const UAParser = class {
    getBrowser() {
        return { name: "unknown", version: "unknown" };
    }
};
const os = {
    type: () => "Linux",
    release: () => "5.4.0",
    arch: () => "x64",
    hostname: () => "localhost",
    platform: () => "linux",
    cpus: () => [{ model: "Intel" }],
    totalmem: () => 8589934592,
};
const process = {
    cwd: () => "/current/working/directory",
    version: "v18.0.0",
    versions: { v8: "10.0.0" },
};
function convertStatus(status) {
    switch (status) {
        case "passed":
            return "passed";
        case "failed":
        case "timedOut":
        case "interrupted":
            return "failed";
        case "skipped":
            return "skipped";
        default:
            return "failed";
    }
}
function attachFiles(testId, pwResult, pulseResult, config) {
    const baseReportDir = config.outputDir || "pulse-report";
    const attachmentsBaseDir = path.resolve(baseReportDir, "attachments");
    const attachmentsSubFolder = `${testId}-retry-${pwResult.retry || 0}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    pulseResult.screenshots = [];
    pulseResult.videoPath = [];
    pulseResult.attachments = [];
    if (!pwResult.attachments)
        return;
    pwResult.attachments.forEach((attachment) => {
        var _a, _b, _c;
        const { contentType, name, path: attachmentPath } = attachment;
        if (!attachmentPath)
            return;
        const relativePath = path.join("attachments", attachmentsSubFolder, path.basename(attachmentPath));
        if (contentType === null || contentType === void 0 ? void 0 : contentType.startsWith("image/")) {
            (_a = pulseResult.screenshots) === null || _a === void 0 ? void 0 : _a.push(relativePath);
        }
        else if (name === "video" || (contentType === null || contentType === void 0 ? void 0 : contentType.startsWith("video/"))) {
            (_b = pulseResult.videoPath) === null || _b === void 0 ? void 0 : _b.push(relativePath);
        }
        else if (name === "trace" || contentType === "application/zip") {
            pulseResult.tracePath = relativePath;
        }
        else {
            (_c = pulseResult.attachments) === null || _c === void 0 ? void 0 : _c.push({
                name: attachment.name,
                path: relativePath,
                contentType: attachment.contentType,
            });
        }
    });
}
class PlaywrightPulseReporter {
    constructor(options = {}) {
        this.testResults = [];
        this.currentRunId = "";
        this.outputDir = "";
        this.totalWorkers = 0;
        this.options = options;
    }
    printsToStdio() {
        return false;
    }
    onBegin(config, suite) {
        var _a;
        this.currentRunId = randomUUID();
        this.totalWorkers = config.workers;
        this.shardIndex = (_a = config.shard) === null || _a === void 0 ? void 0 : _a.current;
        this.outputDir = path.resolve(this.options.outputDir || config.outputDir || "pulse-report");
        if (this.options.open === undefined) {
            this.options.open = false;
        }
        if (this.options.base64Images === undefined) {
            this.options.base64Images = false;
        }
        console.log(`Pulse Reporter: Starting test run with ID: ${this.currentRunId}`);
        if (this.shardIndex !== undefined) {
            console.log(`Pulse Reporter: Running shard ${this.shardIndex}`);
        }
    }
    getBrowserDetails(project) {
        var _a, _b;
        if (!project)
            return "unknown";
        const projectName = project.name || "unknown";
        const browserName = ((_a = project.use) === null || _a === void 0 ? void 0 : _a.browserName) || "unknown";
        const channel = (_b = project.use) === null || _b === void 0 ? void 0 : _b.channel;
        if (channel) {
            return `${browserName}-${channel}`;
        }
        return browserName;
    }
    async processStep(step) {
        const stepStatus = convertStatus(step.error ? "failed" : "passed");
        const codeLocation = step.location
            ? `${step.location.file}:${step.location.line}:${step.location.column}`
            : undefined;
        return {
            title: step.title,
            category: step.category,
            startTime: step.startTime,
            duration: step.duration,
            error: step.error
                ? {
                    message: step.error.message || "",
                    stack: step.error.stack,
                    snippet: step.error.snippet,
                }
                : undefined,
            count: step.count || 0,
            location: codeLocation,
            status: stepStatus,
        };
    }
    async onTestEnd(test, result) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const processAllSteps = async (steps) => {
            const processedSteps = [];
            for (const step of steps) {
                const processedStep = await this.processStep(step);
                processedSteps.push(processedStep);
                if (step.steps && step.steps.length > 0) {
                    const nestedSteps = await processAllSteps(step.steps);
                    processedSteps.push(...nestedSteps);
                }
            }
            return processedSteps;
        };
        const project = (_b = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project) === null || _b === void 0 ? void 0 : _b.call(_a);
        const relativePath = path.relative(process.cwd(), ((_c = test.location) === null || _c === void 0 ? void 0 : _c.file) || "");
        const testStatus = convertStatus(result.status);
        const startTime = result.startTime;
        const endTime = new Date(startTime.getTime() + result.duration);
        const stdoutMessages = result.stdout
            .filter((msg) => msg.trim().length > 0)
            .map((msg) => msg.toString());
        const stderrMessages = result.stderr
            .filter((msg) => msg.trim().length > 0)
            .map((msg) => msg.toString());
        const mappedWorkerId = result.workerIndex !== undefined ? result.workerIndex + 1 : undefined;
        const testSpecificData = {
            workerId: mappedWorkerId,
            totalWorkers: this.totalWorkers,
            configFile: relativePath,
            metadata: JSON.stringify({ project: project === null || project === void 0 ? void 0 : project.name }),
        };
        const pulseResult = {
            id: test.id,
            runId: this.currentRunId,
            name: `${(project === null || project === void 0 ? void 0 : project.name) || "unknown"} > ${((_d = test.parent) === null || _d === void 0 ? void 0 : _d.title) || ""} > ${test.title}`,
            suiteName: project === null || project === void 0 ? void 0 : project.name,
            status: testStatus,
            duration: result.duration,
            startTime: startTime,
            endTime: endTime,
            retry: result.retry,
            steps: await processAllSteps(result.steps),
            errorMessage: (_e = result.error) === null || _e === void 0 ? void 0 : _e.message,
            stackTrace: (_f = result.error) === null || _f === void 0 ? void 0 : _f.stack,
            snippet: (_g = result.error) === null || _g === void 0 ? void 0 : _g.snippet,
            codeSnippet: (_h = result.error) === null || _h === void 0 ? void 0 : _h.snippet,
            tags: test.tags,
            browser: this.getBrowserDetails(project),
            screenshots: [],
            videoPath: [],
            attachments: [],
            stdout: stdoutMessages,
            stderr: stderrMessages,
            ...testSpecificData,
        };
        attachFiles(test.id, result, pulseResult, this.options);
        this.testResults.push(pulseResult);
    }
    _getFinalizedResults(allAttempts) {
        const groupedResults = new Map();
        for (const attempt of allAttempts) {
            const baseTestId = attempt.id;
            if (!groupedResults.has(baseTestId)) {
                groupedResults.set(baseTestId, []);
            }
            groupedResults.get(baseTestId).push(attempt);
        }
        const finalResults = [];
        for (const [baseId, attempts] of groupedResults.entries()) {
            attempts.sort((a, b) => a.retry - b.retry);
            let overallStatus = "passed";
            const statuses = attempts.map((a) => a.status);
            const hasFailures = statuses.some((s) => s === "failed");
            const hasPasses = statuses.some((s) => s === "passed");
            if (hasFailures && hasPasses) {
                overallStatus = "flaky";
            }
            else if (hasFailures) {
                overallStatus = "failed";
            }
            else if (statuses.some((s) => s === "skipped")) {
                overallStatus = "skipped";
            }
            else {
                overallStatus = "passed";
            }
            const startTimes = attempts.map((a) => a.startTime.getTime());
            const endTimes = attempts.map((a) => a.endTime.getTime());
            const overallDuration = Math.max(...endTimes) - Math.min(...startTimes);
            const baseAttempt = attempts[0];
            finalResults.push({
                id: baseId,
                name: baseAttempt.name,
                suiteName: baseAttempt.suiteName,
                status: overallStatus,
                duration: overallDuration,
                startTime: new Date(Math.min(...startTimes)),
                endTime: new Date(Math.max(...endTimes)),
                browser: baseAttempt.browser,
                tags: baseAttempt.tags,
                results: attempts,
            });
        }
        return finalResults;
    }
    _getSummaryStats(consolidatedResults) {
        let passed = 0;
        let failed = 0;
        let skipped = 0;
        let flaky = 0;
        for (const result of consolidatedResults) {
            switch (result.status) {
                case "passed":
                    passed++;
                    break;
                case "failed":
                    failed++;
                    break;
                case "skipped":
                    skipped++;
                    break;
                case "flaky":
                    flaky++;
                    break;
            }
        }
        return {
            passed,
            failed,
            skipped,
            flaky,
            totalTests: consolidatedResults.length,
        };
    }
    _getSummaryStatsFromAttempts(attempts) {
        let passed = 0;
        let failed = 0;
        let skipped = 0;
        let flaky = 0;
        const groupedByTest = new Map();
        for (const attempt of attempts) {
            const baseId = attempt.id.replace(/-\d+$/, "");
            if (!groupedByTest.has(baseId)) {
                groupedByTest.set(baseId, []);
            }
            groupedByTest.get(baseId).push(attempt);
        }
        for (const attempt of attempts) {
            const baseId = attempt.id.replace(/-\d+$/, "");
            const testAttempts = groupedByTest.get(baseId);
            const hasFailures = testAttempts.some((a) => a.status === "failed");
            const hasPasses = testAttempts.some((a) => a.status === "passed");
            if (hasFailures && hasPasses) {
                flaky++;
            }
            else {
                switch (attempt.status) {
                    case "passed":
                        passed++;
                        break;
                    case "failed":
                        failed++;
                        break;
                    case "skipped":
                        skipped++;
                        break;
                }
            }
        }
        return {
            passed,
            failed,
            skipped,
            flaky,
            totalTests: attempts.length,
        };
    }
    onError(error) {
        console.error("Pulse Reporter: Error occurred:", error);
    }
    _getEnvDetails() {
        const parser = new UAParser();
        return {
            os: `${os.type()} ${os.release()}`,
            browser: parser.getBrowser(),
            cpu: os.arch(),
        };
    }
    async _writeShardResults(individualResults) {
        const tempFilePath = path.join(this.outputDir, `shard-${this.shardIndex || 0}-results.json`);
        try {
            await this._ensureDirExists(path.dirname(tempFilePath));
            await fs.promises.writeFile(tempFilePath, JSON.stringify(individualResults, null, 2));
        }
        catch (error) {
            console.error("Pulse Reporter: Error writing shard results:", error);
        }
    }
    async _mergeShardResults(allShardResults) {
        try {
            const allAttempts = allShardResults.flat();
            const reviveDates = (key, value) => {
                if (typeof value === "string" &&
                    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                    return new Date(value);
                }
                return value;
            };
            const properlyTypedResults = JSON.parse(JSON.stringify(allAttempts), reviveDates);
            return properlyTypedResults;
        }
        catch (error) {
            console.error("Pulse Reporter: Error merging shard results:", error);
            return [];
        }
    }
    async _cleanupTemporaryFiles() {
        try {
            const files = await fs.promises.readdir(this.outputDir);
            const shardFiles = files.filter((file) => file.startsWith("shard-") && file.endsWith("-results.json"));
            for (const file of shardFiles) {
                await fs.promises.unlink(path.join(this.outputDir, file));
            }
        }
        catch (error) {
            console.error("Pulse Reporter: Error cleaning up temporary files:", error);
        }
    }
    async _ensureDirExists(dirPath) {
        try {
            await fs.promises.mkdir(dirPath, { recursive: true });
        }
        catch (error) {
            console.error(`Pulse Reporter: Error creating directory ${dirPath}:`, error);
        }
    }
    async onEnd(result) {
        try {
            const individualResults = this.testResults;
            const stats = this._getSummaryStatsFromAttempts(individualResults);
            const runData = {
                id: this.currentRunId,
                startTime: new Date(),
                endTime: new Date(),
                duration: result.duration,
                status: result.status,
                environment: this._getEnvDetails(),
            };
            const finalReport = {
                run: runData,
                results: individualResults,
                summary: stats,
            };
            const jsonReplacer = (key, value) => {
                if (value instanceof Date) {
                    return value.toISOString();
                }
                return value;
            };
            if (this.shardIndex !== undefined) {
                await this._writeShardResults(individualResults);
                console.log(`Pulse Reporter: Shard ${this.shardIndex} results written.`);
            }
            else {
                const pulseResultsDir = path.join(this.outputDir, "pulse-results");
                await this._ensureDirExists(pulseResultsDir);
                const individualReportPath = path.join(pulseResultsDir, `${this.currentRunId}-pulse-report.json`);
                await fs.promises.writeFile(individualReportPath, JSON.stringify(finalReport, jsonReplacer, 2));
                const mergedReport = await this._mergeAllRunReports();
                if (mergedReport) {
                    const finalReportPath = path.join(this.outputDir, "playwright-pulse-report.json");
                    await fs.promises.writeFile(finalReportPath, JSON.stringify(mergedReport, jsonReplacer, 2));
                    console.log(`Pulse Reporter: Final report written to ${finalReportPath}`);
                }
            }
        }
        catch (error) {
            console.error("Pulse Reporter: Error in onEnd:", error);
        }
    }
    async _mergeAllRunReports() {
        var _a;
        try {
            const pulseResultsDir = path.join(this.outputDir, "pulse-results");
            const files = await fs.promises.readdir(pulseResultsDir);
            const jsonFiles = files.filter((file) => file.endsWith("-pulse-report.json"));
            if (jsonFiles.length === 0) {
                return null;
            }
            const allAttempts = [];
            let totalDuration = 0;
            for (const file of jsonFiles) {
                const filePath = path.join(pulseResultsDir, file);
                const content = await fs.promises.readFile(filePath, "utf-8");
                const report = JSON.parse(content);
                if (report.results) {
                    allAttempts.push(...report.results);
                }
                if ((_a = report.run) === null || _a === void 0 ? void 0 : _a.duration) {
                    totalDuration += report.run.duration;
                }
            }
            const stats = this._getSummaryStatsFromAttempts(allAttempts);
            const combinedRun = {
                id: this.currentRunId,
                startTime: new Date(),
                endTime: new Date(),
                duration: totalDuration,
                status: "passed",
                environment: this._getEnvDetails(),
            };
            const finalReport = {
                run: combinedRun,
                results: allAttempts,
                summary: stats,
            };
            return finalReport;
        }
        catch (error) {
            console.error("Pulse Reporter: Error merging all run reports:", error);
            return null;
        }
    }
}
exports.PlaywrightPulseReporter = PlaywrightPulseReporter;
