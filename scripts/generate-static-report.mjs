#!/usr/bin/env node
import * as fs from "fs/promises";
import * as path from "path";
import { format, formatDistanceToNow } from "date-fns";

// --- Configuration ---
const reportJsonFileName = 'playwright-pulse-report.json';
const outputHtmlFileName = 'playwright-pulse-static-report.html';
const reportJsonDir = path.resolve(process.cwd(), 'pulse-report-output'); // Read from project root's output dir
const outputHtmlPath = path.join(reportJsonDir, outputHtmlFileName); // Write HTML to the same dir
const reportJsonPath = path.join(reportJsonDir, reportJsonFileName);

// --- Helper Functions ---

const log = (message) => console.log(`[Static Report Generator] ${message}`);
const logError = (message, error) =>
  console.error(`[Static Report Generator] ${message}`, error);

// Basic HTML escaping
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Format duration (ms to seconds string)
const formatDuration = (ms) => ms === undefined || ms === null ? 'N/A' : `${(ms / 1000).toFixed(1)}s`;

// Format date object or string
const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
        const d = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(d.getTime())) return 'Invalid Date';
        return format(d, 'PP pp'); // e.g., Jul 20, 2024 10:30:00 AM
    } catch (e) {
        return 'Invalid Date';
    }
};

const formatTimeAgo = (date) => {
  if (!date) return "N/A";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "Invalid Date";
    return formatDistanceToNow(d, { addSuffix: true });
  } catch (e) {
    return "Invalid Date";
  }
};

// Get status color class (simplified)
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
        return "✓"; // Check mark
      case "failed":
        return "✕"; // Cross mark
      case "skipped":
        return "»"; // Skip symbol
      default:
        return "?";
    }
};


// --- HTML Generation Functions ---

function generateRunSummaryHtml(runData) {
  if (!runData) {
    return `<div class="card"><div class="card-content"><p class="muted-text">No run summary data available.</p></div></div>`;
  }

  const metrics = [
    { label: "Total Tests", value: runData.totalTests ?? "N/A", icon: "📊" }, // Using emojis as placeholders
    {
      label: "Passed",
      value: runData.passed ?? "N/A",
      icon: "✓",
      colorClass: "status-passed-text",
    },
    {
      label: "Failed",
      value: runData.failed ?? "N/A",
      icon: "✕",
      colorClass: "status-failed-text",
    },
    {
      label: "Skipped",
      value: runData.skipped ?? "N/A",
      icon: "»",
      colorClass: "status-skipped-text",
    },
    { label: "Duration", value: formatDuration(runData.duration), icon: "⏱️" },
  ];

  return `
    <div class="grid summary-grid">
        ${metrics
          .map(
            (metric) => `
            <div class="card summary-card">
                <div class="card-header">
                    <span class="card-title-sm muted-text">${escapeHtml(
                      metric.label
                    )}</span>
                    <span class="summary-icon ${metric.colorClass || ""}">${
              metric.icon
            }</span>
                </div>
                <div class="card-content">
                    <div class="summary-value ${
                      metric.colorClass || ""
                    }">${escapeHtml(metric.value)}</div>
                </div>
            </div>
        `
          )
          .join("")}
    </div>
    <div class="run-meta muted-text">
        Run ID: ${escapeHtml(runData.id)} | Timestamp: ${formatDate(
    runData.timestamp
  )}
    </div>
    `;
}

