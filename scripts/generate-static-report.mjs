#!/usr/bin/env node
// Using Node.js syntax compatible with `.mjs`
import * as fs from 'fs/promises';
import path from 'path';
// Use dynamic import forchalk as it's ESM only
let chalk;
try {
  chalk = (await import('chalk')).default;
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

// Default configuration (can be overridden by user's reporter options)
const DEFAULT_OUTPUT_DIR = 'pulse-report-output';
const DEFAULT_JSON_FILE = 'playwright-pulse-report.json';
const DEFAULT_HTML_FILE = 'playwright-pulse-static-report.html';

// Helper function to sanitize HTML content
function sanitizeHTML(str) {
  if (str === null || str === undefined) {
    return "";
  }
  // Basic sanitization, consider a library for production
  return String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Helper function to format duration
function formatDuration(ms) {
  if (ms === undefined || ms === null || ms < 0) return "0.0s";
  return (ms / 1000).toFixed(1) + "s";
}

// Helper function to format dates
function formatDate(dateStrOrDate) {
  if (!dateStrOrDate) return 'N/A';
  try {
    const date = new Date(dateStrOrDate);
    if (isNaN(date.getTime())) {
      return "Invalid Date";
    }
    return date.toLocaleString();
  } catch (e) {
    return "Invalid Date";
  }
}

// Function to generate class based on status
function getStatusClass(status) {
  switch (status) {
    case "passed":
      return "status-passed";
    case "failed":
      return "status-failed";
    case "skipped":
      return "status-skipped";
    default:
      return "";
  }
}

// Function to get status icon
function getStatusIcon(status) {
  switch (status) {
    case "passed":
      return "✅"; // Check mark
    case "failed":
      return "❌"; // Cross mark
    case "skipped":
      return "⏭️"; // Skip icon
    default:
      return "❓"; // Question mark
  }
}

// Function to generate pie chart SVG (simplified)
function generatePieChartSVG(data) {
  const { passed = 0, failed = 0, skipped = 0 } = data || {};
  const total = passed + failed + skipped;
  if (total === 0) {
    return '<div class="pie-chart-placeholder">No tests found</div>';
  }

  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const center = 70; // Center of the SVG (viewBox is 140x140)
  let currentAngle = -90; // Start from the top

  const segments = [
    { value: passed, color: "#28a745", label: "Passed" }, // Green
    { value: failed, color: "#dc3545", label: "Failed" }, // Red
    { value: skipped, color: "#ffc107", label: "Skipped" }, // Yellow
  ];

  const paths = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const percent = segment.value / total;
      const angle = percent * 360;
      const endAngle = currentAngle + angle;

      const startX = center + radius * Math.cos((Math.PI / 180) * currentAngle);
      const startY = center + radius * Math.sin((Math.PI / 180) * currentAngle);
      const endX = center + radius * Math.cos((Math.PI / 180) * endAngle);
      const endY = center + radius * Math.sin((Math.PI / 180) * endAngle);

      const largeArcFlag = angle > 180 ? 1 : 0;

      const pathData = `M ${startX},${startY} A ${radius},${radius} 0 ${largeArcFlag} 1 ${endX},${endY}`;
      currentAngle = endAngle;

      return `<path d="${pathData}" fill="none" stroke="${segment.color}" stroke-width="20" />`;
    })
    .join(""); // Correctly join array elements into a single string

  return `
    <svg viewBox="0 0 140 140" width="140" height="140" class="pie-chart-svg">
      ${paths}
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="pie-chart-total">
        ${total}
      </text>
      <text x="50%" y="65%" dominant-baseline="middle" text-anchor="middle" class="pie-chart-label">
        Tests
      </text>
    </svg>
  `;
}

