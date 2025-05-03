import { FullConfig, FullResult, Reporter, Suite } from "@playwright/test/reporter";
declare class PulseReporter implements Reporter {
    private report;
    onBegin(config: FullConfig, suite: Suite): void;
    onEnd(result: FullResult): void;
    private serializeSuite;
    private serializeTest;
    private serializeResult;
}
export default PulseReporter;
