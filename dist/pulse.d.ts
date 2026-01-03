export type PulseSeverityLevel = "Minor" | "Low" | "Medium" | "High" | "Critical";
export declare const pulse: {
    /**
     * Sets the severity level for the current test.
     * * @param level - The severity level ('Minor' | 'Low' | 'Medium' | 'High' | 'Critical')
     * @example
     * test('Login', async () => {
     * pulse.severity('Critical');
     * });
     */
    severity: (level: PulseSeverityLevel) => void;
};
