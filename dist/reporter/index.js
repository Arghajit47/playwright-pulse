"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightPulseReporter = void 0;
// src/reporter/index.ts
const playwright_pulse_reporter_1 = __importDefault(require("./playwright-pulse-reporter"));
exports.PlaywrightPulseReporter = playwright_pulse_reporter_1.default;
// Export the reporter class as the default export for CommonJS compatibility
// and also as a named export for potential ES module consumers.
exports.default = playwright_pulse_reporter_1.default;
