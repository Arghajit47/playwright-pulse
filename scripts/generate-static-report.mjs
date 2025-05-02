#!/usr/bin/env node
// scripts/generate-static-report.mjs
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Helper Functions ---

// Basic HTML sanitizer to prevent XSS and template literal issues
const sanitizeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#96;'); // Escape backticks specifically for template literals
};

const formatDate = (dateStr) => {
  if (!dateStr) return "N/A";
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? "Invalid Date" : date.toLocaleString();
  } catch (e) {
    return "Invalid Date";
  }
};

const formatDuration = (ms) => {
  if (ms === null || ms === undefined || isNaN(ms)) return "N/A";
  if (ms < 0) ms = 0;
  return (ms / 1000).toFixed(2) + "s";
};

const getStatusClass = (status) => {
  switch (status) {
    case "passed":
      return "status-passed";
    case "failed":
      return "status-failed";
    case "skipped":
      return "status-skipped";
    default:
      return "status-unknown";
  }
};

const getStatusIcon = (status) => {
  switch (status) {
    case "passed":
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15l-5-5l1.41-1.41L10 16.17l7.59-7.59L19 10z"/></svg>'; // Check Circle
    case "failed":
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17L12 13.41L8.41 17L7 15.59L10.59 12L7 8.41L8.41 7L12 10.59L15.59 7L17 8.41L13.41 12z"/></svg>'; // X Circle
    case "skipped":
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M6 18V6h2v12zm4 0l9-6l-9-6z"/></svg>'; // Skip Forward
    default:
      return "❓";
  }
};

const getStatusColor = (status) => {
  switch (status) {
    case "passed":
      return "#22c55e"; // green-500
    case "failed":
      return "#ef4444"; // red-500
    case "skipped":
      return "#eab308"; // yellow-500
    default:
      return "#6b7280"; // gray-500
  }
};

