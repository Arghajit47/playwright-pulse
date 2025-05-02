import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult as PwTestResult } from "@playwright/test/reporter";
export declare class PlaywrightPulseReporter implements Reporter {
    private config;
    private suite;
    private results;
    private runStartTime;
    private outputDir;
    private baseOutputFile;
    private isSharded;
    private shardIndex;
    constructor(options?: {
        outputFile?: string;
        outputDir?: string;
    });
    printsToStdio(): boolean;
    onBegin(config: FullConfig, suite: Suite): void;
    onTestBegin(test: TestCase): void;
    private processStep;
    onTestEnd(test: TestCase, result: PwTestResult): void;
    onError(error: any): void;
    private _writeShardResults;
    private _mergeShardResults;
    private _cleanupTemporaryFiles;
    private _ensureDirExists;
    onEnd(result: FullResult): Promise<void>;
}
