import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult as PwTestResult } from "@playwright/test/reporter";
import type { PlaywrightPulseReporterOptions } from "../types";
export declare class PlaywrightPulseReporter implements Reporter {
    private config;
    private suite;
    private results;
    private runStartTime;
    private options;
    private outputDir;
    private attachmentsDir;
    private baseOutputFile;
    private isSharded;
    private shardIndex;
    private resetOnEachRun;
    private currentRunId;
    constructor(options?: PlaywrightPulseReporterOptions);
    printsToStdio(): boolean;
    onBegin(config: FullConfig, suite: Suite): void;
    onTestBegin(test: TestCase): void;
    private getBrowserDetails;
    private processStep;
    onTestEnd(test: TestCase, result: PwTestResult): Promise<void>;
    private _getBaseTestId;
    private _getStatusOrder;
    /**
     * Modified: Groups all run attempts for a single logical test case and updates flaky status.
     * This ensures that tests with multiple retries are counted as single test case
     * while preserving all retry data in the JSON report.
     * @param allAttempts An array of all individual test run attempts.
     * @returns An array of ConsolidatedTestResult objects, where each object represents one logical test and contains an array of all its runs.
     */
    private _getFinalizedResults;
    onError(error: any): void;
    private _getEnvDetails;
    private _writeShardResults;
    private _mergeShardResults;
    private _cleanupTemporaryFiles;
    private _ensureDirExists;
    onEnd(result: FullResult): Promise<void>;
    private _mergeAllRunReports;
}
export default PlaywrightPulseReporter;
