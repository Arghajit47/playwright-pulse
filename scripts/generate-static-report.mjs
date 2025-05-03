#!/usr/bin/env node
"use strict";

// Use CommonJS require for broader compatibility
const fs = require('fs').promises;
const path = require('path');
const process = require('process'); // Use process directly

// --- Configuration ---
const DEFAULT_INPUT_DIR = 'pulse-report-output';
const INPUT_JSON_FILE = 'playwright-pulse-report.json';
const OUTPUT_HTML_FILE = 'playwright-pulse-static-report.html';

// --- Helper Functions ---

/** Sanitize HTML content to prevent XSS */
function sanitizeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (match) => {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return match;
        }
    });
}

/** Format duration in milliseconds to seconds */
function formatDuration(ms) {
    if (typeof ms !== 'number' || ms < 0) return 'N/A';
    return (ms / 1000).toFixed(2) + 's';
}

/** Format Date object to a readable string */
function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "Invalid Date";
  }
  // More robust formatting, consider using a library like date-fns if needed
  try {
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (e) {
    return date.toISOString(); // Fallback
  }
}

/** Get CSS class based on test status */
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

/** Get an icon based on test status */
function getStatusIcon(status) {
  switch (status) {
    case "passed":
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-passed"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'; // Check Circle
    case "failed":
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-failed"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'; // X Circle
    case "skipped":
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-skipped"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>'; // Skip Forward
    default:
      return "";
  }
}


/** Generate HTML for attachments */
function generateAttachmentsHTML(result, baseDir) {
  let attachmentsHTML = "";
  if (result.screenshots && result.screenshots.length > 0) {
    attachmentsHTML += '<h3>Screenshots</h3><div class="attachments-grid">';
    result.screenshots.forEach((screenshot, index) => {
      const src = screenshot.startsWith("data:")
        ? screenshot
        : path.join(".", screenshot); // Assume relative path from HTML file
      attachmentsHTML += `<div class="attachment-item"><img src="${sanitizeHTML(
        src
      )}" alt="Screenshot ${index + 1}" loading="lazy"></div>`;
    });
    attachmentsHTML += "</div>";
  }
  if (result.videoPath) {
    const videoSrc = path.join(".", result.videoPath);
    attachmentsHTML += `<h3>Video</h3><p><a href="${sanitizeHTML(
      videoSrc
    )}" target="_blank" rel="noopener noreferrer">View Video</a></p>`;
    // Optional: Embed video player (consider large file sizes)
    // attachmentsHTML += `<video controls width="100%" preload="metadata"><source src="${sanitizeHTML(videoSrc)}" type="video/webm">Your browser does not support the video tag.</video>`;
  }
  if (result.tracePath) {
    const traceSrc = path.join(".", result.tracePath);
    attachmentsHTML += `<h3>Trace</h3><p><a href="${sanitizeHTML(
      traceSrc
    )}" download>Download Trace File</a></p>`;
  }
  return attachmentsHTML;
}

/** Generate chart data for status distribution */
function generateChartData(runData) {
  if (!runData || runData.totalTests === 0) return null;
  const total = runData.totalTests;
  const passed = runData.passed;
  const failed = runData.failed;
  const skipped = runData.skipped;
  const passedPercent = total ? ((passed / total) * 100).toFixed(1) : 0;
  const failedPercent = total ? ((failed / total) * 100).toFixed(1) : 0;
  const skippedPercent = total ? ((skipped / total) * 100).toFixed(1) : 0;

  // Simple data structure for JS - can be used with a library later
  return {
    total,
    passed,
    failed,
    skipped,
    passedPercent,
    failedPercent,
    skippedPercent,
    // For potential SVG pie chart generation (more complex)
    segments: [
      {
        status: "passed",
        value: passed,
        percentage: passedPercent,
        color: "#22c55e",
      }, // Green
      {
        status: "failed",
        value: failed,
        percentage: failedPercent,
        color: "#ef4444",
      }, // Red
      {
        status: "skipped",
        value: skipped,
        percentage: skippedPercent,
        color: "#f59e0b",
      }, // Amber
    ].filter((s) => s.value > 0), // Only include segments with data
  };
}

