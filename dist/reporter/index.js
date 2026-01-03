"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pulse = exports.PlaywrightPulseReporter = void 0;
// src/reporter/index.ts
const playwright_pulse_reporter_1 = require("./playwright-pulse-reporter");
Object.defineProperty(exports, "PlaywrightPulseReporter", { enumerable: true, get: function () { return playwright_pulse_reporter_1.PlaywrightPulseReporter; } });
// Export the reporter class as the default export for CommonJS compatibility
// and also as a named export for potential ES module consumers.
exports.default = playwright_pulse_reporter_1.PlaywrightPulseReporter;
// --- NEW: Export the pulse helper ---
// This allows: import { pulse } from '@arghajit/playwright-pulse-report';
var pulse_1 = require("../pulse"); // Adjust path based on where you placed pulse.ts
Object.defineProperty(exports, "pulse", { enumerable: true, get: function () { return pulse_1.pulse; } });