// Function to generate the main HTML content
function generateHTML(reportData) {
  const { run, results } = reportData;
  const runSummary = run || {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    timestamp: new Date(),
  };
  const pieChartSVG = generatePieChartSVG(runSummary);

  // Group tests by suite
  const suites = results.reduce((acc, result) => {
    const suiteName = result.suiteName || "Default Suite";
    if (!acc[suiteName]) {
      acc[suiteName] = [];
    }
    acc[suiteName].push(result);
    return acc;
  }, {});

  // Define the HTML structure using template literals
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse Report</title>
    <style>
        body { font-family: sans-serif; margin: 0; background-color: #f8f9fa; color: #343a40; display: flex; }
        .container { max-width: 1200px; margin: 20px auto; padding: 20px; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); flex-grow: 1; }
        .header { border-bottom: 1px solid #dee2e6; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { margin: 0; font-size: 1.8em; color: #708090; } /* Slate Blue */
        .header .run-info { text-align: right; font-size: 0.9em; color: #6c757d; }
        .tabs { display: flex; border-bottom: 1px solid #dee2e6; margin-bottom: 20px; }
        .tab-button { padding: 10px 20px; cursor: pointer; border: none; background-color: transparent; font-size: 1em; margin-right: 5px; border-bottom: 3px solid transparent; }
        .tab-button.active { border-bottom-color: #008080; font-weight: bold; color: #008080; } /* Teal */
        .tab-content { display: none; animation: fadeIn 0.5s; }
        .tab-content.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .summary-card { background-color: #fff; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .summary-card h3 { margin: 0 0 10px; font-size: 1.1em; color: #6c757d; }
        .summary-card .value { font-size: 2em; font-weight: bold; }
        .status-passed .value { color: #28a745; }
        .status-failed .value { color: #dc3545; }
        .status-skipped .value { color: #ffc107; }
        .pie-chart-container { display: flex; flex-direction: column; align-items: center; background-color: #fff; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .pie-chart-container h3 { margin: 0 0 15px; font-size: 1.1em; color: #6c757d; }
        .pie-chart-svg { display: block; margin: 0 auto; }
        .pie-chart-total { font-size: 24px; font-weight: bold; fill: #343a40; }
        .pie-chart-label { font-size: 12px; fill: #6c757d; }
        .pie-chart-placeholder { color: #6c757d; font-style: italic; padding: 20px; }
        .filters { display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; }
        .filters input, .filters select { padding: 8px 12px; border: 1px solid #ced4da; border-radius: 4px; font-size: 0.9em; }
        .test-suite { margin-bottom: 25px; border: 1px solid #e9ecef; border-radius: 6px; overflow: hidden; }
        .suite-header { background-color: #f8f9fa; padding: 10px 15px; font-weight: bold; border-bottom: 1px solid #e9ecef; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .suite-header::after { content: '▼'; font-size: 0.8em; }
        .suite-header.collapsed::after { content: '►'; }
        .suite-content { display: block; }
        .suite-content.collapsed { display: none; }
        .test-result-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #f1f3f5; cursor: pointer; transition: background-color 0.2s; }
        .test-result-item:last-child { border-bottom: none; }
        .test-result-item:hover { background-color: #f1f3f5; }
        .test-result-item .name { flex-grow: 1; margin-right: 15px; font-size: 0.95em; }
        .test-result-item .status-badge { padding: 3px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; color: #fff; }
        .status-passed .status-badge { background-color: #28a745; }
        .status-failed .status-badge { background-color: #dc3545; }
        .status-skipped .status-badge { background-color: #ffc107; color: #343a40; }
        .test-result-item .duration { font-size: 0.9em; color: #6c757d; min-width: 50px; text-align: right; }
        .test-details { background-color: #f8f9fa; padding: 15px; margin-top: -1px; border-top: 1px solid #e9ecef; display: none; animation: slideDown 0.3s ease-out; }
        .test-details h3 { margin-top: 0; margin-bottom: 10px; font-size: 1.1em; color: #495057; border-bottom: 1px solid #dee2e6; padding-bottom: 5px; }
        .test-details p { margin: 5px 0; font-size: 0.9em; }
        .test-details strong { color: #495057; }
        .test-details pre { background-color: #e9ecef; padding: 10px; border-radius: 4px; font-size: 0.85em; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
        .test-details code { font-family: monospace; }
        .steps-list { list-style: none; padding: 0; margin: 10px 0 0; }
        .step-item { padding: 8px 0; border-bottom: 1px dashed #e0e0e0; font-size: 0.9em; }
        .step-item:last-child { border-bottom: none; }
        .step-title { display: flex; justify-content: space-between; align-items: center; }
        .step-duration { font-size: 0.9em; color: #6c757d; }
        .step-error { color: #dc3545; margin-top: 5px; font-size: 0.9em; padding-left: 20px; }
        .status-failed .step-title { color: #dc3545; }
        .status-skipped .step-title { color: #6c757d; }
        .attachments-section img, .attachments-section video { max-width: 100%; height: auto; margin-top: 10px; border: 1px solid #dee2e6; border-radius: 4px; }
        .attachments-section a { color: #007bff; text-decoration: none; }
        .attachments-section a:hover { text-decoration: underline; }
        @keyframes slideDown { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 1000px; /* Adjust as needed */ } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Playwright Pulse Report</h1>
            <div class="run-info">
                Generated: ${formatDate(new Date())}<br>
                Run Started: ${formatDate(runSummary.timestamp)}<br>
                Total Duration: ${formatDuration(runSummary.duration)}
            </div>
        </div>

        <div class="tabs">
            <button class="tab-button active" onclick="openTab('dashboard')">Dashboard</button>
            <button class="tab-button" onclick="openTab('testRuns')">Test Runs</button>
        </div>

        <!-- Dashboard Tab -->
        <div id="dashboard" class="tab-content active">
            <h2>Dashboard</h2>
            <div class="dashboard-grid">
                <div class="summary-card">
                    <h3>Total Tests</h3>
                    <div class="value">${runSummary.totalTests}</div>
                </div>
                <div class="summary-card status-passed">
                    <h3>Passed</h3>
                    <div class="value">${runSummary.passed}</div>
                </div>
                <div class="summary-card status-failed">
                    <h3>Failed</h3>
                    <div class="value">${runSummary.failed}</div>
                </div>
                <div class="summary-card status-skipped">
                    <h3>Skipped</h3>
                    <div class="value">${runSummary.skipped}</div>
                </div>
                <div class="pie-chart-container">
                   <h3>Test Status Distribution</h3>
                   ${pieChartSVG}
                 </div>
            </div>
        </div>

        <!-- Test Runs Tab -->
        <div id="testRuns" class="tab-content">
            <h2>Test Runs</h2>
            <div class="filters">
                <input type="text" id="searchInput" placeholder="Search by test name..." onkeyup="filterTests()">
                <select id="statusFilter" onchange="filterTests()">
                    <option value="all">All Statuses</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                </select>
            </div>
            <div id="test-suites-container">
                ${Object.entries(suites)
                  .map(
                    ([suiteName, tests]) => `
                    <div class="test-suite" data-suite-name="${sanitizeHTML(
                      suiteName
                    )}">
                        <div class="suite-header" onclick="toggleSuite(this)">
                           ${sanitizeHTML(suiteName)} (${tests.length} tests)
                        </div>
                        <div class="suite-content">
                            ${tests
                              .map((result) => {
                                const attachments = (result.screenshots || [])
                                  .concat(
                                    result.videoPath ? [result.videoPath] : []
                                  )
                                  .concat(
                                    result.tracePath ? [result.tracePath] : []
                                  );
                                const attachmentsHTML =
                                  attachments.length > 0
                                    ? `
                                    <h3>Attachments</h3>
                                    <div class="attachments-section">
                                        ${attachments
                                          .map((att) => {
                                            const isScreenshot =
                                              att.startsWith("data:image") ||
                                              att.endsWith(".png") ||
                                              att.endsWith(".jpg") ||
                                              att.endsWith(".jpeg");
                                            const isVideo =
                                              att.endsWith(".webm") ||
                                              att.endsWith(".mp4");
                                            const isTrace =
                                              att.endsWith(".zip");
                                            // Assume relative paths for non-data URIs
                                            const src = att.startsWith(
                                              "data:image"
                                            )
                                              ? att
                                              : att;

                                            if (isScreenshot) {
                                              return `<img src="${sanitizeHTML(
                                                src
                                              )}" alt="Screenshot" loading="lazy">`;
                                            } else if (isVideo) {
                                              // Provide a link, assuming the video is served relative to the HTML report
                                              return `<p><a href="${sanitizeHTML(
                                                src
                                              )}" target="_blank" rel="noopener noreferrer">View Video (${sanitizeHTML(
                                                path.basename(src)
                                              )})</a></p>`;
                                            } else if (isTrace) {
                                              return `<p><a href="${sanitizeHTML(
                                                src
                                              )}" download>Download Trace (${sanitizeHTML(
                                                path.basename(src)
                                              )})</a></p>`;
                                            }
                                            return "";
                                          })
                                          .join("")}
                                    </div>
                                `
                                    : "";

                                return `
                                <div class="test-result-item ${getStatusClass(
                                  result.status
                                )}" data-test-name="${sanitizeHTML(
                                  result.name
                                )}" data-status="${
                                  result.status
                                }" onclick="toggleDetails(this)">
                                    <div class="name">${sanitizeHTML(
                                      result.name
                                    )}</div>
                                    <div class="status-badge">${sanitizeHTML(
                                      result.status
                                    )}</div>
                                    <div class="duration">${formatDuration(
                                      result.duration
                                    )}</div>
                                </div>
                                <div class="test-details">
                                     <h3>Details</h3>
                                     <p><strong>Run ID:</strong> ${sanitizeHTML(
                                       result.runId
                                     )}</p>
                                     <p><strong>Suite:</strong> ${sanitizeHTML(
                                       result.suiteName || "N/A"
                                     )}</p>
                                     <p><strong>Started:</strong> ${formatDate(
                                       result.startTime
                                     )}</p>
                                     <p><strong>Ended:</strong> ${formatDate(
                                       result.endTime
                                     )}</p>
                                     <p><strong>Duration:</strong> ${formatDuration(
                                       result.duration
                                     )}</p>
                                     <p><strong>Retries:</strong> ${
                                       result.retries
                                     }</p>
                                     ${
                                       result.tags && result.tags.length > 0
                                         ? `<p><strong>Tags:</strong> ${result.tags
                                             .map(
                                               (tag) =>
                                                 `<span style="background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 0.8em;">${sanitizeHTML(
                                                   tag
                                                 )}</span>`
                                             )
                                             .join(" ")}</p>`
                                         : ""
                                     }

                                     ${
                                       result.errorMessage
                                         ? `
                                        <h3>Error</h3>
                                        <pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 200px; overflow-y: auto; background-color: #f1f3f5; border: 1px solid #dee2e6; padding: 10px; border-radius: 4px;"><code>${sanitizeHTML(
                                          result.errorMessage
                                        )}</code></pre>
                                        ${
                                          result.stackTrace
                                            ? `<pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 150px; overflow-y: auto; background-color: #f1f3f5; border: 1px solid #dee2e6; padding: 10px; border-radius: 4px; margin-top: 5px;"><code>${sanitizeHTML(
                                                result.stackTrace
                                              )}</code></pre>`
                                            : ""
                                        }
                                     `
                                         : ""
                                     }

                                     ${
                                       result.steps && result.steps.length > 0
                                         ? `
                                        <h3>Steps</h3>
                                        <ul class="steps-list">
                                            ${result.steps
                                              .map(
                                                (step) => `
                                                <li class="step-item ${getStatusClass(
                                                  step.status
                                                )}">
                                                    <div class="step-title">
                                                        <span>${getStatusIcon(
                                                          step.status
                                                        )} ${sanitizeHTML(
                                                  step.title
                                                )}</span>
                                                        <span class="step-duration">${formatDuration(
                                                          step.duration
                                                        )}</span>
                                                    </div>
                                                    ${
                                                      step.errorMessage
                                                        ? `<div class="step-error">${sanitizeHTML(
                                                            step.errorMessage
                                                          )}</div>`
                                                        : ""
                                                    }
                                                </li>
                                            `
                                              )
                                              .join("")}
                                        </ul>
                                     `
                                         : "<p>No steps recorded.</p>"
                                     }

                                     ${
                                       result.status === "failed" ||
                                       result.status === "skipped"
                                         ? attachmentsHTML
                                         : "<p>No attachments for passed tests.</p>"
                                     }

                                     ${
                                       result.codeSnippet
                                         ? `
                                        <h3>Code Snippet</h3>
                                        <pre><code>${sanitizeHTML(
                                          result.codeSnippet
                                        )}</code></pre>
                                     `
                                         : ""
                                     }
                                </div>
                            `; // Added closing backtick here
                              })
                              .join("")}
                        </div>
                    </div>
                `
                  )
                  .join("")}
            </div>
        </div>

        <script>
            function openTab(tabName) {
                const tabContents = document.querySelectorAll('.tab-content');
                tabContents.forEach(content => content.classList.remove('active'));
                const tabButtons = document.querySelectorAll('.tab-button');
                tabButtons.forEach(button => button.classList.remove('active'));

                document.getElementById(tabName).classList.add('active');
                document.querySelector(\`.tab-button[onclick="openTab('\${tabName}')"]\`).classList.add('active');
            }

            function toggleDetails(element) {
                const details = element.nextElementSibling;
                if (details && details.classList.contains('test-details')) {
                    details.style.display = details.style.display === 'block' ? 'none' : 'block';
                }
            }

            function toggleSuite(headerElement) {
                headerElement.classList.toggle('collapsed');
                const content = headerElement.nextElementSibling;
                if (content && content.classList.contains('suite-content')) {
                    content.classList.toggle('collapsed');
                }
            }

            function filterTests() {
                const searchTerm = document.getElementById('searchInput').value.toLowerCase();
                const statusFilter = document.getElementById('statusFilter').value;
                const suites = document.querySelectorAll('.test-suite');

                suites.forEach(suite => {
                    const tests = suite.querySelectorAll('.test-result-item');
                    let suiteVisible = false;
                    tests.forEach(test => {
                        const testName = test.getAttribute('data-test-name').toLowerCase();
                        const testStatus = test.getAttribute('data-status');
                        const details = test.nextElementSibling;

                        const nameMatch = testName.includes(searchTerm);
                        const statusMatch = (statusFilter === 'all' || testStatus === statusFilter);

                        if (nameMatch && statusMatch) {
                            test.style.display = 'flex';
                            if (details) details.style.display = 'none'; // Collapse details on filter change
                            suiteVisible = true;
                        } else {
                            test.style.display = 'none';
                             if (details) details.style.display = 'none';
                        }
                    });
                     // Show/hide suite based on whether any tests within it are visible
                    suite.style.display = suiteVisible ? 'block' : 'none';
                    // Ensure suite header is not collapsed if it becomes visible
                    const suiteHeader = suite.querySelector('.suite-header');
                    if (suiteVisible && suiteHeader && suiteHeader.classList.contains('collapsed')) {
                       // Optional: expand suite if filter makes it visible? Decide on UX.
                       // toggleSuite(suiteHeader);
                    }
                });
            }

             // Initial filter application if needed, or just rely on user interaction
             // filterTests();
             // Set initial active tab
            openTab('dashboard');
        </script>
    </div>
</body>
</html>
  `;

  return htmlContent;
}


// Main execution function
async function main() {
  // Determine the report input directory and file path
  // Assumes the script is run from the project root where pulse-report-output exists
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const reportJsonPath = path.resolve(outputDir, DEFAULT_JSON_FILE);
  const reportHtmlPath = path.resolve(outputDir, DEFAULT_HTML_FILE);

  console.log(
    chalk.blue(`Generating static report in directory: ${outputDir}`)
  );
  console.log(chalk.blue(`Reading report data from: ${reportJsonPath}`));

  let reportData;
  try {
    const jsonData = await fs.readFile(reportJsonPath, "utf-8");
    reportData = JSON.parse(jsonData);
    // Basic validation
    if (
      !reportData ||
      typeof reportData !== "object" ||
      !Array.isArray(reportData.results)
    ) {
      throw new Error("Invalid report JSON structure.");
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(
        chalk.red(`Error: Report JSON file not found at ${reportJsonPath}.`)
      );
      console.error(
        chalk.yellow(
          `Ensure Playwright tests ran with 'playwright-pulse-reporter' and the file was generated.`
        )
      );
    } else {
      console.error(
        chalk.red(`Error reading or parsing report JSON file: ${error.message}`)
      );
    }
    process.exit(1);
  }

  try {
    const htmlContent = generateHTML(reportData);
    await fs.writeFile(reportHtmlPath, htmlContent, "utf-8");
    console.log(
      chalk.green(
        `Static HTML report successfully generated at: ${reportHtmlPath}`
      )
    );
  } catch (error) {
    console.error(
      chalk.red(`Error generating or writing HTML report: ${error.message}`)
    );
    process.exit(1);
  }
}

// Execute the main function
main();
