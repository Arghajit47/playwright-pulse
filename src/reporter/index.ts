// src/reporter/index.ts
import { PlaywrightPulseReporter } from "./playwright-pulse-reporter";

// Export the reporter class as the default export for CommonJS compatibility
// and also as a named export for potential ES module consumers.
export default PlaywrightPulseReporter;
export { PlaywrightPulseReporter };

// Re-export types needed by consumers of the reporter itself
export type { PlaywrightPulseReport } from "../lib/report-types";
export type { TestResult, TestRun, TestStep, TestStatus } from "../types";

// --- NEW: Export the pulse helper ---
// This allows: import { pulse } from '@arghajit/playwright-pulse-report';
export { pulse } from "../pulse"; // Adjust path based on where you placed pulse.ts
export type { PulseSeverityLevel } from "../pulse";
