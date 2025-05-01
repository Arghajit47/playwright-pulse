
import type {
  FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import type { TestResult as PulseTestResult, TestRun as PulseTestRun, TestStatus as PulseTestStatus, TestStep as PulseTestStep, TrendDataPoint } from '@/types';

// Helper to convert Playwright status to Pulse status
const convertStatus = (status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'): PulseTestStatus => {
  if (status === 'passed') return 'passed';
  if (status === 'failed' || status === 'timedOut' || status === 'interrupted') return 'failed';
  return 'skipped';
};

// Structure for the final JSON report
interface PlaywrightPulseReport {
    run: PulseTestRun | null;
    results: PulseTestResult[];
    // Trends might need to be calculated/aggregated separately or stored historically
    // For now, we focus on the single run data.
    metadata: {
        generatedAt: string;
    };
}

class PlaywrightPulseReporter implements Reporter {
  private config!: FullConfig;
  private suite!: Suite;
  private results: PulseTestResult[] = [];
  private runStartTime!: number;
  private outputDir: string = '.'; // Default to current directory
  private outputFile: string = 'playwright-pulse-report.json';

  constructor(options: { outputFile?: string, outputDir?: string } = {}) {
    this.outputFile = options.outputFile ?? this.outputFile;
    this.outputDir = options.outputDir ?? path.resolve(process.cwd()); // Resolve outputDir based on cwd
    console.log(`PlaywrightPulseReporter: Output configured to ${path.join(this.outputDir, this.outputFile)}`);
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.runStartTime = Date.now();
    console.log(`PlaywrightPulseReporter: Starting test run with ${suite.allTests().length} tests.`);
  }

  onTestBegin(test: TestCase): void {
    // Optional: Log test start
     // console.log(`Starting test: ${test.title}`);
  }

   private processStep(step: TestStep, parentStatus: PulseTestStatus): PulseTestStep {
       const status = convertStatus(step.error ? 'failed' : 'passed'); // Simplified step status
       const effectiveStatus = parentStatus === 'skipped' ? 'skipped' : status;
       const duration = step.duration;
       const startTime = new Date(step.startTime);
       const endTime = new Date(startTime.getTime() + duration);

       return {
            id: step.title + startTime.toISOString(), // Simple unique ID for step
            title: step.title,
            status: effectiveStatus, // A step can't pass if the test is skipped
            duration: duration,
            startTime: startTime,
            endTime: endTime,
            errorMessage: step.error?.message,
            // We won't embed screenshots directly, maybe paths later
            screenshot: undefined,
       };
   }


  onTestEnd(test: TestCase, result: TestResult): void {
    const testStatus = convertStatus(result.status);
    const startTime = new Date(result.startTime);
    const endTime = new Date(startTime.getTime() + result.duration);

    const processAllSteps = (steps: TestStep[], parentStatus: PulseTestStatus): PulseTestStep[] => {
       let processed: PulseTestStep[] = [];
       for (const step of steps) {
           processed.push(this.processStep(step, parentStatus));
           if (step.steps.length > 0) {
               processed = processed.concat(processAllSteps(step.steps, parentStatus)); // Recursively process nested steps
           }
       }
       return processed;
    }

    const pulseResult: PulseTestResult = {
      id: test.id,
      runId: 'current-run', // Placeholder, will be updated in onEnd
      name: test.title,
      suiteName: test.parent.title,
      status: testStatus,
      duration: result.duration,
      startTime: startTime,
      endTime: endTime,
      retries: result.retry,
      steps: processAllSteps(result.steps, testStatus),
      errorMessage: result.error?.message,
      stackTrace: result.error?.stack,
      // codeSnippet: undefined, // Playwright doesn't easily expose the exact test code here
       screenshot: result.attachments.find(a => a.name === 'screenshot')?.path,
       video: result.attachments.find(a => a.name === 'video')?.path,
      tags: test.tags.map(tag => tag.startsWith('@') ? tag.substring(1) : tag),
    };
    this.results.push(pulseResult);
    // console.log(`Finished test: ${test.title} - ${result.status}`);
  }

  onError(error: any): void {
    console.error('PlaywrightPulseReporter: Error during test run:', error);
  }

  async onEnd(result: FullResult): Promise<void> {
    const runEndTime = Date.now();
    const duration = runEndTime - this.runStartTime;
    const runStatus = convertStatus(result.status);

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    this.results.forEach(r => {
      if (r.status === 'passed') passed++;
      else if (r.status === 'failed') failed++;
      else skipped++;
    });

     // Assign a consistent runId
     const runId = `run-${this.runStartTime}`;
     this.results.forEach(r => r.runId = runId);

    const runData: PulseTestRun = {
      id: runId,
      timestamp: new Date(this.runStartTime),
      totalTests: this.results.length,
      passed,
      failed,
      skipped,
      duration,
    };

    const report: PlaywrightPulseReport = {
        run: runData,
        results: this.results,
        metadata: {
            generatedAt: new Date().toISOString(),
        }
    };

    console.log(`PlaywrightPulseReporter: Test run finished with status: ${result.status}`);
    console.log(`  Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
    console.log(`  Total time: ${(duration / 1000).toFixed(2)}s`);

    const finalOutputPath = path.join(this.outputDir, this.outputFile);

    try {
      // Ensure the output directory exists
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        console.log(`PlaywrightPulseReporter: Created output directory: ${this.outputDir}`);
      }

      fs.writeFileSync(finalOutputPath, JSON.stringify(report, null, 2));
      console.log(`PlaywrightPulseReporter: Report written to ${finalOutputPath}`);
    } catch (error) {
      console.error(`PlaywrightPulseReporter: Failed to write report to ${finalOutputPath}`, error);
    }
  }
}

export default PlaywrightPulseReporter;
