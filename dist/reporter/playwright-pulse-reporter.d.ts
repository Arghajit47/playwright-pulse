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
     * Groups all run attempts for a single logical test case and creates consolidated test results.
     * This matches Playwright's default structure where retry attempts are grouped under one test entry.
     * @param allAttempts An array of all individual test run attempts.
     * @returns An array of ConsolidatedTestResult objects, where each object represents one logical test with all its retry attempts.
     */
    private _getFinalizedResults;
    /**
     * Helper method to get summary statistics from consolidated results
     */
    private _getSummaryStats;
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
