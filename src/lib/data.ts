
'use server';

import type { TestResult, TestRun, TrendDataPoint } from '@/types';
import { readReportDataInternal } from './data-reader'; // Import the server-only reader


// --- Modified Data Fetching Functions ---

export const getLatestTestRun = async (): Promise<TestRun | null> => {
    await new Promise(resolve => setTimeout(resolve, 20)); // Minimal delay for demo
    const reportData = await readReportDataInternal();
    return reportData.run;
};

export const getTestResultById = async (testId: string): Promise<TestResult | null> => {
    await new Promise(resolve => setTimeout(resolve, 20)); // Minimal delay for demo
    const reportData = await readReportDataInternal();
    return reportData.results.find(r => r.id === testId) || null;
};

export const getTrendData = async (limit: number = 1): Promise<TrendDataPoint[]> => {
    await new Promise(resolve => setTimeout(resolve, 30)); // Minimal delay for demo
    const reportData = await readReportDataInternal();
    if (reportData.run) {
        const run = reportData.run;
        // Return a single data point based on the current run
        // You might want a more sophisticated trend mechanism later
        return [{
            date: run.timestamp.toISOString().split('T')[0], // Use date part of timestamp
            passed: run.passed,
            failed: run.failed,
            skipped: run.skipped,
        }];
    }
    return [];
};

export const getAllTestResults = async (): Promise<TestResult[]> => {
    await new Promise(resolve => setTimeout(resolve, 50)); // Minimal delay for demo
    const reportData = await readReportDataInternal();
    return reportData.results;
};

export const getTestRuns = async (limit: number = 1): Promise<TestRun[]> => {
    await new Promise(resolve => setTimeout(resolve, 30)); // Minimal delay for demo
    const reportData = await readReportDataInternal();
    return reportData.run ? [reportData.run] : [];
};
