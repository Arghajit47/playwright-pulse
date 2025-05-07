
# Playwright Pulse Reporter & Dashboard

This project provides both a custom Playwright reporter and a Next.js web dashboard to visualize your Playwright test results, now with support for **Playwright sharding** and an option for a **standalone HTML report**.

## How it Works

1.  **Reporter (`playwright-pulse-reporter.ts`):**
    *   A custom reporter that collects detailed results during your Playwright test run.
    *   **Sharding Support:** If tests are sharded, each shard process writes its results to a temporary file (`.pulse-shard-results-*.json`) in the specified output directory. The main reporter process then merges these files upon completion.
2.  **JSON Output:** On completion (`onEnd`), the reporter writes all collected (and potentially merged) data into a single `playwright-pulse-report.json` file in your project's specified output directory (defaults to `pulse-report` in the project root).
3.  **Next.js Dashboard (Option 2 - Interactive):** A web application built with Next.js that reads the final `playwright-pulse-report.json` file from the *dashboard project's root* and presents the test results in a dynamic, interactive dashboard interface.
4.  **Standalone HTML Report (Option 1 - Static):** A script (`generate-static-report.mjs`) that reads the `playwright-pulse-report.json` from the *Playwright project's output directory* (e.g., `pulse-report`) and generates a single, self-contained `playwright-pulse-static-report.html` file in the *same directory*. This static report mimics the key information and layout of the dashboard, including:
    *   Run summary metrics (Total, Passed, Failed, Skipped, Duration).
    *   Filtering controls for test results.
    *   List of individual test results with status, duration, name, suite, and errors.
    *   Expandable details for each test, including steps, error messages, stack traces, attachments (links), and source location.

## Setup

### 1. Install the Reporter Package

In your main Playwright project (the one containing your tests), install this reporter package:

```bash
npm install @arghajit/playwright-pulse-reporter --save-dev
# or
yarn add @arghajit/playwright-pulse-reporter --dev
# or
pnpm add @arghajit/playwright-pulse-reporter --save-dev
```

*(Replace `@arghajit/playwright-pulse-reporter` with the actual published package name if you customized it)*

### 2. Configure Playwright

In your `playwright.config.ts` (or `.js`) file, add the custom reporter to the `reporter` array:

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

// Define where the final report JSON and HTML should go
const PULSE_REPORT_DIR = path.resolve(__dirname, 'pulse-report'); // Example: a directory in your project root