// Function to generate the pie chart SVG
const generatePieChartSVG = (runData, size = 150) => {
  if (!runData || runData.totalTests === 0) {
    return `<div style="text-align: center; padding: 20px; color: #6b7280;">No test data for chart</div>`;
  }

  const { passed, failed, skipped, totalTests } = runData;
  const data = [
    { status: "passed", value: passed, color: getStatusColor("passed") },
    { status: "failed", value: failed, color: getStatusColor("failed") },
    { status: "skipped", value: skipped, color: getStatusColor("skipped") },
  ].filter((d) => d.value > 0);

  const radius = size / 2;
  const cx = radius;
  const cy = radius;
  let startAngle = -90; // Start from top

  const paths = data.map((segment) => {
    const angle = (segment.value / totalTests) * 360;
    const endAngle = startAngle + angle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const largeArcFlag = angle > 180 ? 1 : 0;

    const d = [
      `M ${cx},${cy}`, // Move to center
      `L ${x1},${y1}`, // Line to start point
      `A ${radius},${radius} 0 ${largeArcFlag},1 ${x2},${y2}`, // Arc to end point
      "Z", // Close path
    ].join(" ");

    startAngle = endAngle;

    return `<path d="${d}" fill="${segment.color}" data-status="${segment.status}" data-value="${segment.value}"></path>`;
  });

  // Add central text
  const centralText = `
        <text x="${cx}" y="${cy}" dominant-baseline="middle" text-anchor="middle" font-size="24" font-weight="bold" fill="#1f2937">
            ${totalTests}
        </text>
         <text x="${cx}" y="${
    cy + 20
  }" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#6b7280">
            Tests
        </text>
    `;

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths.join(
    ""
  )}${centralText}</svg>`;
};

// Function to generate HTML for test result details
const generateTestResultDetailsHTML = (result) => {
  // Sanitize all potentially problematic string inputs first
  const runId = sanitizeHTML(result.runId);
  const suiteName = sanitizeHTML(result.suiteName || "N/A");
  const errorMessage = sanitizeHTML(result.errorMessage);
  const stackTrace = sanitizeHTML(result.stackTrace);
  const codeSnippet = sanitizeHTML(result.codeSnippet);
  const tagsHTML =
    result.tags && result.tags.length > 0
      ? `<p><strong>Tags:</strong> ${result.tags
          .map((tag) => `<span class="tag">${sanitizeHTML(tag)}</span>`)
          .join(" ")}</p>`
      : "";

  const errorHTML = result.errorMessage
    ? `
            <h3>Error</h3>
            <pre class="error-message"><code>${errorMessage}</code></pre>
            ${
              stackTrace
                ? `<pre class="stack-trace"><code>${stackTrace}</code></pre>`
                : ""
            }
          `
    : "";

  const stepsHTML =
    result.steps && result.steps.length > 0
      ? `
            <h3>Steps</h3>
            <ul class="steps-list">
                ${result.steps
                  .map(
                    (step) => `
                    <li class="step-item ${getStatusClass(step.status)}">
                        <div class="step-title">
                            <span class="step-icon-title">${getStatusIcon(
                              step.status
                            )} ${sanitizeHTML(step.title)}</span>
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
      : "<p>No steps recorded.</p>";

  const attachmentsHTML = `
        <h3>Attachments</h3>
        ${
          (result.screenshots && result.screenshots.length > 0) ||
          result.videoPath ||
          result.tracePath
            ? `
                ${
                  result.screenshots
                    ?.map(
                      (screenshot, index) => `
                    <div class="attachment">
                        <strong>Screenshot ${index + 1}:</strong><br>
                        ${
                          screenshot.startsWith("data:image")
                            ? `<img src="${screenshot}" alt="Screenshot ${
                                index + 1
                              }" style="max-width: 100%; height: auto; border: 1px solid #ccc; margin-top: 5px;">`
                            : `<a href="${sanitizeHTML(
                                screenshot
                              )}" target="_blank" rel="noopener noreferrer">${sanitizeHTML(
                                screenshot
                              )}</a> (Link)`
                        }
                    </div>
                `
                    )
                    .join("") || ""
                }
                ${
                  result.videoPath
                    ? `<div class="attachment"><strong>Video:</strong> <a href="${sanitizeHTML(
                        result.videoPath
                      )}" target="_blank" rel="noopener noreferrer">${sanitizeHTML(
                        result.videoPath
                      )}</a></div>`
                    : ""
                }
                ${
                  result.tracePath
                    ? `<div class="attachment"><strong>Trace:</strong> <a href="${sanitizeHTML(
                        result.tracePath
                      )}" target="_blank" rel="noopener noreferrer">${sanitizeHTML(
                        result.tracePath
                      )}</a></div>`
                    : ""
                }
              `
            : "<p>No attachments available.</p>"
        }
    `;

  const codeSnippetHTML = result.codeSnippet
    ? `
            <h3>Code Snippet</h3>
            <pre class="code-snippet"><code>${codeSnippet}</code></pre>
          `
    : "";

  return `
        <div class="test-details">
            <h3>Details</h3>
            <p><strong>Run ID:</strong> ${runId}</p>
            <p><strong>Suite:</strong> ${suiteName}</p>
            <p><strong>Started:</strong> ${formatDate(result.startTime)}</p>
            <p><strong>Ended:</strong> ${formatDate(result.endTime)}</p>
            <p><strong>Duration:</strong> ${formatDuration(result.duration)}</p>
            <p><strong>Retries:</strong> ${result.retries}</p>
            ${tagsHTML}
            ${errorHTML}
            ${stepsHTML}
            ${attachmentsHTML}
            ${codeSnippetHTML}
        </div>
    `;
};


// Function to generate the full HTML content
const generateHTML = (reportData) => {
  const { run, results, metadata } = reportData;
  const generatedAt = formatDate(metadata?.generatedAt);
  const runTimestamp = run ? formatDate(run.timestamp) : "N/A";
  const runDuration = run ? formatDuration(run.duration) : "N/A";

  const summaryMetricsHTML = run
    ? `
        <div class="summary-grid">
            <div class="summary-card"><h4>Total Tests</h4><p>${run.totalTests}</p></div>
            <div class="summary-card status-passed"><h4>Passed</h4><p>${run.passed}</p></div>
            <div class="summary-card status-failed"><h4>Failed</h4><p>${run.failed}</p></div>
            <div class="summary-card status-skipped"><h4>Skipped</h4><p>${run.skipped}</p></div>
        </div>
    `
    : "<p>No run summary available.</p>";

  const pieChartHTML = run
    ? `
        <div class="chart-container">
            <h4>Test Status Distribution</h4>
            ${generatePieChartSVG(run)}
             <div class="chart-legend">
                <span class="legend-item status-passed">Passed (${
                  run.passed
                })</span>
                <span class="legend-item status-failed">Failed (${
                  run.failed
                })</span>
                <span class="legend-item status-skipped">Skipped (${
                  run.skipped
                })</span>
            </div>
        </div>
    `
    : "";

  const testResultsHTML = results
    .map(
      (result) => `
        <div class="test-result-item ${getStatusClass(
          result.status
        )}" data-suite="${sanitizeHTML(
        result.suiteName || "Default Suite"
      )}" data-status="${result.status}" data-name="${sanitizeHTML(
        result.name.toLowerCase()
      )}">
            <div class="test-result-header" onclick="toggleDetails(this)">
                <span class="test-status-icon">${getStatusIcon(
                  result.status
                )}</span>
                <span class="test-name">${sanitizeHTML(result.name)}</span>
                <span class="test-duration">${formatDuration(
                  result.duration
                )}</span>
                <span class="test-suite-name">(${sanitizeHTML(
                  result.suiteName || "Default Suite"
                )})</span>
                <span class="expand-icon">▶</span>
            </div>
            <div class="test-result-details" style="display: none;">
                ${generateTestResultDetailsHTML(result)}
            </div>
        </div>
    `
    )
    .join("");

  // Group results by suite
  const resultsBySuite = results.reduce((acc, result) => {
    const suite = result.suiteName || "Default Suite";
    if (!acc[suite]) {
      acc[suite] = [];
    }
    acc[suite].push(result);
    return acc;
  }, {});

  const testRunsBySuiteHTML = Object.entries(resultsBySuite)
    .map(
      ([suite, suiteResults]) => `
        <div class="suite-group">
            <h3 class="suite-title">${sanitizeHTML(suite)} (${
        suiteResults.length
      } tests)</h3>
            <div class="suite-results">
                ${suiteResults
                  .map(
                    (result) => `
                    <div class="test-result-item ${getStatusClass(
                      result.status
                    )}" data-suite="${sanitizeHTML(
                      result.suiteName || "Default Suite"
                    )}" data-status="${
                      result.status
                    }" data-name="${sanitizeHTML(result.name.toLowerCase())}">
                        <div class="test-result-header" onclick="toggleDetails(this)">
                            <span class="test-status-icon">${getStatusIcon(
                              result.status
                            )}</span>
                            <span class="test-name">${sanitizeHTML(
                              result.name
                            )}</span>
                            <span class="test-duration">${formatDuration(
                              result.duration
                            )}</span>
                             <span class="expand-icon">▶</span>
                        </div>
                         <div class="test-result-details" style="display: none;">
                             ${generateTestResultDetailsHTML(result)}
                         </div>
                    </div>
                `
                  )
                  .join("")}
            </div>
        </div>
    `
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse - Static Report</title>
    <style>
        body { font-family: sans-serif; margin: 0; background-color: #f9fafb; color: #1f2937; line-height: 1.6; }
        .container { max-width: 1200px; margin: 20px auto; padding: 20px; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        header { padding-bottom: 15px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px; }
        header h1 { margin: 0; font-size: 1.8em; color: #708090; /* Slate Blue */ }
        header p { margin: 5px 0 0; color: #6b7280; font-size: 0.9em; }
        nav { margin-bottom: 20px; background-color: #e5e7eb; border-radius: 6px; padding: 5px; }
        nav button { background-color: transparent; border: none; padding: 10px 15px; cursor: pointer; font-size: 1em; border-radius: 4px; transition: background-color 0.2s; }
        nav button.active { background-color: #708090; color: white; }
        nav button:not(.active):hover { background-color: #d1d5db; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .summary-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 15px; text-align: center; background-color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .summary-card h4 { margin: 0 0 5px; font-size: 0.9em; color: #6b7280; }
        .summary-card p { margin: 0; font-size: 1.5em; font-weight: bold; }
        .summary-card.status-passed p { color: #10b981; }
        .summary-card.status-failed p { color: #ef4444; }
        .summary-card.status-skipped p { color: #f59e0b; }
        .chart-container { margin-bottom: 20px; text-align: center; border: 1px solid #e5e7eb; border-radius: 6px; padding: 20px; background-color: #fff; }
        .chart-container h4 { margin: 0 0 15px; font-size: 1.1em; color: #374151; }
        .chart-legend { margin-top: 15px; display: flex; justify-content: center; gap: 15px; font-size: 0.9em; }
        .legend-item { display: inline-flex; align-items: center; }
        .legend-item::before { content: ''; display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 5px; }
        .legend-item.status-passed::before { background-color: ${getStatusColor(
          "passed"
        )}; }
        .legend-item.status-failed::before { background-color: ${getStatusColor(
          "failed"
        )}; }
        .legend-item.status-skipped::before { background-color: ${getStatusColor(
          "skipped"
        )}; }
        .filters { display: flex; gap: 15px; margin-bottom: 20px; padding: 15px; background-color: #f3f4f6; border-radius: 6px; }
        .filters label { font-weight: bold; margin-right: 5px; }
        .filters input, .filters select { padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.9em; }
        .filters input { flex-grow: 1; }
        .test-results-list, .test-runs-list { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
        .suite-group { margin-bottom: 20px; }
        .suite-title { background-color: #f3f4f6; padding: 10px 15px; font-size: 1.1em; font-weight: bold; border-bottom: 1px solid #e5e7eb; }
        .suite-results .test-result-item:first-child .test-result-header { border-top: none; }
        .test-result-item { /* No border here */ }
        .test-result-header { display: flex; align-items: center; padding: 12px 15px; cursor: pointer; background-color: #fff; transition: background-color 0.2s; border-top: 1px solid #e5e7eb; }
        .test-result-header:hover { background-color: #f9fafb; }
        .test-status-icon { display: inline-flex; margin-right: 8px; width: 1.2em; height: 1.2em; }
        .test-status-icon svg { width: 100%; height: 100%; }
        .test-name { font-weight: 500; flex-grow: 1; margin-right: 10px; }
        .test-duration { font-size: 0.9em; color: #6b7280; margin-right: 10px; }
        .test-suite-name { font-size: 0.8em; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
        .expand-icon { margin-left: auto; font-size: 0.8em; transition: transform 0.2s; }
        .test-result-header.open .expand-icon { transform: rotate(90deg); }
        .test-result-details { display: none; padding: 15px; border-top: 1px dashed #e5e7eb; background-color: #f9fafb; }
        .test-result-details h3 { font-size: 1.1em; margin: 15px 0 10px; padding-bottom: 5px; border-bottom: 1px solid #ccc; }
        .test-result-details h3:first-child { margin-top: 0; }
        .test-result-details p { margin: 5px 0; }
        .steps-list { list-style: none; padding: 0; margin: 0; }
        .step-item { padding: 8px 0; border-bottom: 1px solid #eee; }
        .step-item:last-child { border-bottom: none; }
        .step-title { display: flex; justify-content: space-between; align-items: center; font-size: 0.95em; }
        .step-icon-title { display: flex; align-items: center; gap: 5px; }
        .step-duration { font-size: 0.85em; color: #6b7280; }
        .step-error { color: #ef4444; font-size: 0.9em; margin-top: 4px; padding-left: 20px; }
        .attachment { margin-bottom: 10px; }
        .attachment img { max-width: 100%; height: auto; border: 1px solid #ccc; margin-top: 5px; }
        .tag { background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; display: inline-block; margin-right: 5px; }
        pre { background-color: #f3f4f6; padding: 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; font-size: 0.9em; line-height: 1.4; }
        code { font-family: 'Courier New', Courier, monospace; }
        .status-passed .test-result-header { border-left: 4px solid ${getStatusColor(
          "passed"
        )}; }
        .status-failed .test-result-header { border-left: 4px solid ${getStatusColor(
          "failed"
        )}; }
        .status-skipped .test-result-header { border-left: 4px solid ${getStatusColor(
          "skipped"
        )}; }
        .status-passed .step-title { color: #10b981; }
        .status-failed .step-title { color: #ef4444; }
        .status-skipped .step-title { color: #f59e0b; }
        .status-passed .step-icon-title svg path { fill: #10b981; }
        .status-failed .step-icon-title svg path { fill: #ef4444; }
        .status-skipped .step-icon-title svg path { fill: #f59e0b; }
        footer { text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 0.85em; color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Playwright Pulse Report</h1>
            <p>Run ID: ${
              run ? sanitizeHTML(run.id) : "N/A"
            } | Timestamp: ${runTimestamp} | Duration: ${runDuration} | Generated: ${generatedAt}</p>
        </header>

        <nav>
            <button id="tab-btn-dashboard" class="active" onclick="switchTab('dashboard')">Dashboard</button>
            <button id="tab-btn-testruns" onclick="switchTab('testruns')">Test Runs</button>
        </nav>

        <div id="tab-content-dashboard" class="tab-content active">
            <h2>Dashboard</h2>
            ${summaryMetricsHTML}
            ${pieChartHTML}
        </div>

        <div id="tab-content-testruns" class="tab-content">
            <h2>Test Runs</h2>
            <div class="filters">
                <input type="search" id="searchInput" placeholder="Search by test name..." oninput="filterTests()">
                <select id="statusFilter" onchange="filterTests()">
                    <option value="all">All Statuses</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                </select>
            </div>
            <div id="testRunsList" class="test-runs-list">
                ${testRunsBySuiteHTML}
            </div>
             <div id="noResultsMessage" style="text-align: center; padding: 20px; color: #6b7280; display: none;">
                No tests found matching your criteria.
            </div>
        </div>

        <footer>
            Report generated by Playwright Pulse Reporter
        </footer>
    </div>

    <script>
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));
            document.getElementById(\`tab-content-\${tabId}\`).classList.add('active');
            document.getElementById(\`tab-btn-\${tabId}\`).classList.add('active');
        }

        function toggleDetails(headerElement) {
            const detailsElement = headerElement.nextElementSibling;
            const iconElement = headerElement.querySelector('.expand-icon');
            if (detailsElement.style.display === 'none') {
                detailsElement.style.display = 'block';
                headerElement.classList.add('open');
                 iconElement.style.transform = 'rotate(90deg)';
            } else {
                detailsElement.style.display = 'none';
                headerElement.classList.remove('open');
                 iconElement.style.transform = 'rotate(0deg)';
            }
        }

        function filterTests() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const statusFilter = document.getElementById('statusFilter').value;
            const testItems = document.querySelectorAll('#testRunsList .test-result-item');
            let hasVisibleItems = false;

            testItems.forEach(item => {
                const testName = item.getAttribute('data-name');
                const testStatus = item.getAttribute('data-status');

                const nameMatch = testName.includes(searchTerm);
                const statusMatch = statusFilter === 'all' || testStatus === statusFilter;

                if (nameMatch && statusMatch) {
                    item.style.display = '';
                    // Make sure the parent suite group is visible if any item inside matches
                     const suiteGroup = item.closest('.suite-group');
                     if (suiteGroup) suiteGroup.style.display = '';
                     hasVisibleItems = true;
                } else {
                    item.style.display = 'none';
                }
            });

             // Hide suite groups if all their items are hidden
            document.querySelectorAll('#testRunsList .suite-group').forEach(suiteGroup => {
                const visibleItems = suiteGroup.querySelectorAll('.test-result-item[style*="display: block"], .test-result-item:not([style])'); // Items not explicitly hidden
                 if (visibleItems.length === 0 && suiteGroup.querySelectorAll('.test-result-item').length > 0) { // Check if it originally had items
                     suiteGroup.style.display = 'none';
                 } else {
                     suiteGroup.style.display = ''; // Ensure it's visible if it has matching items
                 }
            });


            // Show/hide the "no results" message
             document.getElementById('noResultsMessage').style.display = hasVisibleItems ? 'none' : 'block';
        }

         // Initial call to filter in case there are default filter values (though none currently)
        filterTests();
    </script>
</body>
</html>
    `;
};

