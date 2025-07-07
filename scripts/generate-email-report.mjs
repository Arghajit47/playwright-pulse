#!/usr/bin/env node

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

const DEFAULT_OUTPUT_DIR = "pulse-report";
const DEFAULT_JSON_FILE = "playwright-pulse-report.json";
const MINIFIED_HTML_FILE = "pulse-email-summary.html"; // New minified report

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
function formatDuration(ms, options = {}) {
  const {
    precision = 1,
    invalidInputReturn = "N/A",
    defaultForNullUndefinedNegative = null,
  } = options;

  const validPrecision = Math.max(0, Math.floor(precision));
  const zeroWithPrecision = (0).toFixed(validPrecision) + "s";
  const resolvedNullUndefNegReturn =
    defaultForNullUndefinedNegative === null
      ? zeroWithPrecision
      : defaultForNullUndefinedNegative;

  if (ms === undefined || ms === null) {
    return resolvedNullUndefNegReturn;
  }

  const numMs = Number(ms);

  if (Number.isNaN(numMs) || !Number.isFinite(numMs)) {
    return invalidInputReturn;
  }

  if (numMs < 0) {
    return resolvedNullUndefNegReturn;
  }

  if (numMs === 0) {
    return zeroWithPrecision;
  }

  const MS_PER_SECOND = 1000;
  const SECONDS_PER_MINUTE = 60;
  const MINUTES_PER_HOUR = 60;
  const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

  const totalRawSeconds = numMs / MS_PER_SECOND;

  // Decision: Are we going to display hours or minutes?
  // This happens if the duration is inherently >= 1 minute OR
  // if it's < 1 minute but ceiling the seconds makes it >= 1 minute.
  if (
    totalRawSeconds < SECONDS_PER_MINUTE &&
    Math.ceil(totalRawSeconds) < SECONDS_PER_MINUTE
  ) {
    // Strictly seconds-only display, use precision.
    return `${totalRawSeconds.toFixed(validPrecision)}s`;
  } else {
    // Display will include minutes and/or hours, or seconds round up to a minute.
    // Seconds part should be an integer (ceiling).
    // Round the total milliseconds UP to the nearest full second.
    const totalMsRoundedUpToSecond =
      Math.ceil(numMs / MS_PER_SECOND) * MS_PER_SECOND;

    let remainingMs = totalMsRoundedUpToSecond;

    const h = Math.floor(remainingMs / (MS_PER_SECOND * SECONDS_PER_HOUR));
    remainingMs %= MS_PER_SECOND * SECONDS_PER_HOUR;

    const m = Math.floor(remainingMs / (MS_PER_SECOND * SECONDS_PER_MINUTE));
    remainingMs %= MS_PER_SECOND * SECONDS_PER_MINUTE;

    const s = Math.floor(remainingMs / MS_PER_SECOND); // This will be an integer

    const parts = [];
    if (h > 0) {
      parts.push(`${h}h`);
    }

    // Show minutes if:
    // - hours are present (e.g., "1h 0m 5s")
    // - OR minutes themselves are > 0 (e.g., "5m 10s")
    // - OR the original duration was >= 1 minute (ensures "1m 0s" for 60000ms)
    if (h > 0 || m > 0 || numMs >= MS_PER_SECOND * SECONDS_PER_MINUTE) {
      parts.push(`${m}m`);
    }

    parts.push(`${s}s`);

    return parts.join(" ");
  }
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
  const allBrowsers = new Set();
  if (results && results.length > 0) {
    results.forEach((test) => {
      const browser = test.browser || "unknown";
      allBrowsers.add(browser);
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
        <div class="browser-section" data-browser-group="${sanitizeHTML(
          browser.toLowerCase()
        )}">
          <h2 class="browser-title">${sanitizeHTML(capitalize(browser))}</h2>
          <ul class="test-list">
      `;
      tests.forEach((test) => {
        const testFileParts = test.name.split(" > ");
        const testTitle =
          testFileParts[testFileParts.length - 1] || "Unnamed Test";
        html += `
            <li class="test-item ${getStatusClass(test.status)}" 
                data-test-name-min="${sanitizeHTML(testTitle.toLowerCase())}" 
                data-status-min="${sanitizeHTML(
                  String(test.status).toLowerCase()
                )}"
                data-browser-min="${sanitizeHTML(browser.toLowerCase())}">
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
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="https://i.postimg.cc/v817w4sg/logo.png">
    <link rel="apple-touch-icon" href="https://i.postimg.cc/v817w4sg/logo.png">
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
            height: 40px;
            width: 55px;
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
        
        /* Filters Section */
        .filters-section {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--light-gray-color);
            border-radius: var(--border-radius);
            border: 1px solid var(--border-color);
        }
        .filters-section input[type="text"],
        .filters-section select {
            padding: 8px 12px;
            border: 1px solid var(--medium-gray-color);
            border-radius: 4px;
            font-size: 0.95em;
            flex-grow: 1;
        }
        .filters-section select {
            min-width: 150px;
        }
        .filters-section button {
            padding: 8px 15px;
            font-size: 0.95em;
            background-color: var(--secondary-color);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s ease;
        }
        .filters-section button:hover {
            background-color: var(--primary-color);
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
            transition: background-color 0.2s ease, display 0.3s ease-out;
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
            .summary-stats { grid-template-columns: 1fr 1fr; }
            .filters-section { flex-direction: column; }
        }
        @media (max-width: 480px) {
            .summary-stats { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="report-header">
            <div class="report-header-title">
                <img id="report-logo" src="https://i.postimg.cc/v817w4sg/logo.png" alt="Report Logo">
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
            
            <div class="filters-section">
                <input type="text" id="filter-min-name" placeholder="Search by test name...">
                <select id="filter-min-status">
                    <option value="">All Statuses</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                    <option value="unknown">Unknown</option>
                </select>
                <select id="filter-min-browser">
                    <option value="">All Browsers</option>
                    ${Array.from(allBrowsers)
                      .map(
                        (browser) =>
                          `<option value="${sanitizeHTML(
                            browser.toLowerCase()
                          )}">${sanitizeHTML(capitalize(browser))}</option>`
                      )
                      .join("")}
                </select>
                <button id="clear-min-filters">Clear Filters</button>
            </div>

            ${generateTestListHTML()}
        </section>
        
        <footer class="report-footer">
            <div style="display: inline-flex; align-items: center; gap: 0.5rem;">
                <span>Created for</span>
                <a href="https://github.com/Arghajit47" target="_blank" rel="noopener noreferrer">
                    Pulse Email Report
                </a>
            </div>
            <div style="margin-top: 0.3rem; font-size: 0.7rem;">Crafted with precision</div>
        </footer>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const nameFilterMin = document.getElementById('filter-min-name');
            const statusFilterMin = document.getElementById('filter-min-status');
            const browserFilterMin = document.getElementById('filter-min-browser');
            const clearMinFiltersBtn = document.getElementById('clear-min-filters');
            const testItemsMin = document.querySelectorAll('.test-results-section .test-item');
            const browserSections = document.querySelectorAll('.test-results-section .browser-section');

            function filterMinifiedTests() {
                const nameValue = nameFilterMin.value.toLowerCase();
                const statusValue = statusFilterMin.value;
                const browserValue = browserFilterMin.value;
                let anyBrowserSectionVisible = false;

                browserSections.forEach(section => {
                    let sectionHasVisibleTests = false;
                    const testsInThisSection = section.querySelectorAll('.test-item');
                    
                    testsInThisSection.forEach(testItem => {
                        const testName = testItem.getAttribute('data-test-name-min');
                        const testStatus = testItem.getAttribute('data-status-min');
                        const testBrowser = testItem.getAttribute('data-browser-min');

                        const nameMatch = testName.includes(nameValue);
                        const statusMatch = !statusValue || testStatus === statusValue;
                        const browserMatch = !browserValue || testBrowser === browserValue;

                        if (nameMatch && statusMatch && browserMatch) {
                            testItem.style.display = 'flex';
                            sectionHasVisibleTests = true;
                            anyBrowserSectionVisible = true;
                        } else {
                            testItem.style.display = 'none';
                        }
                    });
                    // Hide browser section if no tests match OR if a specific browser is selected and it's not this one
                     if (!sectionHasVisibleTests || (browserValue && section.getAttribute('data-browser-group') !== browserValue)) {
                        section.style.display = 'none';
                    } else {
                        section.style.display = '';
                    }
                });
                
                // Show "no tests" message if all sections are hidden
                const noTestsMessage = document.querySelector('.test-results-section .no-tests');
                if (noTestsMessage) {
                    noTestsMessage.style.display = anyBrowserSectionVisible ? 'none' : 'block';
                }

            }

            if (nameFilterMin) nameFilterMin.addEventListener('input', filterMinifiedTests);
            if (statusFilterMin) statusFilterMin.addEventListener('change', filterMinifiedTests);
            if (browserFilterMin) browserFilterMin.addEventListener('change', filterMinifiedTests);
            
            if (clearMinFiltersBtn) {
                clearMinFiltersBtn.addEventListener('click', () => {
                    nameFilterMin.value = '';
                    statusFilterMin.value = '';
                    browserFilterMin.value = '';
                    filterMinifiedTests();
                });
            }
            // Initial filter call in case of pre-filled values (though unlikely here)
             if (testItemsMin.length > 0) { // Only filter if there are items
                filterMinifiedTests();
            }
        });

        // Fallback helper functions (though ideally not needed client-side for this minified report)
        if (typeof formatDuration === 'undefined') {
             function formatDuration(ms) { 
                if (ms === undefined || ms === null || ms < 0) return "0.0s";
                return (ms / 1000).toFixed(1) + "s";
            }
        }
         if (typeof formatDate === 'undefined') {
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
