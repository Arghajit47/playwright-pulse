import type { TestResult as PwTestResult } from "@playwright/test/reporter";
import type { TestResult, PlaywrightPulseReporterOptions } from "../types";
/**
 * Processes attachments from a Playwright TestResult and updates the PulseTestResult.
 * @param testId A unique identifier for the test, used for folder naming.
 * @param pwResult The TestResult object from Playwright.
 * @param pulseResult The internal test result structure to update.
 * @param config The reporter configuration options.
 */
export declare function attachFiles(testId: string, pwResult: PwTestResult, pulseResult: TestResult, config: PlaywrightPulseReporterOptions): void;
