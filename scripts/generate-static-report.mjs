#!/usr/bin/env node
// Using Node.js syntax compatible with `.mjs`
import * as fs from "fs/promises";
import path from "path";
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
const DEFAULT_OUTPUT_DIR = "pulse-report-output";
const DEFAULT_JSON_FILE = "playwright-pulse-report.json";
const DEFAULT_HTML_FILE = "playwright-pulse-static-report.html";

// Helper functions
function sanitizeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    return date.toLocaleString();
  } catch (e) {
    return "Invalid Date";
  }
}

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

function getStatusIcon(status) {
  switch (status) {
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

// Enhanced pie chart with legend
function generatePieChartSVG(data) {
  const { passed = 0, failed = 0, skipped = 0 } = data || {};
  const total = passed + failed + skipped;
  if (total === 0)
    return '<div class="pie-chart-placeholder">No tests found</div>';

  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const center = 70;
  let currentAngle = -90;

  const segments = [
    { value: passed, color: "#4CAF50", label: "Passed" },
    { value: failed, color: "#F44336", label: "Failed" },
    { value: skipped, color: "#FFC107", label: "Skipped" },
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
      const pathData = `M ${center},${center} L ${startX},${startY} A ${radius},${radius} 0 ${largeArcFlag} 1 ${endX},${endY} Z`;
      currentAngle = endAngle;

      return `<path d="${pathData}" fill="${segment.color}" stroke="#fff" stroke-width="1" />`;
    });

  const legend = segments
    .map(
      (segment) => `
    <div class="legend-item">
      <span class="legend-color" style="background-color:${
        segment.color
      }"></span>
      <span class="legend-label">${segment.label}</span>
      <span class="legend-value">${segment.value} (${Math.round(
        (segment.value / total) * 100
      )}%)</span>
    </div>
  `
    )
    .join("");

  return `
    <div class="pie-chart-container">
      <svg viewBox="0 0 140 140" width="140" height="140" class="pie-chart-svg">
        ${paths.join("")}
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="pie-chart-total">
          ${total}
        </text>
        <text x="50%" y="65%" dominant-baseline="middle" text-anchor="middle" class="pie-chart-label">
          Tests
        </text>
      </svg>
      <div class="pie-chart-legend">
        ${legend}
      </div>
    </div>
  `;
}

// Enhanced HTML generation with Test Run Summary tab
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

  // Calculate additional metrics
  const passPercentage =
    runSummary.totalTests > 0
      ? Math.round((runSummary.passed / runSummary.totalTests) * 100)
      : 0;
  const avgTestDuration =
    runSummary.totalTests > 0
      ? formatDuration(runSummary.duration / runSummary.totalTests)
      : "0.0s";

  // Generate test cases HTML for Test Run Summary tab
  const generateTestCasesHTML = () => {
    if (!results || results.length === 0) {
      return '<div class="no-tests">No test results found</div>';
    }

    // Collect all unique tags and browsers
    const allTags = new Set();
    const allBrowsers = new Set();

    results.forEach((test) => {
      (test.tags || []).forEach((tag) => allTags.add(tag));
      const browserMatch = test.name.match(/ > (\w+) > /);
      if (browserMatch) allBrowsers.add(browserMatch[1]);
    });

    // Generate test case HTML
    const testCasesHTML = results
      .map((test, index) => {
        const browserMatch = test.name.match(/ > (\w+) > /);
        const browser = browserMatch ? browserMatch[1] : "unknown";
        const testName = test.name.split(" > ").pop() || test.name;

        // Generate steps HTML recursively
        const generateStepsHTML = (steps, depth = 0) => {
          if (!steps || steps.length === 0) return "";

          return steps
            .map((step) => {
              const hasNestedSteps = step.steps && step.steps.length > 0;
              const isHook = step.isHook;
              const stepClass = isHook ? "step-hook" : "";
              const hookIndicator = isHook ? ` (${step.hookType} hook)` : "";

              return `
            <div class="step-item" style="padding-left: ${depth * 20}px">
              <div class="step-header ${stepClass}" onclick="toggleStepDetails(this)">
                <span class="step-icon">${getStatusIcon(step.status)}</span>
                <span class="step-title">${sanitizeHTML(
                  step.title
                )}${hookIndicator}</span>
                <span class="step-duration">${formatDuration(
                  step.duration
                )}</span>
              </div>
              <div class="step-details">
                ${
                  step.codeLocation
                    ? `<div><strong>Location:</strong> ${sanitizeHTML(
                        step.codeLocation
                      )}</div>`
                    : ""
                }
                ${
                  step.errorMessage
                    ? `
                  <div class="step-error">
                    <strong>Error:</strong> ${sanitizeHTML(step.errorMessage)}
                    ${
                      step.stackTrace
                        ? `<pre>${sanitizeHTML(step.stackTrace)}</pre>`
                        : ""
                    }
                  </div>
                `
                    : ""
                }
                ${
                  hasNestedSteps
                    ? `
                  <div class="nested-steps">
                    ${generateStepsHTML(step.steps, depth + 1)}
                  </div>
                `
                    : ""
                }
              </div>
            </div>
          `;
            })
            .join("");
        };

        return `
        <div class="test-suite" data-status="${
          test.status
        }" data-browser="${browser}" data-tags="${(test.tags || []).join(",")}">
          <div class="suite-header" onclick="toggleTestDetails(this)">
            <div>
              <span class="status-badge ${getStatusClass(
                test.status
              )}">${test.status.toUpperCase()}</span>
              <span class="test-name">${sanitizeHTML(testName)}</span>
              <span class="test-browser">(${browser})</span>
            </div>
            <div class="test-meta">
              <span class="test-duration">${formatDuration(
                test.duration
              )}</span>
            </div>
          </div>
          <div class="suite-content">
            <div class="test-details">
              <h3>Test Details</h3>
              <p><strong>Status:</strong> <span class="${getStatusClass(
                test.status
              )}">${test.status.toUpperCase()}</span></p>
              <p><strong>Browser:</strong> ${browser}</p>
              <p><strong>Duration:</strong> ${formatDuration(test.duration)}</p>
              ${
                test.tags && test.tags.length > 0
                  ? `<p><strong>Tags:</strong> ${test.tags
                      .map((t) => `<span class="tag">${t}</span>`)
                      .join(" ")}</p>`
                  : ""
              }
              
              <h3>Test Steps</h3>
              <div class="steps-list">
                ${generateStepsHTML(test.steps)}
              </div>
              
              ${
                test.screenshots && test.screenshots.length > 0
                  ? `
                <div class="attachments-section">
                  <h4>Screenshots</h4>
                  <div class="attachments-grid">
                    ${test.screenshots
                      .map(
                        (screenshot) => `
                      <div class="attachment-item">
                        <img src="${screenshot}" alt="Screenshot">
                        <div class="attachment-info">
                          <a href="${screenshot}" target="_blank">View Full Size</a>
                        </div>
                      </div>
                    `
                      )
                      .join("")}
                  </div>
                </div>
              `
                  : ""
              }
              
              ${
                test.codeSnippet
                  ? `
                <div class="code-section">
                  <h4>Code Snippet</h4>
                  <pre>${sanitizeHTML(test.codeSnippet)}</pre>
                </div>
              `
                  : ""
              }
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    return `
      <div class="filters">
        <input type="text" id="filter-name" placeholder="Search by test name..." oninput="filterTests()">
        <select id="filter-status" onchange="filterTests()">
          <option value="">All Statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
        <select id="filter-browser" onchange="filterTests()">
          <option value="">All Browsers</option>
          ${Array.from(allBrowsers)
            .map(
              (browser) => `
            <option value="${browser}">${browser}</option>
          `
            )
            .join("")}
        </select>
        <select id="filter-tag" onchange="filterTests()">
          <option value="">All Tags</option>
          ${Array.from(allTags)
            .map(
              (tag) => `
            <option value="${tag}">${tag}</option>
          `
            )
            .join("")}
        </select>
        <button onclick="expandAllTests()">Expand All</button>
        <button onclick="collapseAllTests()">Collapse All</button>
      </div>
      <div class="test-suites">
        ${testCasesHTML}
      </div>
    `;
  };

  // Generate HTML
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse Report</title>
    <style>
        /* [Previous CSS remains the same...] */

        /* New styles for test run summary */
        .test-suites {
          margin-top: 20px;
        }
        
        .suite-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 15px;
          background-color: #f5f5f5;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        
        .suite-header:hover {
          background-color: #e9e9e9;
        }
        
        .suite-content {
          display: none;
          padding: 15px;
          border: 1px solid #eee;
          border-top: none;
          border-radius: 0 0 6px 6px;
        }
        
        .status-badge {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.8em;
          font-weight: bold;
          margin-right: 10px;
        }
        
        .test-name {
          font-weight: 500;
        }
        
        .test-browser {
          color: #666;
          font-size: 0.9em;
          margin-left: 8px;
        }
        
        .test-meta {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        
        .test-duration {
          color: #666;
          font-size: 0.9em;
        }
        
        .tag {
          display: inline-block;
          background-color: #e0e0e0;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.8em;
          margin-right: 5px;
        }
        
        .step-header {
          cursor: pointer;
          padding: 8px 0;
          display: flex;
          align-items: center;
        }
        
        .step-icon {
          margin-right: 8px;
          width: 20px;
          text-align: center;
        }
        
        .step-details {
          display: none;
          padding: 10px;
          margin: 5px 0;
          background-color: #f8f9fa;
          border-radius: 4px;
          border-left: 3px solid #ddd;
        }
        
        .nested-steps {
          display: none;
          padding-left: 20px;
          border-left: 2px solid #eee;
          margin: 5px 0;
        }
        
        .step-hook {
          background-color: #f0f7ff;
          border-left: 3px solid #4a90e2;
        }
        
        .no-tests {
          text-align: center;
          padding: 40px;
          color: #666;
          font-size: 1.2em;
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div style="display: flex; align-items: center; gap: 15px;">
                <!-- Logo placeholder - replace src with your logo -->
                <img id="report-logo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJMNCA3bDggNSA4LTUtOC01eiIgZmlsbD0iIzNmNTEiLz48cGF0aCBkPSJNMTIgNkw0IDExbDggNSA4LTUtOC01eiIgZmlsbD0iIzQyODVmNCIvPjxwYXRoIGQ9Ik0xMiAxMGwtOCA1IDggNSA4LTUtOC01eiIgZmlsbD0iIzNkNTViNCIvPjwvc3ZnPg==" alt="Logo" style="height: 40px;">
                <h1>
                    Playwright Pulse Report
                </h1>
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
        
        <div class="tabs">
            <button class="tab-button active" data-tab="dashboard">Dashboard</button>
            <button class="tab-button" data-tab="test-runs">Test Run Summary</button>
        </div>
        
        <div id="dashboard" class="tab-content active">
            <!-- [Previous dashboard content remains the same...] -->
        </div>
        
        <div id="test-runs" class="tab-content">
            ${generateTestCasesHTML()}
        </div>
    </div>
    
    <script>
    // [Previous tab switching code remains the same...]

    // Test filtering function
    function filterTests() {
      const nameFilter = document.getElementById('filter-name').value.toLowerCase();
      const statusFilter = document.getElementById('filter-status').value;
      const browserFilter = document.getElementById('filter-browser').value;
      const tagFilter = document.getElementById('filter-tag').value;
      
      document.querySelectorAll('.test-suite').forEach(suite => {
        const name = suite.querySelector('.test-name').textContent.toLowerCase();
        const status = suite.dataset.status;
        const browser = suite.dataset.browser;
        const tags = suite.dataset.tags;
        
        const nameMatch = name.includes(nameFilter);
        const statusMatch = !statusFilter || status === statusFilter;
        const browserMatch = !browserFilter || browser === browserFilter;
        const tagMatch = !tagFilter || tags.includes(tagFilter);
        
        if (nameMatch && statusMatch && browserMatch && tagMatch) {
          suite.style.display = 'block';
        } else {
          suite.style.display = 'none';
        }
      });
    }

    // Toggle test details
    function toggleTestDetails(header) {
      const content = header.nextElementSibling;
      content.style.display = content.style.display === 'block' ? 'none' : 'block';
      header.classList.toggle('expanded');
    }

    // Toggle step details
    function toggleStepDetails(header) {
      const details = header.nextElementSibling;
      details.style.display = details.style.display === 'block' ? 'none' : 'block';
      
      // Toggle nested steps if they exist
      const nestedSteps = header.parentElement.querySelector('.nested-steps');
      if (nestedSteps) {
        nestedSteps.style.display = nestedSteps.style.display === 'block' ? 'none' : 'block';
      }
    }

    // Expand all tests
    function expandAllTests() {
      document.querySelectorAll('.suite-content').forEach(el => {
        el.style.display = 'block';
      });
      document.querySelectorAll('.step-details').forEach(el => {
        el.style.display = 'block';
      });
      document.querySelectorAll('.nested-steps').forEach(el => {
        el.style.display = 'block';
      });
    }

    // Collapse all tests
    function collapseAllTests() {
      document.querySelectorAll('.suite-content').forEach(el => {
        el.style.display = 'none';
      });
      document.querySelectorAll('.step-details').forEach(el => {
        el.style.display = 'none';
      });
      document.querySelectorAll('.nested-steps').forEach(el => {
        el.style.display = 'none';
      });
    }

    // Initialize with dashboard tab active
    showTab('dashboard');
    </script>
</body>
</html>
  `;
}

// [Rest of the file remains the same...]

// Main execution function
async function main() {
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const reportJsonPath = path.resolve(outputDir, DEFAULT_JSON_FILE);
  const reportHtmlPath = path.resolve(outputDir, DEFAULT_HTML_FILE);

  console.log(chalk.blue(`Generating enhanced static report in: ${outputDir}`));

  let reportData;
  try {
    const jsonData = await fs.readFile(reportJsonPath, "utf-8");
    reportData = JSON.parse(jsonData);
    if (
      !reportData ||
      typeof reportData !== "object" ||
      !Array.isArray(reportData.results)
    ) {
      throw new Error("Invalid report JSON structure.");
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }

  try {
    const htmlContent = generateHTML(reportData);
    await fs.writeFile(reportHtmlPath, htmlContent, "utf-8");
    console.log(
      chalk.green(`Report generated successfully at: ${reportHtmlPath}`)
    );
    console.log(chalk.blue(`You can open it in your browser with:`));
    console.log(chalk.blue(`open ${reportHtmlPath}`));
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

// Run the main function
main();