export default defineConfig({
  // ... other configurations like projects, testDir, etc.

  // Define the output directory for Playwright's own artifacts (traces, screenshots)
  // This is separate from the Pulse reporter's output directory.
  outputDir: './test-results/',

  reporter: [
    ['list'], // Keep other reporters like 'list' or 'html' if desired

    // Add the Playwright Pulse Reporter
    ['@arghajit/playwright-pulse-reporter', {
        // Optional: Specify the output file name (defaults to 'playwright-pulse-report.json')
        // outputFile: 'my-custom-report-name.json',

        // REQUIRED: Specify the directory for the final JSON report
        // The static HTML report will also be generated here.
        // It's recommended to use an absolute path or one relative to the config file.
        outputDir: PULSE_REPORT_DIR
    }]
  ],

  // Enable sharding if needed
  // fullyParallel: true, // Often used with sharding
  // workers: process.env.CI ? 4 : undefined, // Example worker count

  // ... other configurations
});
```

**Explanation:**

*   `outputDir` in the main `defineConfig`: This is where Playwright stores its own artifacts like traces and screenshots.
*   `outputDir` inside the `@arghajit/playwright-pulse-reporter` options: This tells *our reporter* where to save the final `playwright-pulse-report.json`. Using a dedicated directory like `pulse-report` is **required** for the reporter and static report generation to work correctly.

### 3. Run Your Tests

Execute your Playwright tests as usual. This command works whether you use sharding or not:

```bash
npx playwright test
# or specific configurations like:
# npx playwright test --project=chromium --shard=1/3
```

The `@arghajit/playwright-pulse-reporter` will automatically handle sharding if Playwright is configured to use it. Upon completion, the final `playwright-pulse-report.json` will be generated in the directory you specified (e.g., `pulse-report`).

### 4. Generate the Static HTML Report (Option 1)

After your tests run and `playwright-pulse-report.json` is created, you can generate the standalone HTML report using the command provided by the package:

1.  **Navigate to your Playwright project directory** (the one where you ran the tests).
2.  **Run the generation command:**
    ```bash
    npx generate-pulse-report
    ```
    This command executes the `scripts/generate-static-report.mjs` script included in the `@arghajit/playwright-pulse-reporter` package. It reads the `pulse-report/playwright-pulse-report.json` file (relative to your current directory) and creates `pulse-report/playwright-pulse-static-report.html`.
3.  **Open the HTML file:** Open the generated `pulse-report/playwright-pulse-static-report.html` in your browser.

This HTML file is self-contained and provides a detailed, interactive dashboard-like overview suitable for sharing or archiving.

### 5. View the Next.js Dashboard (Option 2 - *Currently Part of the Same Project*)

**Note:** The Next.js dashboard is currently part of the reporter project itself. To view it:

1.  **Navigate to the Reporter/Dashboard Project:**
    ```bash
    cd path/to/playwright-pulse-reporter # The directory containing THIS dashboard code
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    # or yarn install or pnpm install
    ```
3.  **Copy the Report File:** Copy the `playwright-pulse-report.json` file generated by your tests (e.g., from your main project's `pulse-report` directory) into the **root directory** of *this dashboard project*.
    ```bash
    # Example: Copying from your main project to the dashboard project directory
    cp ../my-playwright-project/pulse-report/playwright-pulse-report.json ./
    ```
    **Tip for Development:** You can also use the `sample-report.json` file included in this project for development:
    ```bash
    cp sample-report.json ./playwright-pulse-report.json
    ```
4.  **Start the Dashboard:**
    ```bash
    npm run dev
    # or yarn dev or pnpm dev
    ```

This will start the Next.js dashboard (usually on `http://localhost:9002`).

**Alternatively, build and start for production:**

```bash
# Ensure the report JSON is in the root first
npm run build
npm run start
```

## Development (Contributing to this Project)

To work on the reporter or the dashboard itself:

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd playwright-pulse-reporter
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Build the reporter:** (Needed if you make changes to the reporter code)
    ```bash
    npm run build:reporter
    ```
4.  **Run the dashboard in development mode:**
    ```bash
    # Make sure a playwright-pulse-report.json exists in the root
    # Using the sample data:
    cp sample-report.json ./playwright-pulse-report.json
    npm run dev
    ```
5.  **Test static report generation:**
    ```bash
    # 1. Ensure playwright-pulse-report.json exists in pulse-report
    mkdir -p pulse-report
    cp sample-report.json pulse-report/playwright-pulse-report.json
    # 2. Run the generation script directly using node (or via the bin command)
    node ./scripts/generate-static-report.mjs
    # or
    # npx generate-pulse-report
    ```

## Key Files

*   `src/reporter/index.ts`: The entry point for the Playwright reporter logic (exports the class).
*   `src/reporter/playwright-pulse-reporter.ts`: The core Playwright reporter implementation (handles sharding, generates JSON).
*   `scripts/generate-static-report.mjs`: Script to generate the standalone HTML report (executed via `npx generate-pulse-report`).
*   `src/lib/data-reader.ts`: Server-side logic for reading the JSON report file (used by Next.js dashboard).
*   `src/lib/data.ts`: Data fetching functions used by the Next.js dashboard components.
*   `src/app/`: Contains the Next.js dashboard pages and components.
*   `pulse-report/playwright-pulse-report.json`: (Generated by the reporter in the *user's project*) The primary data source.
*   `pulse-report/playwright-pulse-static-report.html`: (Generated by the script in the *user's project*) The standalone HTML report.
*   `playwright-pulse-report.json`: (Manually copied to the *dashboard project root*) Used by the Next.js dashboard.
*   `sample-report.json`: (Included in this project) Dummy data for development/testing visualization.
