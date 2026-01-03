import { test } from "@playwright/test";

// Define the valid severity levels type
export type PulseSeverityLevel =
  | "Minor"
  | "Low"
  | "Medium"
  | "High"
  | "Critical";

export const pulse = {
  /**
   * Sets the severity level for the current test.
   * * @param level - The severity level ('Minor' | 'Low' | 'Medium' | 'High' | 'Critical')
   * @example
   * test('Login', async () => {
   * pulse.severity('Critical');
   * });
   */
  severity: (level: PulseSeverityLevel) => {
    const validLevels = ["Minor", "Low", "Medium", "High", "Critical"];
    // Default to "Medium" if an invalid string is passed
    const selectedLevel = validLevels.includes(level) ? level : "Medium";

    // Add the annotation to Playwright's test info
    test.info().annotations.push({
      type: "pulse_severity",
      description: selectedLevel,
    });
  },
};
