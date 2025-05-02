// src/reporter/index.ts
import { PlaywrightPulseReporter } from "./playwright-pulse-reporter";

// Export the reporter class as the default export for CommonJS compatibility
// and also as a named export for potential ES module consumers.
export default PlaywrightPulseReporter;
export { PlaywrightPulseReporter };

// You can also export other related types or utilities if needed
export * from "../types"; // Re-export shared types if they are used by the reporter consumers
export * from "../lib/report-types";
