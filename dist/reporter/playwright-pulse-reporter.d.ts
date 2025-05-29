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
    constructor(options?: PlaywrightPulseReporterOptions);
    printsToStdio(): boolean;
    onBegin(config: FullConfig, suite: Suite): void;
    onTestBegin(test: TestCase): void;
    private processStep;
    onTestEnd(test: TestCase, result: PwTestResult): Promise<void>;
    onError(error: any): void;
    private _writeShardResults;
    private _mergeShardResults;
    private _cleanupTemporaryFiles;
    private _ensureDirExists;
    onEnd(result: FullResult): Promise<void>;
}
export default PlaywrightPulseReporter;
