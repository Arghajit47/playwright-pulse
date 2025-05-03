import fs from "fs";
import path from "path";
import {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

class PulseReporter implements Reporter {
  private report: any = {
    config: {},
    suites: [],
  };

  onBegin(config: FullConfig, suite: Suite) {
    this.report.config = {
      workers: config.workers,
    };

    this.report.suites.push(this.serializeSuite(suite));
  }

  onEnd(result: FullResult) {
    const reportPath = path.join(process.cwd(), "playwright-pulse-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(this.report, null, 2));
    console.log(`✅ Playwright Pulse Report written to ${reportPath}`);
  }

  private serializeSuite(suite: Suite): any {
    return {
      title: suite.title,
      file: suite.location?.file || "",
      location: suite.location || null,
      suites: suite.suites.map((s) => this.serializeSuite(s)),
      tests: suite.tests.map((t) => this.serializeTest(t)),
    };
  }

  private serializeTest(test: TestCase): any {
    return {
      testId: test.id,
      title: test.title,
      location: test.location,
      projectName: test.parent?.project()?.name || "unknown",
      annotations: test.annotations,
      expectedStatus: test.expectedStatus,
      timeout: test.timeout,
      results: test.results.map((r) => this.serializeResult(r)),
    };
  }

  private serializeResult(result: TestResult): any {
    return {
      status: result.status,
      duration: result.duration,
      error: result.error,
      steps: result.steps,
      stdout: result.stdout,
      stderr: result.stderr,
      retry: result.retry,
      attachments: result.attachments,
    };
  }
}

export default PulseReporter;
