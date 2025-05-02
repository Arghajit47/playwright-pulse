#!/usr/bin/env node

import * as fs from "fs/promises";
import * as path from "path";
import { format } from "date-fns"; // For formatting dates

/**
 * @typedef {import('../src/types').TestStatus} TestStatus
 * @typedef {import('../src/types').TestRun} TestRun
 * @typedef {import('../src/types').TestResult} TestResult
 * @typedef {import('../src/lib/report-types').PlaywrightPulseReport} PlaywrightPulseReport
 */

// Configuration
const REPORT_DIR_NAME = "pulse-report-output";
const JSON_FILE_NAME = "playwright-pulse-report.json";
const HTML_FILE_NAME = "playwright-pulse-static-report.html";

// Get the current working directory where the command is executed
const CWD = process.cwd();
const reportDirPath = path.resolve(CWD, REPORT_DIR_NAME);
const reportJsonPath = path.resolve(reportDirPath, JSON_FILE_NAME);
const reportHtmlPath = path.resolve(reportDirPath, HTML_FILE_NAME);

// Helper function to generate CSS for status colors
const getStatusColor = (status) => {
  switch (status) {
    case "passed":
      return "#10B981"; // Emerald-500
    case "failed":
      return "#EF4444"; // Red-500
    case "skipped":
      return "#F59E0B"; // Amber-500
    default:
      return "#6B7280"; // Gray-500
  }
};

const getStatusIcon = (status) => {
  switch (status) {
    case "passed":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${getStatusColor(
        status
      )};"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    case "failed":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${getStatusColor(
        status
      )};"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    case "skipped":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${getStatusColor(
        status
      )};"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`;
    default:
      return "";
  }
};

const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * Generate the HTML content for the static report.
 * @param {PlaywrightPulseReport} data - The parsed report data.
 * @returns {string} - The HTML content.
 */
