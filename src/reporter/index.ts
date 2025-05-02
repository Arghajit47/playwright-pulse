// src/reporter/index.ts
import { PlaywrightPulseReporter } from "./playwright-pulse-reporter";

// Export the reporter class as the default export for CommonJS compatibility
// and also as a named export for potential ES module consumers.
export default PlaywrightPulseReporter;
export { PlaywrightPulseReporter };

// Re-export types needed by consumers of the reporter itself
export type { PlaywrightPulseReport } from "../lib/report-types";
export type { TestResult, TestRun, TestStep, TestStatus } from "../types";
