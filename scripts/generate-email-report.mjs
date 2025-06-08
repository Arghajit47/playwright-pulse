#!/usr/bin/env node

import * as fs from "fs/promises";
import path from "path";
import { fork } from "child_process";
import { fileURLToPath } from "url";

// Use dynamic import for chalk as it's ESM only
let chalk;
try {
  chalk = (await import("chalk")).default;
} catch (e) {
  console.warn("Chalk could not be imported. Using plain console logs.");
  chalk = {
    green: (text) => text,
    red: (text) => text,
    yellow: (text) => text,
    blue: (text) => text,
    bold: (text) => text,
    gray: (text) => text,
  };
}

// Default configuration
const DEFAULT_OUTPUT_DIR = "pulse-report";
const DEFAULT_JSON_FILE = "playwright-pulse-report.json";
const MINIFIED_HTML_FILE = "pulse-email-summary.html"; // New minified report

// Helper functions
function sanitizeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (match) => {
    const replacements = {
      "&": "&", // Changed to & for HTML context
      "<": "<",
      ">": ">",
      '"': '"',
      "'": "'",
    };
    return replacements[match] || match;
  });
}

function capitalize(str) {
  if (!str) return "";
  return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

function formatDuration(ms) {
  if (ms === undefined || ms === null || ms < 0) return "0.0s";
  return (ms / 1000).toFixed(1) + "s";
}

function formatDate(dateStrOrDate) {
  if (!dateStrOrDate) return "N/A";
  try {
    const date = new Date(dateStrOrDate);
    if (isNaN(date.getTime())) return "Invalid Date";
    return (
      date.toLocaleDateString(undefined, {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
      }) +
      " " +
      date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    );
  } catch (e) {
    return "Invalid Date Format";
  }
}

function getStatusClass(status) {
  switch (String(status).toLowerCase()) {
    case "passed":
      return "status-passed";
    case "failed":
      return "status-failed";
    case "skipped":
      return "status-skipped";
    default:
      return "status-unknown";
  }
}

function getStatusIcon(status) {
  switch (String(status).toLowerCase()) {
    case "passed":
      return "✅";
    case "failed":
      return "❌";
    case "skipped":
      return "⏭️";
    default:
      return "❓";
  }
}

function generateMinifiedHTML(reportData) {
  const { run, results } = reportData;
  const runSummary = run || {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    timestamp: new Date().toISOString(),
  };

  const testsByBrowser = new Map();
  if (results && results.length > 0) {
    results.forEach((test) => {
      const browser = test.browser || "unknown";
      if (!testsByBrowser.has(browser)) {
        testsByBrowser.set(browser, []);
      }
      testsByBrowser.get(browser).push(test);
    });
  }

  function generateTestListHTML() {
    if (testsByBrowser.size === 0) {
      return '<p class="no-tests">No test results found in this run.</p>';
    }

    let html = "";
    testsByBrowser.forEach((tests, browser) => {
      html += `
        <div class="browser-section">
          <h2 class="browser-title">${sanitizeHTML(capitalize(browser))}</h2>
          <ul class="test-list">
      `;
      tests.forEach((test) => {
        const testFileParts = test.name.split(" > ");
        const testTitle =
          testFileParts[testFileParts.length - 1] || "Unnamed Test";
        html += `
            <li class="test-item ${getStatusClass(test.status)}">
              <span class="test-status-icon">${getStatusIcon(
                test.status
              )}</span>
              <span class="test-title-text" title="${sanitizeHTML(
                test.name
              )}">${sanitizeHTML(testTitle)}</span>
              <span class="test-status-label">${String(
                test.status
              ).toUpperCase()}</span>
            </li>
        `;
      });
      html += `
          </ul>
        </div>
      `;
    });
    return html;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse Summary Report</title>
    <style>
        :root {
            --primary-color: #2c3e50; /* Dark Blue/Grey */
            --secondary-color: #3498db; /* Bright Blue */
            --success-color: #2ecc71; /* Green */
            --danger-color: #e74c3c; /* Red */
            --warning-color: #f39c12; /* Orange */
            --light-gray-color: #ecf0f1; /* Light Grey */
            --medium-gray-color: #bdc3c7; /* Medium Grey */
            --dark-gray-color: #7f8c8d; /* Dark Grey */
            --text-color: #34495e; /* Dark Grey/Blue for text */
            --background-color: #f8f9fa;
            --card-background-color: #ffffff;
            --border-color: #dfe6e9;
            --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            --border-radius: 6px;
            --box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        body {
            font-family: var(--font-family);
            margin: 0;
            background-color: var(--background-color);
            color: var(--text-color);
            line-height: 1.6;
            font-size: 16px;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background-color: var(--card-background-color);
            padding: 25px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
        }
        .report-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 25px;
            flex-wrap: wrap;
        }
        .report-header-title {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .report-header h1 {
            margin: 0;
            font-size: 1.75em;
            font-weight: 600;
            color: var(--primary-color);
        }
        #report-logo {
            height: 36px;
            width: 36px;
        }
        .run-info {
            font-size: 0.9em;
            text-align: right;
            color: var(--dark-gray-color);
        }
        .run-info strong {
            color: var(--text-color);
        }
        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background-color: var(--card-background-color);
            border: 1px solid var(--border-color);
            border-left-width: 5px;
            border-left-color: var(--primary-color);
            border-radius: var(--border-radius);
            padding: 18px;
            text-align: center;
        }
        .stat-card h3 {
            margin: 0 0 8px;
            font-size: 1em;
            font-weight: 500;
            color: var(--dark-gray-color);
            text-transform: uppercase;
        }
        .stat-card .value {
            font-size: 2em;
            font-weight: 700;
            color: var(--primary-color);
        }
        .stat-card.passed { border-left-color: var(--success-color); }
        .stat-card.passed .value { color: var(--success-color); }
        .stat-card.failed { border-left-color: var(--danger-color); }
        .stat-card.failed .value { color: var(--danger-color); }
        .stat-card.skipped { border-left-color: var(--warning-color); }
        .stat-card.skipped .value { color: var(--warning-color); }

        .section-title {
            font-size: 1.5em;
            color: var(--primary-color);
            margin-top: 30px;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--secondary-color);
        }
        .browser-section {
            margin-bottom: 25px;
        }
        .browser-title {
            font-size: 1.25em;
            color: var(--text-color);
            margin-bottom: 10px;
            padding: 8px 0;
            border-bottom: 1px dashed var(--medium-gray-color);
        }
        .test-list {
            list-style-type: none;
            padding-left: 0;
        }
        .test-item {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            margin-bottom: 8px;
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius);
            background-color: #fff;
            transition: background-color 0.2s ease;
        }
        .test-item:hover {
            background-color: var(--light-gray-color);
        }
        .test-status-icon {
            font-size: 1.1em;
            margin-right: 10px;
        }
        .test-title-text {
            flex-grow: 1;
            font-size: 0.95em;
        }
        .test-status-label {
            font-size: 0.8em;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 4px;
            color: #fff;
            margin-left: 10px;
            min-width: 60px;
            text-align: center;
        }
        .test-item.status-passed .test-status-label { background-color: var(--success-color); }
        .test-item.status-failed .test-status-label { background-color: var(--danger-color); }
        .test-item.status-skipped .test-status-label { background-color: var(--warning-color); }
        .test-item.status-unknown .test-status-label { background-color: var(--dark-gray-color); }
        
        .no-tests {
            padding: 20px;
            text-align: center;
            color: var(--dark-gray-color);
            background-color: var(--light-gray-color);
            border-radius: var(--border-radius);
            font-style: italic;
        }
        .report-footer {
            padding: 15px 0;
            margin-top: 30px;
            border-top: 1px solid var(--border-color);
            text-align: center;
            font-size: 0.85em;
            color: var(--dark-gray-color);
        }
        .report-footer a {
            color: var(--secondary-color);
            text-decoration: none;
            font-weight: 600;
        }
        .report-footer a:hover {
            text-decoration: underline;
        }

        @media (max-width: 768px) {
            body { padding: 10px; font-size: 15px; }
            .container { padding: 20px; }
            .report-header { flex-direction: column; align-items: flex-start; gap: 10px; }
            .report-header h1 { font-size: 1.5em; }
            .run-info { text-align: left; }
            .summary-stats { grid-template-columns: 1fr 1fr; } /* Two cards per row on smaller screens */
        }
        @media (max-width: 480px) {
            .summary-stats { grid-template-columns: 1fr; } /* One card per row on very small screens */
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="report-header">
            <div class="report-header-title">
                <img id="report-logo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJMNCA3bDggNSA4LTUtOC01eiIgZmlsbD0iIzNmNTFiNSIvPjxwYXRoIGQ9Ik0xMiA2TDQgMTFsOCA1IDgtNS04LTV6IiBmaWxsPSIjNDI4NWY0Ii8+PHBhdGggZD0iTTEyIDEwbC04IDUgOCA1IDgtNS04LTV6IiBmaWxsPSIjM2Q1NWI0Ii8+PC9zdmc+" alt="Report Logo">
                <h1>Playwright Pulse Summary</h1>
            </div>
            <div class="run-info">
                <strong>Run Date:</strong> ${formatDate(
                  runSummary.timestamp
                )}<br>
                <strong>Total Duration:</strong> ${formatDuration(
                  runSummary.duration
                )}
            </div>
        </header>
        
        <section class="summary-section">
            <div class="summary-stats">
                <div class="stat-card">
                    <h3>Total Tests</h3>
                    <div class="value">${runSummary.totalTests}</div>
                </div>
                <div class="stat-card passed">
                    <h3>Passed</h3>
                    <div class="value">${runSummary.passed}</div>
                </div>
                <div class="stat-card failed">
                    <h3>Failed</h3>
                    <div class="value">${runSummary.failed}</div>
                </div>
                <div class="stat-card skipped">
                    <h3>Skipped</h3>
                    <div class="value">${runSummary.skipped || 0}</div>
                </div>
            </div>
        </section>

        <section class="test-results-section">
            <h1 class="section-title">Test Case Summary</h1>
            ${generateTestListHTML()}
        </section>
        
        <footer class="report-footer">
            <div style="display: inline-flex; align-items: center; gap: 0.5rem;">
                <span>Created by</span>
                <a href="https://github.com/Arghajit47" target="_blank" rel="noopener noreferrer">
                    Arghajit Singha
                </a>
            </div>
            <div style="margin-top: 0.3rem; font-size: 0.7rem;">Crafted with precision</div>
        </footer>
    </div>
    <script>
        // Global helper functions needed by the template (if any complex ones were used)
        // For this minified version, formatDuration and formatDate are primarily used during HTML generation server-side.
        // No client-side interactivity scripts are needed for this simple report.
        if (typeof formatDuration === 'undefined') {
             function formatDuration(ms) { // Fallback, though should be pre-rendered
                if (ms === undefined || ms === null || ms < 0) return "0.0s";
                return (ms / 1000).toFixed(1) + "s";
            }
        }
         if (typeof formatDate === 'undefined') { // Fallback
            function formatDate(dateStrOrDate) {
                if (!dateStrOrDate) return "N/A";
                try {
                    const date = new Date(dateStrOrDate);
                    if (isNaN(date.getTime())) return "Invalid Date";
                    return (
                    date.toLocaleDateString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit" }) +
                    " " +
                    date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                    );
                } catch (e) { return "Invalid Date Format"; }
            }
        }
    </script>
</body>
</html>
  `;
}

async function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const process = fork(scriptPath, [], {
      stdio: "inherit",
    });

    process.on("error", (err) => {
      console.error(chalk.red(`Failed to start script: ${scriptPath}`), err);
      reject(err);
    });

    process.on("exit", (code) => {
      if (code === 0) {
        console.log(chalk.green(`Script ${scriptPath} finished successfully.`));
        resolve();
      } else {
        const errorMessage = `Script ${scriptPath} exited with code ${code}.`;
        console.error(chalk.red(errorMessage));
        reject(new Error(errorMessage));
      }
    });
  });
}

async function main() {
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const reportJsonPath = path.resolve(outputDir, DEFAULT_JSON_FILE);
  const minifiedReportHtmlPath = path.resolve(outputDir, MINIFIED_HTML_FILE); // Path for the new minified HTML

  // Step 2: Load current run's data
  let currentRunReportData;
  try {
    const jsonData = await fs.readFile(reportJsonPath, "utf-8");
    currentRunReportData = JSON.parse(jsonData);
    if (
      !currentRunReportData ||
      typeof currentRunReportData !== "object" ||
      !currentRunReportData.results
    ) {
      throw new Error(
        "Invalid report JSON structure. 'results' field is missing or invalid."
      );
    }
    if (!Array.isArray(currentRunReportData.results)) {
      currentRunReportData.results = [];
      console.warn(
        chalk.yellow(
          "Warning: 'results' field in current run JSON was not an array. Treated as empty."
        )
      );
    }
  } catch (error) {
    console.error(
      chalk.red(
        `Critical Error: Could not read or parse main report JSON at ${reportJsonPath}: ${error.message}`
      )
    );
    process.exit(1);
  }

  // Step 3: Generate and write Minified HTML
  try {
    const htmlContent = generateMinifiedHTML(currentRunReportData); // Use the new generator
    await fs.writeFile(minifiedReportHtmlPath, htmlContent, "utf-8");
    console.log(
      chalk.green.bold(
        `🎉 Minified Pulse summary report generated successfully at: ${minifiedReportHtmlPath}`
      )
    );
    console.log(chalk.gray(`(This HTML file is designed to be lightweight)`));
  } catch (error) {
    console.error(
      chalk.red(`Error generating minified HTML report: ${error.message}`)
    );
    console.error(chalk.red(error.stack));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    chalk.red.bold(`Unhandled error during script execution: ${err.message}`)
  );
  console.error(err.stack);
  process.exit(1);
});
