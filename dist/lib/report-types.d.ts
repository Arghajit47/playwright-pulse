import type { TestResult, TestRun } from '@/types';
export interface PlaywrightPulseReport {
    run: TestRun | null;
    results: TestResult[];
    metadata: {
        generatedAt: string;
        reportDescription?: string;
        logo?: string;
    };
}