function generateTestStepHtml(step) {
  const duration = formatDuration(step.duration);
  const statusClass = getStatusClass(step.status);
  const icon = getStatusIcon(step.status);
  return `
        <details class="step-details">
            <summary class="step-summary ${statusClass}">
                <span class="step-icon">${icon}</span>
                <span class="step-title">${escapeHtml(step.title)}</span>
                <span class="step-duration muted-text">(${duration})</span>
            </summary>
            <div class="step-content">
                ${
                  step.errorMessage
                    ? `<div class="error-message"><strong>Error:</strong> <pre>${escapeHtml(
                        step.errorMessage
                      )}</pre></div>`
                    : ""
                }
                <div class="muted-text text-xs">
                    Started: ${formatDate(
                      step.startTime
                    )} | Ended: ${formatDate(step.endTime)}
                </div>
                ${
                  step.screenshot
                    ? `<div class="step-attachment"><span class="muted-text">Screenshot:</span> <a href="${escapeHtml(
                        step.screenshot
                      )}" target="_blank" rel="noopener noreferrer">[View Screenshot]</a> *</div>`
                    : ""
                }
            </div>
        </details>
     `;
}


function generateTestResultHtml(result, index) {
  const statusClass = getStatusClass(result.status);
  const icon = getStatusIcon(result.status);
  const timeAgo = formatTimeAgo(result.endTime);
  const duration = formatDuration(result.duration);

  // Unique ID for toggling
  const detailId = `test-detail-${index}`;

  return `
    <div class="card test-result-item" data-status="${
      result.status
    }" data-text="${escapeHtml(result.name.toLowerCase())} ${escapeHtml(
    result.suiteName?.toLowerCase() || ""
  )}">
        <button class="test-result-summary" onclick="toggleDetail('${detailId}')" aria-expanded="false" aria-controls="${detailId}">
            <div class="summary-header">
                <span class="badge ${statusClass}">${icon} ${escapeHtml(
    result.status
  )}</span>
                <span class="duration muted-text">⏱️ ${duration}</span>
            </div>
            <div class="test-name">${escapeHtml(result.name)}</div>
            ${
              result.suiteName
                ? `<div class="suite-name muted-text text-sm">Suite: ${escapeHtml(
                    result.suiteName
                  )}</div>`
                : ""
            }
            <div class="time-ago muted-text text-xs">Finished ${timeAgo}</div>
        </button>
        <div id="${detailId}" class="test-result-details" hidden>
            <div class="detail-section">
                <h4 class="detail-title">Details</h4>
                <p><span class="muted-text">Status:</span> <span class="status-text ${statusClass}">${escapeHtml(
    result.status
  )}</span></p>
                <p><span class="muted-text">Duration:</span> ${duration}</p>
                <p><span class="muted-text">Started:</span> ${formatDate(
                  result.startTime
                )}</p>
                <p><span class="muted-text">Ended:</span> ${formatDate(
                  result.endTime
                )}</p>
                <p><span class="muted-text">Retries:</span> ${
                  result.retries ?? 0
                }</p>
                ${
                  result.tags && result.tags.length > 0
                    ? `<p><span class="muted-text">Tags:</span> ${result.tags
                        .map(
                          (tag) => `<span class="tag">${escapeHtml(tag)}</span>`
                        )
                        .join(" ")}</p>`
                    : ""
                }
                <p><span class="muted-text">Run ID:</span> ${escapeHtml(
                  result.runId
                )}</p>
                 <p><span class="muted-text">Full Path:</span> ${escapeHtml(
                   result.name
                 )}</p>
                 <p><span class="muted-text">Location:</span> ${escapeHtml(
                   result.codeSnippet?.replace("Test defined at: ", "") || "N/A"
                 )}</p>
            </div>

            ${
              result.status === "failed" &&
              (result.errorMessage || result.stackTrace)
                ? `
                <div class="detail-section error-section">
                    <h4 class="detail-title error-title">Failure Details</h4>
                    ${
                      result.errorMessage
                        ? `<div class="error-message"><strong>Error:</strong><pre>${escapeHtml(
                            result.errorMessage
                          )}</pre></div>`
                        : ""
                    }
                    ${
                      result.stackTrace
                        ? `<div class="stack-trace"><strong>Stack Trace:</strong><pre>${escapeHtml(
                            result.stackTrace
                          )}</pre></div>`
                        : ""
                    }
                </div>
            `
                : ""
            }

            ${
              result.steps && result.steps.length > 0
                ? `
                <div class="detail-section">
                    <h4 class="detail-title">Test Steps</h4>
                    <div class="steps-container">
                        ${result.steps.map(generateTestStepHtml).join("")}
                    </div>
                    <p class="muted-text text-xs">* Attachments like screenshots/videos require the original Playwright output artifacts.</p>
                </div>
            `
                : '<div class="detail-section muted-text">No steps recorded.</div>'
            }

             ${
               result.codeSnippet
                 ? `
                <div class="detail-section">
                    <h4 class="detail-title">Source Location</h4>
                    <pre class="code-snippet"><code>${escapeHtml(
                      result.codeSnippet
                    )}</code></pre>
                </div>
            `
                 : ""
             }

            <div class="detail-section attachments-section">
                 <h4 class="detail-title">Attachments</h4>
                 <div class="attachments-grid">
                    ${
                      result.screenshot
                        ? `<div><span class="muted-text">Screenshot (on failure):</span> <a href="${escapeHtml(
                            result.screenshot
                          )}" target="_blank" rel="noopener noreferrer">[View Screenshot]</a> *</div>`
                        : '<div class="muted-text">No failure screenshot available.</div>'
                    }
                    ${
                      result.video
                        ? `<div><span class="muted-text">Video:</span> <a href="${escapeHtml(
                            result.video
                          )}" target="_blank" rel="noopener noreferrer">[View Video]</a> *</div>`
                        : '<div class="muted-text">No video available.</div>'
                    }
                </div>
                 <p class="muted-text text-xs">* Attachments require access to the original Playwright output directory.</p>
            </div>
        </div>
    </div>
    `;
}

function generateHtml(reportData) {
  const { run, results, metadata } = reportData;
  const generationTime = formatDate(metadata.generatedAt);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse - Static Report</title>
    <style>
        /* Reset and Base Styles (Inspired by globals.css and ShadCN) */
        :root {
            --background: #ffffff;
            --foreground: #334155; /* slate-700 */
            --card: #ffffff;
            --card-foreground: #334155;
            --popover: #ffffff;
            --popover-foreground: #334155;
            --primary: #64748b; /* slate-500 */
            --primary-foreground: #ffffff;
            --secondary: #f1f5f9; /* slate-100 */
            --secondary-foreground: #334155;
            --muted: #f8fafc; /* slate-50 */
            --muted-foreground: #64748b; /* slate-500 */
            --accent: #0f766e; /* teal-700 */
            --accent-foreground: #ffffff;
            --destructive: #dc2626; /* red-600 */
            --destructive-foreground: #ffffff;
            --border: #e2e8f0; /* slate-200 */
            --input: #e2e8f0;
            --ring: #0d9488; /* teal-600 */
            --radius: 0.5rem;
            --success: #16a34a; /* green-600 */
            --warning: #f59e0b; /* amber-500 */
            --success-light: #dcfce7; /* green-100 */
            --warning-light: #fef3c7; /* amber-100 */
            --destructive-light: #fee2e2; /* red-100 */
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
            margin: 0;
            padding: 0;
            background-color: var(--secondary);
            color: var(--foreground);
            line-height: 1.5;
            font-size: 14px;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        h1, h2, h3, h4 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
        h1 { font-size: 1.8rem; }
        h2 { font-size: 1.5rem; }
        h3 { font-size: 1.2rem; }
        h4 { font-size: 1.0rem; margin-top: 1em; margin-bottom: 0.3em; }
        pre {
            background-color: var(--muted);
            padding: 1rem;
            border-radius: var(--radius);
            overflow-x: auto;
            font-family: monospace;
            font-size: 0.85em;
            border: 1px solid var(--border);
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        code { font-family: monospace; }
        a { color: var(--primary); text-decoration: none; }
        a:hover { text-decoration: underline; }

        /* Layout */
        .grid { display: grid; gap: 1rem; }
        .summary-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
        .filters { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
        .filters input, .filters select {
            padding: 0.5rem 0.75rem;
            border: 1px solid var(--input);
            border-radius: var(--radius);
            background-color: var(--background);
            color: var(--foreground);
            font-size: 0.9em;
        }

        /* Card Component */
        .card {
            background-color: var(--card);
            color: var(--card-foreground);
            border-radius: var(--radius);
            border: 1px solid var(--border);
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
            margin-bottom: 1rem;
            overflow: hidden; /* Prevent content overflow */
        }
        .card-header { padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;}
        .card-title { font-size: 1.1rem; font-weight: 600; margin: 0; }
        .card-title-sm { font-size: 0.9rem; font-weight: 500; }
        .card-content { padding: 1.5rem; }

        /* Summary Card Specific */
        .summary-card .card-header { padding: 0.75rem 1rem; border-bottom: none; }
        .summary-card .card-content { padding: 0.5rem 1rem 1rem 1rem; }
        .summary-value { font-size: 1.5rem; font-weight: bold; }
        .summary-icon { font-size: 1.1rem; }
        .run-meta { text-align: center; margin-top: 1rem; font-size: 0.85em; }

        /* Test Result Item */
        .test-result-item { margin-bottom: 0.5rem; }
        .test-result-summary {
            display: block;
            width: 100%;
            padding: 1rem 1.5rem;
            text-align: left;
            border: none;
            background: none;
            cursor: pointer;
            transition: background-color 0.2s ease;
        }
        .test-result-summary:hover { background-color: var(--muted); }
        .test-result-summary .summary-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
        .test-result-summary .test-name { font-weight: 500; margin-bottom: 0.25rem; }
        .test-result-details {
            padding: 0 1.5rem 1.5rem 1.5rem;
            border-top: 1px solid var(--border);
            background-color: #fafbfc; /* Slightly different bg for details */
        }
        .detail-section { margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px dashed var(--border); }
        .detail-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
        .detail-title { font-weight: 600; margin-bottom: 0.5rem; color: var(--primary); }
        .error-section { border-left: 3px solid var(--destructive); padding-left: 1rem; }
        .error-title { color: var(--destructive); }
        .error-message pre, .stack-trace pre { background-color: #fff5f5; border-color: #fecaca; color: #991b1b; font-size: 0.8em; }

        /* Steps */
        .steps-container { max-height: 400px; overflow-y: auto; padding-right: 0.5rem;}
        .step-details { border-left: 2px solid var(--border); margin-left: 0.5rem; margin-bottom: 0.5rem; }
        .step-summary { padding: 0.4rem 0.8rem; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; transition: background-color 0.2s; }
        .step-summary:hover { background-color: var(--muted); }
        .step-summary::-webkit-details-marker { display: none; } /* Hide default marker */
        .step-summary::before { content: '▸'; display: inline-block; margin-right: 0.3rem; transition: transform 0.2s; }
        .step-details[open] > .step-summary::before { transform: rotate(90deg); }
        .step-icon { font-weight: bold; }
        .step-title { flex-grow: 1; }
        .step-content { padding: 0.5rem 0.8rem 0.8rem 2rem; font-size: 0.9em; border-top: 1px dashed var(--border); margin-top: 0.4rem; }
        .step-attachment { margin-top: 0.5rem; }

        /* Attachments */
         .attachments-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

        /* Code Snippet */
         .code-snippet { background-color: var(--muted); border: 1px solid var(--border); padding: 0.5rem 1rem; border-radius: var(--radius); font-size: 0.85em; }

        /* Badge and Status Styles */
        .badge {
            display: inline-block;
            padding: 0.25em 0.6em;
            font-size: 0.75rem;
            font-weight: 600;
            border-radius: 9999px;
            border: 1px solid transparent;
            white-space: nowrap;
        }
        .status-passed { background-color: var(--success-light); color: var(--success); border-color: var(--success); }
        .status-failed { background-color: var(--destructive-light); color: var(--destructive); border-color: var(--destructive); }
        .status-skipped { background-color: var(--warning-light); color: var(--warning); border-color: var(--warning); }
        .status-passed-text { color: var(--success); }
        .status-failed-text { color: var(--destructive); }
        .status-skipped-text { color: var(--warning); }
        .status-text { font-weight: bold; text-transform: capitalize; }

        /* Utility Classes */
        .muted-text { color: var(--muted-foreground); }
        .text-xs { font-size: 0.75rem; }
        .text-sm { font-size: 0.875rem; }
        .tag { background-color: var(--secondary); padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.8em; }
        .footer { text-align: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.85em; color: var(--muted-foreground); }

        /* Responsive */
        @media (max-width: 768px) {
            .container { padding: 1rem; }
            .summary-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
            .filters { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Playwright Pulse - Test Report</h1>

        <section id="summary">
            <h2>Run Summary</h2>
            ${generateRunSummaryHtml(run)}
        </section>

        <section id="test-results">
            <h2>Test Results (${results.length})</h2>
             <div class="filters">
                 <input type="text" id="search-input" placeholder="🔎 Search by name or suite..." oninput="filterTests()">
                 <select id="status-filter" onchange="filterTests()">
                     <option value="all">All Statuses</option>
                     <option value="passed">Passed</option>
                     <option value="failed">Failed</option>
                     <option value="skipped">Skipped</option>
                 </select>
                 <span id="filter-count" class="muted-text" style="align-self: center;"></span>
             </div>
            <div id="results-list">
                ${
                  results.length > 0
                    ? results.map(generateTestResultHtml).join("")
                    : '<p class="muted-text">No test results found.</p>'
                }
            </div>
        </section>

        <footer class="footer">
            Generated by Playwright Pulse Reporter on ${generationTime}
        </footer>
    </div>

    <script>
        function toggleDetail(id) {
            const detailElement = document.getElementById(id);
            const buttonElement = detailElement.previousElementSibling; // The summary button
            if (detailElement) {
                const isHidden = detailElement.hidden;
                detailElement.hidden = !isHidden;
                 buttonElement.setAttribute('aria-expanded', isHidden);
            }
        }

        function filterTests() {
            const searchTerm = document.getElementById('search-input').value.toLowerCase();
            const statusFilter = document.getElementById('status-filter').value;
            const resultsList = document.getElementById('results-list');
            const testItems = resultsList.querySelectorAll('.test-result-item');
            let visibleCount = 0;

            testItems.forEach(item => {
                const status = item.getAttribute('data-status');
                const textContent = item.getAttribute('data-text') || ''; // Use pre-calculated text

                const statusMatch = statusFilter === 'all' || status === statusFilter;
                const searchMatch = searchTerm === '' || textContent.includes(searchTerm);

                if (statusMatch && searchMatch) {
                    item.style.display = '';
                    visibleCount++;
                } else {
                    item.style.display = 'none';
                }
            });

            const filterCountElement = document.getElementById('filter-count');
            if(filterCountElement){
                 filterCountElement.textContent = \`Showing \${visibleCount} of \${testItems.length} tests\`;
            }
        }

        // Initial filter application if needed (e.g., if filters have default values)
        // filterTests();
         // Initialize count on load
        document.addEventListener('DOMContentLoaded', filterTests);
    </script>
</body>
</html>
    `;
}

