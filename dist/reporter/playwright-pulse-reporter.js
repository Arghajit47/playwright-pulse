"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class PulseReporter {
    constructor() {
        this.report = {
            config: {},
            suites: [],
        };
    }
    onBegin(config, suite) {
        this.report.config = {
            workers: config.workers,
        };
        this.report.suites.push(this.serializeSuite(suite));
    }
    onEnd(result) {
        const reportPath = path_1.default.join(process.cwd(), "playwright-pulse-report.json");
        fs_1.default.writeFileSync(reportPath, JSON.stringify(this.report, null, 2));
        console.log(`✅ Playwright Pulse Report written to ${reportPath}`);
    }
    serializeSuite(suite) {
        var _a;
        return {
            title: suite.title,
            file: ((_a = suite.location) === null || _a === void 0 ? void 0 : _a.file) || "",
            location: suite.location || null,
            suites: suite.suites.map((s) => this.serializeSuite(s)),
            tests: suite.tests.map((t) => this.serializeTest(t)),
        };
    }
    serializeTest(test) {
        var _a, _b;
        return {
            testId: test.id,
            title: test.title,
            location: test.location,
            projectName: ((_b = (_a = test.parent) === null || _a === void 0 ? void 0 : _a.project()) === null || _b === void 0 ? void 0 : _b.name) || "unknown",
            annotations: test.annotations,
            expectedStatus: test.expectedStatus,
            timeout: test.timeout,
            results: test.results.map((r) => this.serializeResult(r)),
        };
    }
    serializeResult(result) {
        return {
            status: result.status,
            duration: result.duration,
            error: result.error,
            steps: result.steps,
            stdout: result.stdout,
            stderr: result.stderr,
            retry: result.retry,
            attachments: result.attachments,
        };
    }
}
exports.default = PulseReporter;
