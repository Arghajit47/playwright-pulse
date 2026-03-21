import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult as PwTestResult } from "@playwright/test/reporter";
import type { PlaywrightPulseReporterOptions } from "../types";
export declare class PlaywrightPulseReporter implements Reporter {
    private config;
    private suite;
    private results;
    private _pendingTestEnds;
    private runStartTime;
    private options;
    private outputDir;
    private attachmentsDir;
    private baseOutputFile;
    private individualReportsSubDir;
    private isSharded;
    private shardIndex;
    private resetOnEachRun;
    constructor(options?: PlaywrightPulseReporterOptions);
    printsToStdio(): boolean;
    onBegin(config: FullConfig, suite: Suite): void;
    onTestBegin(test: TestCase): void;
    private _getSeverity;
    private extractCodeSnippet;
    private getBrowserDetails;
    private processStep;
    onTestEnd(test: TestCase, result: PwTestResult): Promise<void>;
    private _processTestEnd;
    private _getFinalizedResults;
    onError(error: any): void;
    private _getEnvDetails;
    private _writeShardResults;
    private _mergeShardResults;
    private _cleanupTemporaryFiles;
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
    private _ensureDirExists;
    onEnd(result: FullResult): Promise<void>;
}
export default PlaywrightPulseReporter;
