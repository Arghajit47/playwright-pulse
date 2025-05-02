import type { TestResult, TestRun } from '@/types';
export interface PlaywrightPulseReport {
    run: TestRun | null;
    results: TestResult[];
    metadata: {
        generatedAt: string;
    };
}
