
'use server';

import * as fs from 'fs/promises';
import * as path from 'path';
import type { PlaywrightPulseReport } from './report-types'; // Define this type if needed

const reportFilePath = path.resolve(process.cwd(), 'playwright-pulse-report.json');
let cachedReportData: PlaywrightPulseReport | null = null;
let lastReadTime: number | null = null;
const CACHE_DURATION = 5000; // Cache duration in milliseconds (e.g., 5 seconds)


export async function readReportDataInternal(): Promise<PlaywrightPulseReport> {
    const now = Date.now();
    // Use cache if it's recent
    if (cachedReportData && lastReadTime && (now - lastReadTime < CACHE_DURATION)) {
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
        if (reportData.run) {
            reportData.run.timestamp = new Date(reportData.run.timestamp);
        }
        reportData.results.forEach(result => {
            result.startTime = new Date(result.startTime);
            result.endTime = new Date(result.endTime);
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
