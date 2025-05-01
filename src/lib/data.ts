'use server';

import type { TestResult, TestRun, TrendDataPoint } from '@/types';
import * as fs from 'fs/promises';
import * as path from 'path';

// Structure matching the reporter's output
interface PlaywrightPulseReport {
    run: TestRun | null;
    results: TestResult[];
    metadata: {
        generatedAt: string;
    };
}

const reportFilePath = path.resolve(process.cwd(), 'playwright-pulse-report.json');
let cachedReportData: PlaywrightPulseReport | null = null;
let lastReadTime: number | null = null;
const CACHE_DURATION = 5000; // Cache duration in milliseconds (e.g., 5 seconds)

// Function to read and cache the report file
async function readReportFile(): Promise<PlaywrightPulseReport> {
  const now = Date.now();
  // Use cache if it's recent
  if (cachedReportData && lastReadTime && (now - lastReadTime < CACHE_DURATION)) {
    // console.log("Using cached report data.");
    return cachedReportData;
  }

  // console.log(`Attempting to read report file from: ${reportFilePath}`);
  try {
    const fileContent = await fs.readFile(reportFilePath, 'utf-8');
    const reportData = JSON.parse(fileContent) as PlaywrightPulseReport;

    // Basic validation
    if (!reportData || !reportData.metadata || !Array.isArray(reportData.results)) {
         throw new Error('Invalid report file structure.');
    }

    // Convert date strings back to Date objects (important!)
    if(reportData.run) {
        reportData.run.timestamp = new Date(reportData.run.timestamp);
    }
    reportData.results.forEach(result => {
        result.startTime = new Date(result.startTime);
        result.endTime = new Date(result.endTime);
        // Check if steps exist before iterating
        if (Array.isArray(result.steps)) {
            result.steps.forEach(step => {
                step.startTime = new Date(step.startTime);
                step.endTime = new Date(step.endTime);
            });
        } else {
             result.steps = []; // Initialize as empty array if undefined
        }
    });


    cachedReportData = reportData;
    lastReadTime = now;
    // console.log("Successfully read and cached report file.");
    return reportData;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Report file not found at ${reportFilePath}. Returning empty data. Run Playwright tests with the reporter enabled.`);
      // Return a default structure if the file doesn't exist
       const defaultReport: PlaywrightPulseReport = { run: null, results: [], metadata: { generatedAt: new Date().toISOString() } };
       cachedReportData = defaultReport; // Cache the default state
       lastReadTime = now;
       return defaultReport;
    } else {
      console.error(`Error reading or parsing report file at ${reportFilePath}:`, error);
      throw new Error(`Failed to load report data: ${error.message}`); // Re-throw other errors
    }
  }
}


// --- Modified Data Fetching Functions ---

export const getLatestTestRun = async (): Promise<TestRun | null> => {
   await new Promise(resolve => setTimeout(resolve, 20)); // Minimal delay
   const reportData = await readReportFile();
   return reportData.run;
};

// Deprecated: Use getAllTestResults for the single run context
// export const getTestResultsForRun = async (runId: string): Promise<TestResult[]> => {
//    await new Promise(resolve => setTimeout(resolve, 50)); // Minimal delay
//    const reportData = await readReportFile();
//    // In this single-file model, runId comparison isn't strictly necessary
//    return reportData.results;
// };

export const getTestResultById = async (testId: string): Promise<TestResult | null> => {
   await new Promise(resolve => setTimeout(resolve, 20)); // Minimal delay
   const reportData = await readReportFile();
   return reportData.results.find(r => r.id === testId) || null;
};

// Deprecated: Only one run in the JSON
// export const getTestRuns = async (limit: number = 1): Promise<TestRun[]> => {
//    await new Promise(resolve => setTimeout(resolve, 30)); // Minimal delay
//    const reportData = await readReportFile();
//    return reportData.run ? [reportData.run] : [];
// };

// Note: Trend data needs a historical data source, not available from the single report JSON.
// This will return empty for now, or could be adapted to show single-point data if needed.
export const getTrendData = async (limit: number = 1): Promise<TrendDataPoint[]> => {
   await new Promise(resolve => setTimeout(resolve, 30)); // Minimal delay
   const reportData = await readReportFile();
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

// Returns all test results from the single loaded report
export const getAllTestResults = async (): Promise<TestResult[]> => {
    await new Promise(resolve => setTimeout(resolve, 50)); // Minimal delay
    const reportData = await readReportFile();
    return reportData.results;
};

// New function to get *all* runs (only one in this context)
export const getTestRuns = async (limit: number = 1): Promise<TestRun[]> => {
    await new Promise(resolve => setTimeout(resolve, 30)); // Minimal delay
    const reportData = await readReportFile();
    return reportData.run ? [reportData.run] : [];
};
