
import type { TestResult, TestRun } from '@/types';

// Structure matching the reporter's output
export interface PlaywrightPulseReport {
    run: TestRun | null;
    results: TestResult[];
    metadata: {
        generatedAt: string;
    };
}
