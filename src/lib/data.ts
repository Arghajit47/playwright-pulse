import type { TestResult, TestRun, TrendDataPoint, TestStep, TestStatus } from '@/types';

const generateId = () => Math.random().toString(36).substring(2, 15);

const createTestStep = (title: string, status: TestStatus, duration: number, hasError: boolean = false): TestStep => {
  const startTime = new Date(Date.now() - duration * 2 * Math.random());
  const endTime = new Date(startTime.getTime() + duration);
  return {
    id: generateId(),
    title,
    status,
    duration,
    startTime,
    endTime,
    errorMessage: hasError && status === 'failed' ? `Error in step: ${title}` : undefined,
    screenshot: hasError && status === 'failed' ? 'https://picsum.photos/300/200' : undefined,
  };
};

const createTestResult = (runId: string, status: TestStatus, name: string, suite: string): TestResult => {
  const duration = Math.floor(Math.random() * 5000) + 500; // 0.5s to 5.5s
  const startTime = new Date(Date.now() - duration * 2 * Math.random());
  const endTime = new Date(startTime.getTime() + duration);
  const hasError = status === 'failed';

  const steps: TestStep[] = [
    createTestStep('Navigate to login page', 'passed', 150),
    createTestStep('Enter username', 'passed', 100),
    createTestStep('Enter password', status === 'skipped' ? 'skipped' : 'passed', 100),
    createTestStep('Click login button', status === 'failed' ? 'failed' : status === 'skipped' ? 'skipped' : 'passed', 200, hasError),
    ...(status === 'passed' ? [createTestStep('Verify dashboard loads', 'passed', 300)] : []),
  ];

  const codeSnippet = `test('${name}', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#username', 'user');
  await page.fill('#password', 'pass');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/dashboard');
});`;

  return {
    id: generateId(),
    runId,
    name,
    suiteName: suite,
    status,
    duration,
    startTime,
    endTime,
    retries: status === 'failed' ? Math.floor(Math.random() * 3) : 0,
    steps,
    errorMessage: hasError ? 'Assertion failed: Expected URL to be "/dashboard"' : undefined,
    stackTrace: hasError ? `Error: Assertion failed: Expected URL to be "/dashboard"
    at /path/to/test.spec.ts:7:18
    at runTest (/path/to/node_modules/@playwright/test/lib/index.js:123:45)` : undefined,
    codeSnippet: hasError ? codeSnippet : undefined,
    screenshot: hasError ? 'https://picsum.photos/600/400' : undefined,
    video: hasError ? 'https://example.com/video.mp4' : undefined, // Placeholder
    tags: ['login', suite.toLowerCase()],
  };
};

const createTestRun = (id: string, date: Date, testCounts: { passed: number, failed: number, skipped: number }): TestRun => {
  const totalTests = testCounts.passed + testCounts.failed + testCounts.skipped;
  const duration = (testCounts.passed * 2000 + testCounts.failed * 4000 + testCounts.skipped * 500) * (Math.random() * 0.5 + 0.8); // Approximate duration
  return {
    id,
    timestamp: date,
    totalTests,
    passed: testCounts.passed,
    failed: testCounts.failed,
    skipped: testCounts.skipped,
    duration,
  };
};

// Generate Mock Data
const runs: TestRun[] = [];
const results: TestResult[] = [];
const trends: TrendDataPoint[] = [];

const suites = ['Authentication', 'Product Listing', 'Shopping Cart', 'Checkout'];
const numRuns = 10;

for (let i = 0; i < numRuns; i++) {
  const runId = `run-${i + 1}`;
  const runDate = new Date(Date.now() - (numRuns - i - 1) * 24 * 60 * 60 * 1000); // Spread runs over the last few days
  let runPassed = 0;
  let runFailed = 0;
  let runSkipped = 0;

  suites.forEach(suite => {
    const numTestsInSuite = Math.floor(Math.random() * 5) + 3; // 3-7 tests per suite
    for (let j = 0; j < numTestsInSuite; j++) {
      const rand = Math.random();
      let status: TestStatus;
      if (rand < 0.7 - i * 0.02) { // Success rate decreases slightly over runs
        status = 'passed';
        runPassed++;
      } else if (rand < 0.9 - i * 0.01) {
        status = 'failed';
        runFailed++;
      } else {
        status = 'skipped';
        runSkipped++;
      }
      results.push(createTestResult(runId, status, `Test Case ${j + 1} for ${suite}`, suite));
    }
  });

  const run = createTestRun(runId, runDate, { passed: runPassed, failed: runFailed, skipped: runSkipped });
  runs.push(run);
  trends.push({
    date: runDate.toISOString().split('T')[0],
    passed: runPassed,
    failed: runFailed,
    skipped: runSkipped,
  });
}

// --- Data Fetching Functions ---

export const getLatestTestRun = async (): Promise<TestRun | null> => {
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate network delay
  return runs.length > 0 ? runs[runs.length - 1] : null;
};

export const getTestResultsForRun = async (runId: string): Promise<TestResult[]> => {
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate network delay
  return results.filter(r => r.runId === runId);
};

export const getTestResultById = async (testId: string): Promise<TestResult | null> => {
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate network delay
  return results.find(r => r.id === testId) || null;
};

export const getTestRuns = async (limit: number = 10): Promise<TestRun[]> => {
  await new Promise(resolve => setTimeout(resolve, 80)); // Simulate network delay
  return runs.slice(-limit).reverse();
};

export const getTrendData = async (limit: number = 30): Promise<TrendDataPoint[]> => {
  await new Promise(resolve => setTimeout(resolve, 120)); // Simulate network delay
  return trends.slice(-limit);
};

// Add a function to get all test results (for overview page, might need pagination later)
export const getAllTestResults = async (): Promise<TestResult[]> => {
    await new Promise(resolve => setTimeout(resolve, 150)); // Simulate delay
    // For now, return all results from the latest run for simplicity
    const latestRunId = runs.length > 0 ? runs[runs.length - 1].id : null;
    if (!latestRunId) return [];
    return results.filter(r => r.runId === latestRunId);
};
