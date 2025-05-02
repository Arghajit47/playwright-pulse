"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightPulseReporter = void 0;
// src/reporter/index.ts
const playwright_pulse_reporter_1 = require("./playwright-pulse-reporter");
Object.defineProperty(exports, "PlaywrightPulseReporter", { enumerable: true, get: function () { return playwright_pulse_reporter_1.PlaywrightPulseReporter; } });
// Export the reporter class as the default export for CommonJS compatibility
// and also as a named export for potential ES module consumers.
exports.default = playwright_pulse_reporter_1.PlaywrightPulseReporter;
// You can also export other related types or utilities if needed
__exportStar(require("../types"), exports); // Re-export shared types using relative path
__exportStar(require("../lib/report-types"), exports); // Re-export report types using relative path