const generateHtmlContent = (data) => {
  const { run, results, metadata } = data;

  // --- Summary Section ---
  const summaryHtml = run
    ? `
    <div class="summary-grid">
      <div class="summary-card">
        <h3>Total Tests</h3>
        <p>${run.totalTests}</p>
      </div>
      <div class="summary-card">
        <h3 style="color: ${getStatusColor("passed")};">Passed</h3>
        <p>${run.passed}</p>
      </div>
      <div class="summary-card">
        <h3 style="color: ${getStatusColor("failed")};">Failed</h3>
        <p>${run.failed}</p>
      </div>
      <div class="summary-card">
        <h3 style="color: ${getStatusColor("skipped")};">Skipped</h3>
        <p>${run.skipped}</p>
      </div>
      <div class="summary-card">
        <h3>Duration</h3>
        <p>${formatDuration(run.duration)}</p>
      </div>
    </div>
    <p class="run-info">Run ID: ${run.id} | Timestamp: ${format(
        new Date(run.timestamp),
        "PP pp"
      )}</p>
  `
    : "<p>No run information available.</p>";

  // --- Results Section ---
  const resultsHtml =
    results.length > 0
      ? results
          .map(
            (result, index) => `
    <div class="result-item" data-status="${
      result.status
    }" onclick="toggleDetails('details-${index}')">
      <div class="result-header">
        <span class="status-icon" style="color: ${getStatusColor(
          result.status
        )};">${getStatusIcon(result.status)}</span>
        <span class="test-name">${result.name}</span>
        <span class="duration">${formatDuration(result.duration)}</span>
        <span class="status-text">${result.status}</span>
      </div>
      <div id="details-${index}" class="result-details" style="display: none;">
        ${
          result.suiteName
            ? `<p><strong>Suite:</strong> ${result.suiteName}</p>`
            : ""
        }
        <p><strong>Started:</strong> ${format(
          new Date(result.startTime),
          "pp"
        )}</p>
        <p><strong>Ended:</strong> ${format(new Date(result.endTime), "pp")}</p>
        ${
          result.retries > 0
            ? `<p><strong>Retries:</strong> ${result.retries}</p>`
            : ""
        }
        ${
          result.errorMessage
            ? `<p><strong>Error:</strong> <pre>${result.errorMessage}</pre></p>`
            : ""
        }
        ${
          result.stackTrace
            ? `<p><strong>Stack Trace:</strong> <pre>${result.stackTrace}</pre></p>`
            : ""
        }
        ${
          result.steps && result.steps.length > 0
            ? `
            <h4>Steps:</h4>
            <ul class="steps-list">
                ${result.steps
                  .map(
                    (step) => `
                    <li data-status="${step.status}">
                        <span class="status-icon" style="color: ${getStatusColor(
                          step.status
                        )};">${getStatusIcon(step.status)}</span>
                        ${step.title} (${formatDuration(step.duration)})
                        ${
                          step.errorMessage
                            ? `<pre class="step-error">${step.errorMessage}</pre>`
                            : ""
                        }
                    </li>
                `
                  )
                  .join("")}
            </ul>
        `
            : ""
        }
        ${
          result.screenshot
            ? `<p><strong>Screenshot:</strong> <a href="${result.screenshot}" target="_blank">View</a></p>`
            : ""
        }
        ${
          result.video
            ? `<p><strong>Video:</strong> <a href="${result.video}" target="_blank">View</a></p>`
            : ""
        }
      </div>
    </div>
  `
          )
          .join("")
      : "<p>No test results found.</p>";

  // --- Full HTML ---
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse - Static Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 20px; background-color: #f9fafb; color: #1f2937; }
        .container { max-width: 1200px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 20px; }
        h2 { color: #374151; margin-top: 30px; margin-bottom: 15px; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 15px; }
        .summary-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 15px; text-align: center; background-color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .summary-card h3 { margin: 0 0 5px 0; font-size: 0.9em; color: #6b7280; }
        .summary-card p { margin: 0; font-size: 1.5em; font-weight: 600; color: #111827; }
        .run-info { font-size: 0.85em; color: #6b7280; text-align: center; margin-bottom: 25px; }
        .result-item { border: 1px solid #e5e7eb; border-left-width: 4px; border-radius: 4px; margin-bottom: 10px; cursor: pointer; transition: background-color 0.2s; overflow: hidden; }
        .result-item:hover { background-color: #f3f4f6; }
        .result-item[data-status="passed"] { border-left-color: ${getStatusColor(
          "passed"
        )}; }
        .result-item[data-status="failed"] { border-left-color: ${getStatusColor(
          "failed"
        )}; }
        .result-item[data-status="skipped"] { border-left-color: ${getStatusColor(
          "skipped"
        )}; }
        .result-header { display: flex; align-items: center; padding: 10px 15px; gap: 10px; font-weight: 500; }
        .status-icon { display: inline-flex; align-items: center; }
        .test-name { flex-grow: 1; }
        .duration { font-size: 0.9em; color: #6b7280; margin-left: auto; padding-left: 10px; }
        .status-text { font-size: 0.9em; font-weight: 600; text-transform: capitalize; min-width: 60px; text-align: right; }
        .result-item[data-status="passed"] .status-text { color: ${getStatusColor(
          "passed"
        )}; }
        .result-item[data-status="failed"] .status-text { color: ${getStatusColor(
          "failed"
        )}; }
        .result-item[data-status="skipped"] .status-text { color: ${getStatusColor(
          "skipped"
        )}; }
        .result-details { padding: 10px 15px 15px 30px; border-top: 1px solid #e5e7eb; background-color: #fafafa; font-size: 0.9em; }
        .result-details p { margin: 5px 0; }
        .result-details h4 { margin-top: 15px; margin-bottom: 5px; font-weight: 600; }
        .result-details pre { background-color: #e5e7eb; padding: 8px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; font-size: 0.85em; margin-top: 3px; max-height: 200px; overflow-y: auto; }
        .steps-list { list-style: none; padding-left: 0; margin-top: 5px; }
        .steps-list li { padding: 4px 0 4px 10px; border-left: 2px solid #d1d5db; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
        .steps-list li[data-status="passed"] { border-left-color: ${getStatusColor(
          "passed"
        )}; }
        .steps-list li[data-status="failed"] { border-left-color: ${getStatusColor(
          "failed"
        )}; }
        .steps-list li[data-status="skipped"] { border-left-color: ${getStatusColor(
          "skipped"
        )}; }
        .step-error { background-color: #fee2e2; color: #991b1b; padding: 5px; border-radius: 3px; margin-top: 5px; }
        footer { margin-top: 30px; text-align: center; font-size: 0.8em; color: #9ca3af; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Playwright Pulse Report</h1>

        <h2>Run Summary</h2>
        ${summaryHtml}

        <h2>Test Results (${results.length})</h2>
        <div class="results-list">
            ${resultsHtml}
        </div>

        <footer>
            Generated by Playwright Pulse Reporter on ${format(
              new Date(),
              "PP pp"
            )}<br>
            Report data generated at: ${
              metadata.generatedAt
                ? format(new Date(metadata.generatedAt), "PP pp")
                : "N/A"
            }
        </footer>
    </div>

    <script>
        function toggleDetails(id) {
            const element = document.getElementById(id);
            if (element) {
                element.style.display = element.style.display === 'none' ? 'block' : 'none';
            }
        }
    </script>
</body>
</html>
  `;
};

/**
 * Main function to generate the static report.
 */
const generateReport = async () => {
  console.log(`Reading report data from: ${reportJsonPath}`);
  let reportData;

  try {
    const fileContent = await fs.readFile(reportJsonPath, "utf-8");

    // --- Date Reviver for JSON ---
    const reviveDates = (key, value) => {
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
      if (typeof value === "string" && isoDateRegex.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
      return value;
    };

    reportData = JSON.parse(fileContent, reviveDates);

    // Basic Validation
    if (!reportData || typeof reportData !== "object") {
      throw new Error("Report data is not a valid object.");
    }
    if (!reportData.metadata) {
      throw new Error("Report metadata is missing.");
    }
    if (!Array.isArray(reportData.results)) {
      reportData.results = []; // Ensure results is an array even if missing/null
    }
    // Ensure run is either null or an object
    if (reportData.run !== null && typeof reportData.run !== "object") {
      console.warn("Warning: Invalid 'run' data found, treating as null.");
      reportData.run = null;
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Report JSON file not found at ${reportJsonPath}.`);
      console.error(
        "Ensure Playwright tests ran with 'playwright-pulse-reporter' and the file was generated."
      );
    } else {
      console.error(
        `Error reading or parsing JSON report file: ${error.message}`
      );
    }
    process.exit(1); // Exit with error code
  }

  try {
    const htmlContent = generateHtmlContent(reportData);
    await fs.mkdir(reportDirPath, { recursive: true }); // Ensure directory exists
    await fs.writeFile(reportHtmlPath, htmlContent, "utf-8");
    console.log(
      `Static HTML report generated successfully at: ${reportHtmlPath}`
    );
  } catch (error) {
    console.error(`Error generating or writing HTML report: ${error.message}`);
    process.exit(1);
  }
};

// Execute the report generation
generateReport();
