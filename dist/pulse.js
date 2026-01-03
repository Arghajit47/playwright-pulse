"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pulse = void 0;
const test_1 = require("@playwright/test");
exports.pulse = {
    /**
     * Sets the severity level for the current test.
     * * @param level - The severity level ('Minor' | 'Low' | 'Medium' | 'High' | 'Critical')
     * @example
     * test('Login', async () => {
     * pulse.severity('Critical');
     * });
     */
    severity: (level) => {
        const validLevels = ["Minor", "Low", "Medium", "High", "Critical"];
        // Default to "Medium" if an invalid string is passed
        const selectedLevel = validLevels.includes(level) ? level : "Medium";
        // Add the annotation to Playwright's test info
        test_1.test.info().annotations.push({
            type: "pulse_severity",
            description: selectedLevel,
        });
    },
};