// --- Main Generation Logic ---
async function generateStaticReport(inputDir) {
  const reportJsonPath = path.resolve(inputDir, INPUT_JSON_FILE); // Read from the specified directory
  const reportHtmlPath = path.resolve(inputDir, OUTPUT_HTML_FILE); // Write to the same directory
  console.log(`Generating static report in directory: ${inputDir}`);
  console.log(`Reading report data from: ${reportJsonPath}`);

  let reportData;
  try {
    const jsonData = await fs.readFile(reportJsonPath, "utf-8");
    // Revive dates after parsing
    reportData = JSON.parse(jsonData, (key, value) => {
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
      if (typeof value === "string" && isoDateRegex.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
      return value;
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Report JSON file not found at ${reportJsonPath}.`);
      console.error(
        "Ensure Playwright tests ran with 'playwright-pulse-reporter' and the file was generated."
      );
    } else {
      console.error(
        `Error reading or parsing report file ${reportJsonPath}:`,
        error
      );
    }
    process.exit(1); // Exit if the report JSON doesn't exist
  }

  const { run, results } = reportData;
  const chartData = generateChartData(run);

  // --- Group Results by Suite ---
  const resultsBySuite = results.reduce((acc, result) => {
    const suite = result.suiteName || "Default Suite";
    if (!acc[suite]) {
      acc[suite] = [];
    }
    acc[suite].push(result);
    return acc;
  }, {});

  // --- Generate HTML Content ---
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse Report</title>
    <style>
        body { font-family: sans-serif; margin: 0; background-color: #f3f4f6; color: #1f2937; }
        .container { max-width: 1200px; margin: 20px auto; padding: 20px; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        header { border-bottom: 1px solid #e5e7eb; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        header h1 { margin: 0; font-size: 1.8em; color: #708090; } /* Slate Blue */
        header .run-info { font-size: 0.9em; color: #6b7280; text-align: right; }
        nav { margin-bottom: 20px; border-bottom: 1px solid #e5e7eb; }
        nav button { padding: 10px 15px; border: none; background: none; cursor: pointer; font-size: 1em; color: #6b7280; border-bottom: 3px solid transparent; margin-right: 10px; }
        nav button.active { color: #008080; border-bottom-color: #008080; font-weight: bold;} /* Teal */
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .summary-card { background-color: #fff; border: 1px solid #e5e7eb; padding: 15px; border-radius: 6px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .summary-card .value { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .summary-card .label { font-size: 0.9em; color: #6b7280; }
        .status-passed .value { color: #10b981; } /* Green */
        .status-failed .value { color: #ef4444; } /* Red */
        .status-skipped .value { color: #f59e0b; } /* Amber */
        .chart-container { border: 1px solid #e5e7eb; padding: 20px; border-radius: 6px; margin-bottom: 30px; background-color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .chart-container h2 { margin-top: 0; font-size: 1.2em; color: #374151; text-align: center; margin-bottom: 20px; }
        .pie-chart-placeholder { height: 150px; display: flex; justify-content: center; align-items: center; background-color: #f9fafb; border-radius: 50%; width: 150px; margin: 0 auto 15px; position: relative; border: 1px solid #e5e7eb; }
        .pie-chart-placeholder svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; } /* Basic SVG setup */
        .pie-chart-placeholder .chart-text { z-index: 1; font-size: 1.5em; font-weight: bold; }
        .chart-legend { display: flex; justify-content: center; gap: 20px; font-size: 0.9em; margin-top: 15px; }
        .legend-item { display: flex; align-items: center; gap: 5px; }
        .legend-color { width: 12px; height: 12px; border-radius: 2px; }
        .filters { display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; }
        .filters input, .filters select { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.9em; }
        .test-suite { margin-bottom: 30px; border: 1px solid #e5e7eb; border-radius: 6px; background-color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .test-suite-header { background-color: #f9fafb; padding: 10px 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; border-radius: 6px 6px 0 0; cursor: pointer; }
        .test-suite-content { padding: 0; max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; }
        .test-suite-content.expanded { max-height: 2000px; /* Adjust as needed */ padding: 15px; } /* Show content when expanded */
        .test-result-item { border-bottom: 1px solid #e5e7eb; padding: 15px; cursor: pointer; transition: background-color 0.2s ease; display: flex; justify-content: space-between; align-items: center; }
        .test-result-item:last-child { border-bottom: none; }
        .test-result-item:hover { background-color: #f9fafb; }
        .test-result-item .name { font-weight: 500; flex-grow: 1; margin-right: 15px; }
        .test-result-item .duration { font-size: 0.9em; color: #6b7280; margin-left: 15px; }
        .test-status-badge { padding: 3px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; display: inline-flex; align-items: center; gap: 4px; border: 1px solid transparent; }
        .status-passed { color: #059669; background-color: #d1fae5; border-color: #a7f3d0; }
        .status-failed { color: #dc2626; background-color: #fee2e2; border-color: #fecaca; }
        .status-skipped { color: #d97706; background-color: #fffbeb; border-color: #fef3c7; }
        .test-details { display: none; padding: 15px; background-color: #f8fafc; border-top: 1px dashed #e5e7eb; margin-top: 10px; }
        .test-details h3 { font-size: 1.1em; margin-top: 15px; margin-bottom: 8px; color: #374151; border-bottom: 1px solid #d1d5db; padding-bottom: 5px;}
        .test-details h3:first-child { margin-top: 0; }
        .test-details p { margin: 5px 0; font-size: 0.95em; }
        .test-details pre { background-color: #e5e7eb; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 0.9em; margin-top: 5px; margin-bottom: 10px; white-space: pre-wrap; word-wrap: break-word; }
        .test-details code { font-family: monospace; }
        .steps-list { list-style: none; padding: 0; margin: 0; }
        .step-item { padding: 8px 0; border-bottom: 1px solid #e5e7eb; display: flex; flex-direction: column; }
        .step-item:last-child { border-bottom: none; }
        .step-title { display: flex; justify-content: space-between; align-items: center; font-size: 0.9em; }
        .step-title .icon { margin-right: 6px; vertical-align: middle; }
        .step-duration { font-size: 0.9em; color: #6b7280; }
        .step-error { color: #dc2626; font-size: 0.85em; margin-top: 4px; padding-left: 20px; }
        .attachments-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
        .attachment-item img { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid #d1d5db; cursor: pointer; transition: transform 0.2s; }
        .attachment-item img:hover { transform: scale(1.05); }
        .icon { display: inline-block; width: 1em; height: 1em; vertical-align: -0.125em; }
        .icon-passed { color: #10b981; }
        .icon-failed { color: #ef4444; }
        .icon-skipped { color: #f59e0b; }
        /* Modal Styles */
        .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.8); }
        .modal-content { margin: auto; display: block; max-width: 90%; max-height: 90%; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
        .modal-close { position: absolute; top: 15px; right: 35px; color: #fff; font-size: 40px; font-weight: bold; transition: 0.3s; cursor: pointer; }
        .modal-close:hover, .modal-close:focus { color: #bbb; text-decoration: none; cursor: pointer; }

    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Playwright Pulse Report</h1>
            <div class="run-info">
                ${
                  run
                    ? `
                Run ID: ${sanitizeHTML(run.id)}<br>
                Generated: ${formatDate(
                  new Date(reportData.metadata.generatedAt)
                )}
                `
                    : "Run data not available"
                }
            </div>
        </header>

        <nav>
            <button id="tab-btn-dashboard" class="tab-btn active" onclick="switchTab('dashboard')">Dashboard</button>
            <button id="tab-btn-testruns" class="tab-btn" onclick="switchTab('testruns')">Test Runs</button>
        </nav>

        <!-- Dashboard Tab -->
        <div id="tab-content-dashboard" class="tab-content active">
            ${
              run
                ? `
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="value">${run.totalTests}</div>
                    <div class="label">Total Tests</div>
                </div>
                <div class="summary-card status-passed">
                    <div class="value">${run.passed}</div>
                    <div class="label">Passed</div>
                </div>
                <div class="summary-card status-failed">
                    <div class="value">${run.failed}</div>
                    <div class="label">Failed</div>
                </div>
                <div class="summary-card status-skipped">
                    <div class="value">${run.skipped}</div>
                    <div class="label">Skipped</div>
                </div>
                 <div class="summary-card">
                    <div class="value">${formatDuration(run.duration)}</div>
                    <div class="label">Duration</div>
                </div>
            </div>
            `
                : "<p>Run summary data not available.</p>"
            }

            ${
              chartData
                ? `
            <div class="chart-container">
                <h2>Test Status Distribution</h2>
                <div class="pie-chart-placeholder">
                    <!-- Placeholder for JS chart or SVG -->
                     <svg viewBox="0 0 36 36" class="chart-svg">
                        ${generatePieChartSVG(chartData)}
                     </svg>
                    <span class="chart-text">${chartData.total}</span>
                </div>
                 <div class="chart-legend">
                    ${chartData.segments
                      .map(
                        (s) => `
                        <div class="legend-item">
                            <span class="legend-color" style="background-color: ${
                              s.color
                            };"></span>
                            <span>${sanitizeHTML(
                              s.status.charAt(0).toUpperCase() +
                                s.status.slice(1)
                            )}: ${s.value} (${s.percentage}%)</span>
                        </div>
                    `
                      )
                      .join("")}
                 </div>
            </div>
            `
                : "<p>Chart data not available.</p>"
            }
        </div>

        <!-- Test Runs Tab -->
        <div id="tab-content-testruns" class="tab-content">
            <div class="filters">
                <input type="search" id="search-input" placeholder="Search by test name...">
                <select id="status-filter">
                    <option value="all">All Statuses</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                </select>
            </div>

            <div id="test-results-list">
                ${Object.entries(resultsBySuite)
                  .map(
                    ([suiteName, suiteResults]) => `
                    <div class="test-suite" data-suite-name="${sanitizeHTML(
                      suiteName
                    )}">
                        <div class="test-suite-header" onclick="toggleSuite('${suiteName.replace(
                          /[^a-zA-Z0-9]/g,
                          "-"
                        )}');">
                            ${sanitizeHTML(suiteName)} (${suiteResults.length})
                        </div>
                        <div class="test-suite-content" id="suite-content-${suiteName.replace(
                          /[^a-zA-Z0-9]/g,
                          "-"
                        )}">
                            ${suiteResults
                              .map((result) => {
                                const attachmentsHTML = generateAttachmentsHTML(
                                  result,
                                  "."
                                ); // Relative to HTML file
                                return `
                                <div class="test-result-item" data-status="${
                                  result.status
                                }" data-name="${sanitizeHTML(
                                  result.name.toLowerCase()
                                )}" onclick="toggleDetails('${result.id}')">
                                    <span class="name">${sanitizeHTML(
                                      result.name
                                    )}</span>
                                    <span class="test-status-badge ${getStatusClass(
                                      result.status
                                    )}">${getStatusIcon(result.status)} ${
                                  result.status
                                }</span>
                                    <span class="duration">${formatDuration(
                                      result.duration
                                    )}</span>
                                </div>
                                <div class="test-details" id="details-${
                                  result.id
                                }">
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
                                        <pre><code>${sanitizeHTML(
                                          result.errorMessage
                                        )}</code></pre>
                                        ${
                                          result.stackTrace
                                            ? `<pre><code>${sanitizeHTML(
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

                                     ${attachmentsHTML}

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
                            `;
                              })
                              .join("")}
                        </div>
                    </div>
                `
                  )
                  .join("")}
            </div>
        </div>
    </div>

     <!-- Image Modal -->
    <div id="imageModal" class="modal">
        <span class="modal-close" onclick="closeModal()">&times;</span>
        <img class="modal-content" id="modalImage">
    </div>

    <script>
        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById(\`tab-content-\${tabId}\`).classList.add('active');
            document.getElementById(\`tab-btn-\${tabId}\`).classList.add('active');
        }

        function toggleDetails(testId) {
            const details = document.getElementById(\`details-\${testId}\`);
            if (details) {
                details.style.display = details.style.display === 'block' ? 'none' : 'block';
            }
        }

        function toggleSuite(suiteId) {
             const content = document.getElementById(\`suite-content-\${suiteId}\`);
             if (content) {
                 content.classList.toggle('expanded');
             }
         }

        function filterTests() {
            const searchTerm = document.getElementById('search-input').value.toLowerCase();
            const statusFilter = document.getElementById('status-filter').value;

            document.querySelectorAll('.test-suite').forEach(suite => {
                let suiteVisible = false;
                suite.querySelectorAll('.test-result-item').forEach(item => {
                    const nameMatch = item.dataset.name.includes(searchTerm);
                    const statusMatch = statusFilter === 'all' || item.dataset.status === statusFilter;
                    if (nameMatch && statusMatch) {
                        item.style.display = 'flex';
                        suiteVisible = true;
                    } else {
                        item.style.display = 'none';
                        // Hide details if parent is hidden
                         const detailsId = item.getAttribute('onclick').match(/'([^']+)'/)[1];
                         const detailsElement = document.getElementById('details-' + detailsId);
                         if (detailsElement) detailsElement.style.display = 'none';
                    }
                });
                 // Show/hide the entire suite container based on whether any tests within it are visible
                suite.style.display = suiteVisible ? 'block' : 'none';
                // Ensure expanded suites with no visible tests collapse visually (optional)
                // if (!suiteVisible) {
                //     const suiteContent = suite.querySelector('.test-suite-content');
                //     if (suiteContent) suiteContent.classList.remove('expanded');
                // }
            });
        }

        // --- Image Modal Logic ---
        const modal = document.getElementById("imageModal");
        const modalImg = document.getElementById("modalImage");

        function openModal(imgElement) {
            if (modal && modalImg) {
                modal.style.display = "block";
                modalImg.src = imgElement.src;
            }
        }

        function closeModal() {
            if (modal) {
                modal.style.display = "none";
            }
        }

        // Add event listeners after the DOM is loaded
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('search-input').addEventListener('input', filterTests);
            document.getElementById('status-filter').addEventListener('change', filterTests);

             // Attach click listeners to images for modal
             document.querySelectorAll('.attachment-item img').forEach(img => {
                img.onclick = function() { openModal(this); };
             });

             // Close modal if clicked outside the image
             window.onclick = function(event) {
                if (event.target == modal) {
                    closeModal();
                }
             }
        });

        // Initial filter on load
        filterTests();
        // Initial tab setup
        switchTab('dashboard');

        // --- Basic SVG Pie Chart Generation ---
        function generatePieChartSVG(chartData) {
            if (!chartData || !chartData.segments || chartData.total === 0) return '';

            const radius = 15.91549430918954; // Makes circumference 100
            let currentOffset = 0;
            let svgContent = '';

             // Sort segments for consistent rendering (e.g., failed last)
            const sortedSegments = [...chartData.segments].sort((a, b) => {
                if (a.status === 'failed') return 1;
                if (b.status === 'failed') return -1;
                if (a.status === 'skipped') return 1;
                if (b.status === 'skipped') return -1;
                return 0;
            });


            sortedSegments.forEach(segment => {
                const percentage = parseFloat(segment.percentage);
                 if (percentage > 0) { // Only draw if percentage is > 0
                    svgContent += \`
                        <circle class="pie-segment" cx="18" cy="18" r="\${radius}"
                                fill="transparent"
                                stroke="\${segment.color}"
                                stroke-width="3.8"
                                stroke-dasharray="\${percentage} \${100 - percentage}"
                                stroke-dashoffset="\${25 - currentOffset}"
                         />\`; // Offset by 25 to start at the top
                    currentOffset += percentage;
                 }
            });

            return svgContent;
        }

    </script>
</body>
</html>
`;

  try {
    await fs.writeFile(reportHtmlPath, htmlContent);
    console.log(
      `Static HTML report generated successfully at ${reportHtmlPath}`
    );
  } catch (error) {
    console.error(
      `Error writing static HTML report to ${reportHtmlPath}:`,
      error
    );
    process.exit(1);
  }
}

// --- Script Execution ---
// Determine the input directory: use argument or default
const targetDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.resolve(process.cwd(), DEFAULT_INPUT_DIR);

generateStaticReport(targetDir).catch((error) => {
  console.error("Failed to generate static report:", error);
  process.exit(1);
});
