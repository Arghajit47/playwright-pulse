interface PwTestResult {
    retry: number;
    attachments: Array<{
        name: string;
        contentType?: string;
        path?: string;
        body?: any;
    }>;
}
interface PlaywrightPulseReporterOptions {
    outputDir?: string;
    outputFile?: string;
    base64Images?: boolean;
    open?: boolean;
    resetOnEachRun?: boolean;
}
interface TestResult {
    screenshots?: string[];
    videoPath?: string[];
    tracePath?: string;
    attachments?: Array<{
        name: string;
        path: string;
        contentType?: string;
    }>;
}
export declare function attachFiles(testId: string, pwResult: PwTestResult, pulseResult: TestResult, config: PlaywrightPulseReporterOptions): void;
export {};
