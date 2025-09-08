interface FullConfig {
    workers: number;
    outputDir?: string;
    shard?: {
        current: number;
    };
    projects: Array<{
        name?: string;
    }>;
    metadata?: any;
    configFile?: string;
}
interface FullResult {
    status: string;
    duration: number;
}
interface Reporter {
    onBegin?(config: FullConfig, suite: Suite): void;
    onTestEnd?(test: TestCase, result: PwTestResult): void | Promise<void>;
    onEnd?(result: FullResult): void | Promise<void>;
    onError?(error: Error): void;
    printsToStdio?(): boolean;
}
interface Suite {
}
interface TestCase {
    id: string;
    title: string;
    tags: string[];
    location?: {
        file: string;
        line: number;
        column: number;
    };
    titlePath(): string[];
    parent?: {
        title?: string;
        project?(): any;
    };
}
interface PwTestResult {
    status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
    duration: number;
    startTime: Date;
    retry: number;
    workerIndex: number;
    stdout: Array<string | any>;
    stderr: Array<string | any>;
    error?: {
        message?: string;
        stack?: string;
        snippet?: string;
    };
    steps: PwStep[];
    attachments: Array<{
        name: string;
        contentType?: string;
        path?: string;
        body?: any;
    }>;
}
interface PwStep {
    title: string;
    category: string;
    startTime: Date;
    duration: number;
    error?: {
        message?: string;
        stack?: string;
        snippet?: string;
    };
    count?: number;
    location?: {
        file: string;
        line: number;
        column: number;
    };
    steps?: PwStep[];
}
type PulseTestStatus = "passed" | "failed" | "skipped" | "flaky";
interface PulseTestStep {
    title: string;
    category: string;
    startTime: Date;
    duration: number;
    error?: {
        message: string;
        stack?: string;
        snippet?: string;
    };
    count: number;
    location?: string;
    status: PulseTestStatus;
}
interface PlaywrightPulseReporterOptions {
    outputDir?: string;
    outputFile?: string;
    base64Images?: boolean;
    open?: boolean;
    resetOnEachRun?: boolean;
}
export declare class PlaywrightPulseReporter implements Reporter {
    private testResults;
    private currentRunId;
    private outputDir;
    private totalWorkers;
    private shardIndex?;
    private options;
    constructor(options?: PlaywrightPulseReporterOptions);
    printsToStdio(): boolean;
    onBegin(config: FullConfig, suite: Suite): void;
    getBrowserDetails(project: any): string;
    processStep(step: PwStep): Promise<PulseTestStep>;
    onTestEnd(test: TestCase, result: PwTestResult): Promise<void>;
    private _getFinalizedResults;
    private _getSummaryStats;
    private _getSummaryStatsFromAttempts;
    onError(error: Error): void;
    private _getEnvDetails;
    private _writeShardResults;
    private _mergeShardResults;
    private _cleanupTemporaryFiles;
    private _ensureDirExists;
    onEnd(result: FullResult): Promise<void>;
    private _mergeAllRunReports;
}
export {};
