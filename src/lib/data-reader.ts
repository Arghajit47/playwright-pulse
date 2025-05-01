
'use server';

import * as fs from 'fs/promises';
import * as path from 'path';
import type { PlaywrightPulseReport } from './report-types'; // Define this type if needed

const reportFileName = 'playwright-pulse-report.json'; // Use a constant for the filename
const reportFilePath = path.resolve(process.cwd(), reportFileName); // Default path relative to cwd

let cachedReportData: PlaywrightPulseReport | null = null;
let lastReadTime: number | null = null;
const CACHE_DURATION = 5000; // Cache duration in milliseconds (e.g., 5 seconds)


export async function readReportDataInternal(): Promise<PlaywrightPulseReport> {
    const now = Date.now();
    // Use cache if it's recent and not forced refresh
    if (cachedReportData && lastReadTime && (now - lastReadTime < CACHE_DURATION)) {
        // console.log("Returning cached report data.");
        return cachedReportData;
    }

    // console.log(`Attempting to read report file from: ${reportFilePath}`);
    try {
        const fileContent = await fs.readFile(reportFilePath, 'utf-8');
        let parsedData;
        try {
            parsedData = JSON.parse(fileContent);
        } catch (parseError: any) {
             console.error(`Error parsing JSON from ${reportFilePath}:`, parseError);
             throw new Error(`Invalid JSON in report file: ${parseError.message}`);
        }


        // --- Date Reviver ---
        // Function to convert ISO date strings back to Date objects recursively
        const reviveDates = (key: string, value: any): any => {
             // Matches ISO 8601 date format (YYYY-MM-DDTHH:mm:ss.sssZ)
             const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
             if (typeof value === 'string' && isoDateRegex.test(value)) {
                 const date = new Date(value);
                 // Check if the parsed date is valid before returning
                 if (!isNaN(date.getTime())) {
                    return date;
                 }
             }
             return value;
        };

        // Re-parse with the date reviver
        const reportData = JSON.parse(fileContent, reviveDates) as PlaywrightPulseReport;


        // Basic validation after parsing and date revival
        if (!reportData || typeof reportData !== 'object') {
            throw new Error('Report file is empty or not a valid object.');
        }
        if (!reportData.metadata || typeof reportData.metadata.generatedAt !== 'string') { // generatedAt should remain string from JSON
            throw new Error('Invalid or missing metadata in report file.');
        }
         if (!Array.isArray(reportData.results)) {
            throw new Error('Missing or invalid "results" array in report file.');
        }
         // Optional: Validate run data if present
        if (reportData.run && typeof reportData.run !== 'object') {
             throw new Error('Invalid "run" data in report file.');
        }
        if (reportData.run && !(reportData.run.timestamp instanceof Date)) {
             console.warn('Warning: Run timestamp was not correctly revived to a Date object.');
             // Potentially attempt fallback parsing or throw error
             reportData.run.timestamp = new Date(reportData.run.timestamp); // Attempt fallback
             if (isNaN(reportData.run.timestamp.getTime())) {
                 throw new Error('Invalid run timestamp format.');
             }
         }

         // Validate dates within results and steps
        reportData.results.forEach((result, index) => {
            if (!(result.startTime instanceof Date) || !(result.endTime instanceof Date)) {
                 console.warn(`Warning: Invalid start/end time for result index ${index}. Attempting fallback parsing.`);
                 result.startTime = new Date(result.startTime);
                 result.endTime = new Date(result.endTime);
                 if (isNaN(result.startTime.getTime()) || isNaN(result.endTime.getTime())) {
                    throw new Error(`Invalid start/end time in result index ${index}.`);
                 }
            }
             if (Array.isArray(result.steps)) {
                result.steps.forEach((step, stepIndex) => {
                    if (!(step.startTime instanceof Date) || !(step.endTime instanceof Date)) {
                         console.warn(`Warning: Invalid start/end time for step index ${stepIndex} in result index ${index}. Attempting fallback parsing.`);
                          step.startTime = new Date(step.startTime);
                          step.endTime = new Date(step.endTime);
                          if (isNaN(step.startTime.getTime()) || isNaN(step.endTime.getTime())) {
                              throw new Error(`Invalid start/end time in step index ${stepIndex}, result index ${index}.`);
                          }
                    }
                });
            } else {
                 result.steps = []; // Initialize if steps array is missing
            }
        });


        cachedReportData = reportData;
        lastReadTime = now;
        // console.log("Successfully read, parsed, and cached report file.");
        return reportData;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.warn(`Report file not found at ${reportFilePath}. Returning empty data structure. Ensure Playwright tests ran with the reporter enabled and the file exists.`);
            // Return a valid, empty structure
            const defaultReport: PlaywrightPulseReport = {
                run: null,
                results: [],
                metadata: { generatedAt: new Date().toISOString() }
            };
            cachedReportData = defaultReport; // Cache the default empty state
            lastReadTime = now;
            return defaultReport;
        } else {
            // Log the specific error for debugging
            console.error(`Error processing report file at ${reportFilePath}:`, error);
            // Propagate a user-friendly error
            throw new Error(`Failed to load report data: ${error.message}`);
        }
    }
}