// --- Main Execution ---

async function main() {
  log(`Attempting to read report data from: ${reportJsonPath}`);
  let reportData;
  try {
    const fileContent = await fs.readFile(reportJsonPath, "utf-8");
    // Reviver to parse dates correctly
    reportData = JSON.parse(fileContent, (key, value) => {
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
      if (typeof value === "string" && isoDateRegex.test(value)) {
        try {
          const date = new Date(value);
          if (!isNaN(date.getTime())) return date;
        } catch (e) {
          /* ignore parse error, return original string */
        }
      }
      return value;
    });
    log("Successfully read and parsed report data.");
  } catch (error) {
    if (error.code === "ENOENT") {
      logError(
        `Report JSON file not found at ${reportJsonPath}.\nEnsure Playwright tests ran with 'playwright-pulse-reporter' and the file was generated in the 'pulse-report-output' directory relative to your project root.`
      );
    } else {
      logError(
        `Failed to read or parse report data from ${reportJsonPath}.`,
        error
      );
    }
    process.exit(1); // Exit if report data is missing or invalid
  }

  // Basic validation
  if (
    !reportData ||
    !reportData.metadata ||
    !Array.isArray(reportData.results)
  ) {
    logError(
      "Report data is missing required fields (metadata, results). Aborting."
    );
    process.exit(1);
  }

  log("Generating static HTML report...");
  const htmlContent = generateHtml(reportData);

  try {
    // Ensure output directory exists
    await fs.mkdir(reportJsonDir, { recursive: true });
    await fs.writeFile(outputHtmlPath, htmlContent, "utf-8");
    log(`Successfully generated static HTML report: ${outputHtmlPath}`);
  } catch (error) {
    logError(`Failed to write static HTML report to ${outputHtmlPath}.`, error);
    process.exit(1);
  }
}

main();
