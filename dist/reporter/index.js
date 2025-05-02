"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightPulseReporter = void 0;
// src/reporter/index.ts
const playwright_pulse_reporter_1 = require("./playwright-pulse-reporter");
Object.defineProperty(exports, "PlaywrightPulseReporter", { enumerable: true, get: function () { return playwright_pulse_reporter_1.PlaywrightPulseReporter; } });
// Export the reporter class as the default export for CommonJS compatibility
// and also as a named export for potential ES module consumers.
exports.default = playwright_pulse_reporter_1.PlaywrightPulseReporter;