// --- Main Execution ---

const generateReport = async (inputDir = process.cwd(), options = {}) => {
  const reportJsonPath = path.resolve(
    inputDir,
    options.outputFile || "playwright-pulse-report.json"
  );
  const reportHtmlPath = path.resolve(
    inputDir,
    "playwright-pulse-static-report.html"
  );

  console.log(`Generating static report in directory: ${inputDir}`);
  console.log(`Reading report data from: ${reportJsonPath}`);

  try {
    const jsonData = await fs.readFile(reportJsonPath, "utf-8");
    let reportData;
    try {
      reportData = JSON.parse(jsonData);
      // Optional: Add date reviving here if needed for static report logic
    } catch (parseError) {
      console.error(`Error parsing JSON from ${reportJsonPath}:`, parseError);
      throw new Error("Invalid JSON in report file.");
    }

    const htmlContent = generateHTML(reportData);
    await fs.writeFile(reportHtmlPath, htmlContent);

    console.log(
      `Static HTML report generated successfully at ${reportHtmlPath}`
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Report JSON file not found at ${reportJsonPath}.`);
      console.error(
        "Ensure Playwright tests ran with 'playwright-pulse-reporter' and the file was generated."
      );
    } else {
      console.error("Error generating static HTML report:", error);
    }
    process.exit(1); // Exit with error code
  }
};

// Export the function and also run if executed directly
export default generateReport;

// Run if executed directly from command line
if (process.argv[1] === __filename) {
    // Default to current working directory if no argument is provided
    const targetDir = process.argv[2] || process.cwd();
    // Assume default options if run directly for simplicity
    // In a real CLI, you'd parse arguments for options
    generateReport(targetDir, {outputFile: 'playwright-pulse-report.json'});
}
