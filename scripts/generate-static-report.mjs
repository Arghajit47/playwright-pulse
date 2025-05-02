#!/usr/bin/env node
// scripts/generate-static-report.mjs
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { format, formatDistanceToNow } from 'date-fns'; // Added for date formatting

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
// Find the project root by looking for package.json
async function findProjectRoot(startDir) {
    let currentDir = startDir;
    while (true) {
        try {
            await fs.access(path.join(currentDir, 'package.json'));
            return currentDir;
        } catch (e) {
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                // Reached the filesystem root
                throw new Error("Could not find project root (package.json). Run this script from within your project.");
            }
            currentDir = parentDir;
        }
    }
}

async function generateReport() {
  let projectRoot;
  try {
    projectRoot = await findProjectRoot(process.cwd());
    // console.log(`Project root found at: ${projectRoot}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  // Attempt to read Playwright config to find pulse reporter outputDir (best effort)
  let pulseOutputDir = path.resolve(projectRoot, "pulse-report-output"); // Default
  const playwrightConfigPathJs = path.join(projectRoot, "playwright.config.js");
  const playwrightConfigPathTs = path.join(projectRoot, "playwright.config.ts");
  let configPath = "";

  try {
    await fs.access(playwrightConfigPathTs);
    configPath = playwrightConfigPathTs;
  } catch {
    try {
      await fs.access(playwrightConfigPathJs);
      configPath = playwrightConfigPathJs;
    } catch {
      console.warn(
        "Warning: Could not find playwright.config.js or playwright.config.ts. Using default output directory 'pulse-report-output'."
      );
    }
  }

  if (configPath) {
    try {
      // Very basic parsing attempt - might fail for complex configs
      const configContent = await fs.readFile(configPath, "utf-8");
      const outputDirMatch = configContent.match(
        /reporter:.*?['"]playwright-pulse-reporter['"].*?outputDir:\s*['"](.*?)['"]/s
      );
      const outputDirMatchAlt = configContent.match(
        /reporter:.*?\[\s*['"]playwright-pulse-reporter['"].*?{\s*outputDir:\s*['"](.*?)['"]\s*}/s
      );
      const outputDirMatchVar = configContent.match(
        /const\s+(\w+)\s*=\s*path\.resolve\(.*?['"](.*?)['"]\)/
      ); // Match const PULSE_REPORT_DIR = path.resolve(__dirname, 'pulse-report-output');
      const outputDirMatchVarUsage = configContent.match(
        /reporter:.*?outputDir:\s*(\w+)/s
      );

      if (outputDirMatch && outputDirMatch[1]) {
        pulseOutputDir = path.resolve(
          path.dirname(configPath),
          outputDirMatch[1]
        );
        // console.log(`Found outputDir in config (regex 1): ${pulseOutputDir}`);
      } else if (outputDirMatchAlt && outputDirMatchAlt[1]) {
        pulseOutputDir = path.resolve(
          path.dirname(configPath),
          outputDirMatchAlt[1]
        );
        // console.log(`Found outputDir in config (regex 2): ${pulseOutputDir}`);
      } else if (
        outputDirMatchVar &&
        outputDirMatchVarUsage &&
        outputDirMatchVar[1] === outputDirMatchVarUsage[1]
      ) {
        pulseOutputDir = path.resolve(
          path.dirname(configPath),
          outputDirMatchVar[2]
        );
        // console.log(`Found outputDir in config (variable): ${pulseOutputDir}`);
      } else {
        console.warn(
          `Warning: Could not automatically detect 'outputDir' for playwright-pulse-reporter in ${configPath}. Using default: ${pulseOutputDir}`
        );
      }
    } catch (err) {
      console.warn(
        `Warning: Error reading or parsing ${configPath}. Using default output directory 'pulse-report-output'. Error: ${err.message}`
      );
    }
  }

  const reportJsonPath = path.join(
    pulseOutputDir,
    "playwright-pulse-report.json"
  );
  const reportHtmlPath = path.join(
    pulseOutputDir,
    "playwright-pulse-static-report.html"
  );

  console.log(`Reading report data from: ${reportJsonPath}`);

  try {
    const reportJsonContent = await fs.readFile(reportJsonPath, "utf-8");
    const reportData = JSON.parse(reportJsonContent, (key, value) => {
      // Date reviver
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
      if (typeof value === "string" && isoDateRegex.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) return date;
      }
      return value;
    });

    if (!reportData || typeof reportData !== "object") {
      throw new Error("Report data is invalid or empty.");
    }

    const htmlContent = generateHtml(reportData);
    await fs.mkdir(path.dirname(reportHtmlPath), { recursive: true }); // Ensure directory exists
    await fs.writeFile(reportHtmlPath, htmlContent);
    console.log(
      `Static HTML report generated successfully at: ${reportHtmlPath}`
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Report JSON file not found at ${reportJsonPath}.`);
      console.error(
        "Ensure Playwright tests ran with 'playwright-pulse-reporter' and the file was generated in the correct output directory."
      );
    } else {
      console.error("Error generating static HTML report:", error);
    }
    process.exit(1);
  }
}

// --- HTML Generation ---

function generateHtml(data) {
  const { run, results } = data;
  const runSummary = run || {
    totalTests: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    timestamp: new Date(),
    id: "N/A",
  };
  if (!run) {
    // Calculate summary if run object is missing
    runSummary.passed = results.filter((r) => r.status === "passed").length;
    runSummary.failed = results.filter((r) => r.status === "failed").length;
    runSummary.skipped = results.filter((r) => r.status === "skipped").length;
    runSummary.duration = results.reduce(
      (sum, r) => sum + (r.duration || 0),
      0
    );
  }

  const groupedResults = results.reduce((acc, result) => {
    const suite = result.suiteName || "Default Suite";
    if (!acc[suite]) {
      acc[suite] = [];
    }
    acc[suite].push(result);
    return acc;
  }, {});

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse Report</title>
    <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; margin: 0; background-color: #f9fafb; color: #1f2937; line-height: 1.5; }
        .container { max-width: 1200px; margin: 20px auto; padding: 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
        header { border-bottom: 1px solid #e5e7eb; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        header h1 { font-size: 1.8rem; font-weight: 600; color: #374151; margin: 0; }
        .run-info { font-size: 0.9rem; color: #6b7280; text-align: right; }
        .tabs { display: flex; border-bottom: 2px solid #e5e7eb; margin-bottom: 20px; }
        .tab-button { padding: 10px 20px; cursor: pointer; border: none; background: none; font-size: 1rem; font-weight: 500; color: #6b7280; border-bottom: 2px solid transparent; margin-bottom: -2px; }
        .tab-button.active { color: #10b981; border-bottom-color: #10b981; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 25px; }
        .summary-card { background-color: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 15px; text-align: center; }
        .summary-card-label { display: block; font-size: 0.85rem; color: #6b7280; margin-bottom: 5px; }
        .summary-card-value { display: block; font-size: 1.75rem; font-weight: 600; color: #1f2937; }
        .status-distro { background-color: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 20px; margin-top: 20px; }
        .status-distro h3 { font-size: 1.1rem; font-weight: 600; margin: 0 0 15px 0; color: #374151; }
        .status-bar-container { display: flex; height: 20px; border-radius: 4px; overflow: hidden; background-color: #e5e7eb; margin-bottom: 10px; }
        .status-bar { height: 100%; transition: width 0.3s ease-in-out; }
        .status-bar.passed { background-color: #10b981; }
        .status-bar.failed { background-color: #ef4444; }
        .status-bar.skipped { background-color: #f59e0b; }
        .status-legend { display: flex; justify-content: center; gap: 20px; font-size: 0.9rem; }
        .legend-item { display: flex; align-items: center; gap: 5px; }
        .legend-color { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
        .filters { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; padding: 15px; background-color: #f3f4f6; border-radius: 6px; border: 1px solid #e5e7eb;}
        .filters label { font-weight: 500; color: #4b5563; }
        .filters input[type="text"], .filters select { padding: 8px 12px; border-radius: 4px; border: 1px solid #d1d5db; font-size: 0.9rem; }
        .filters input[type="text"] { flex-grow: 1; min-width: 200px; }
        .test-suite { margin-bottom: 25px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
        .suite-header { background-color: #f3f4f6; padding: 10px 15px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; cursor: pointer; user-select: none; }
        .suite-header::before { content: '▶ '; display: inline-block; transition: transform 0.2s; margin-right: 5px; }
        .suite-header.expanded::before { transform: rotate(90deg); }
        .suite-content { display: none; padding: 0; }
        .suite-content.expanded { display: block; }
        .test-result { border-bottom: 1px solid #e5e7eb; padding: 15px; display: flex; align-items: center; gap: 15px; background-color: #fff; cursor: pointer; transition: background-color 0.2s; }
        .test-result:last-child { border-bottom: none; }
        .test-result:hover { background-color: #f9fafb; }
        .test-status { flex-shrink: 0; padding: 3px 8px; font-size: 0.8rem; font-weight: 500; border-radius: 12px; text-transform: capitalize; }
        .status-passed { background-color: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
        .status-failed { background-color: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
        .status-skipped { background-color: #ffedd5; color: #9a3412; border: 1px solid #fdba74; }
        .test-info { flex-grow: 1; }
        .test-name { font-weight: 500; color: #11182c; margin-bottom: 3px; }
        .test-meta { font-size: 0.8rem; color: #6b7280; }
        .test-duration::before { content: '⏱ '; }
        .test-retries::before { content: '🔁 '; margin-left: 10px;}
        .test-details { display: none; padding: 15px; background-color: #f8f9fa; border-top: 1px dashed #d1d5db; }
        .details-section { margin-bottom: 15px; }
        .details-section h4 { font-size: 1rem; font-weight: 600; color: #374151; margin: 0 0 8px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px;}
        .details-content pre { background-color: #e5e7eb; padding: 10px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; font-size: 0.85rem; white-space: pre-wrap; word-wrap: break-word; color: #1f2937; max-height: 300px; overflow-y: auto; }
        .step-list { list-style: none; padding: 0; margin: 0; }
        .step-item { padding: 8px 0; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 10px; }
        .step-item:last-child { border-bottom: none; }
        .step-status { flex-shrink: 0; font-size: 1.1rem; }
        .step-status-passed { color: #10b981; }
        .step-status-failed { color: #ef4444; }
        .step-status-skipped { color: #f59e0b; }
        .step-title { flex-grow: 1; font-size: 0.9rem; }
        .step-duration { font-size: 0.8rem; color: #6b7280; flex-shrink: 0; }
        .step-error { font-size: 0.85rem; color: #ef4444; margin-top: 5px; padding-left: 25px; }
        .attachment-section img, .attachment-section video { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid #d1d5db; margin-top: 5px; }
        .attachment-section video { max-width: 400px; }
        .no-results { text-align: center; padding: 30px; color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Playwright Pulse Report</h1>
            <div class="run-info">
                Run ID: ${runSummary.id}<br>
                Generated: ${format(new Date(), "PP pp")}
            </div>
        </header>

        <div class="tabs">
            <button class="tab-button active" onclick="openTab(event, 'dashboard')">Dashboard</button>
            <button class="tab-button" onclick="openTab(event, 'testRuns')">Test Runs</button>
        </div>

        <div id="dashboard" class="tab-content active">
            <h2>Run Summary</h2>
            <div class="summary-grid">
                <div class="summary-card">
                    <span class="summary-card-label">Total Tests</span>
                    <span class="summary-card-value">${
                      runSummary.totalTests
                    }</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-label">Passed</span>
                    <span class="summary-card-value" style="color: #10b981;">${
                      runSummary.passed
                    }</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-label">Failed</span>
                    <span class="summary-card-value" style="color: #ef4444;">${
                      runSummary.failed
                    }</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-label">Skipped</span>
                    <span class="summary-card-value" style="color: #f59e0b;">${
                      runSummary.skipped
                    }</span>
                </div>
                <div class="summary-card">
                    <span class="summary-card-label">Duration</span>
                    <span class="summary-card-value">${(
                      runSummary.duration / 1000
                    ).toFixed(1)}s</span>
                </div>
            </div>

            <div class="status-distro">
                <h3>Test Status Distribution</h3>
                <div class="status-bar-container">
                    ${generateStatusBar(runSummary)}
                </div>
                <div class="status-legend">
                    ${generateLegendItem(
                      "Passed",
                      runSummary.passed,
                      runSummary.totalTests,
                      "passed"
                    )}
                    ${generateLegendItem(
                      "Failed",
                      runSummary.failed,
                      runSummary.totalTests,
                      "failed"
                    )}
                    ${generateLegendItem(
                      "Skipped",
                      runSummary.skipped,
                      runSummary.totalTests,
                      "skipped"
                    )}
                </div>
            </div>
        </div>

        <div id="testRuns" class="tab-content">
            <h2>All Test Results</h2>
             <div class="filters">
                <label for="statusFilter">Filter by Status:</label>
                <select id="statusFilter">
                    <option value="all">All Statuses</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                </select>
                <label for="suiteFilter">Filter by Suite:</label>
                <select id="suiteFilter">
                    <option value="all">All Suites</option>
                    ${Object.keys(groupedResults)
                      .map(
                        (suiteName) =>
                          `<option value="${suiteName}">${suiteName}</option>`
                      )
                      .join("")}
                </select>
                 <label for="searchFilter">Search:</label>
                <input type="text" id="searchFilter" placeholder="Search by test name...">
            </div>

            <div id="test-list">
                ${generateTestList(groupedResults)}
            </div>
             <div id="no-results-message" class="no-results" style="display: none;">No tests found matching your criteria.</div>
        </div>

    </div>

    <script>
        function openTab(evt, tabName) {
            var i, tabcontent, tablinks;
            tabcontent = document.getElementsByClassName("tab-content");
            for (i = 0; i < tabcontent.length; i++) {
                tabcontent[i].style.display = "none";
                tabcontent[i].classList.remove("active");
            }
            tablinks = document.getElementsByClassName("tab-button");
            for (i = 0; i < tablinks.length; i++) {
                tablinks[i].classList.remove("active");
            }
            document.getElementById(tabName).style.display = "block";
            document.getElementById(tabName).classList.add("active");
            evt.currentTarget.classList.add("active");
        }

        function toggleDetails(element) {
            const detailsDiv = element.nextElementSibling;
            if (detailsDiv && detailsDiv.classList.contains('test-details')) {
                detailsDiv.style.display = detailsDiv.style.display === 'none' ? 'block' : 'none';
            }
        }

         function toggleSuite(element) {
            const contentDiv = element.nextElementSibling;
            element.classList.toggle('expanded');
            contentDiv.classList.toggle('expanded');
            contentDiv.style.display = contentDiv.style.display === 'block' ? 'none' : 'block'; // Toggle display
         }

        // Initialize suite toggles
        document.querySelectorAll('.suite-header').forEach(header => {
            header.addEventListener('click', () => toggleSuite(header));
            // Optionally expand all suites by default
            // toggleSuite(header);
        });

         // Initialize test result details toggles
        document.querySelectorAll('.test-result').forEach(item => {
            item.addEventListener('click', (event) => {
                 // Prevent toggling details when clicking on a link inside details
                if (event.target.closest('a, img, video')) return;
                 toggleDetails(item);
            });
        });

        // Filtering logic
        const statusFilter = document.getElementById('statusFilter');
        const suiteFilter = document.getElementById('suiteFilter');
        const searchFilter = document.getElementById('searchFilter');
        const testListContainer = document.getElementById('test-list');
        const noResultsMessage = document.getElementById('no-results-message');

        function applyFilters() {
            const selectedStatus = statusFilter.value;
            const selectedSuite = suiteFilter.value;
            const searchTerm = searchFilter.value.toLowerCase();
            let hasVisibleResults = false;

            document.querySelectorAll('.test-suite').forEach(suiteElement => {
                let suiteHasVisibleTests = false;
                const suiteName = suiteElement.getAttribute('data-suite-name');

                // Suite filter
                if (selectedSuite !== 'all' && suiteName !== selectedSuite) {
                    suiteElement.style.display = 'none';
                    return; // Skip processing tests in this suite
                } else {
                    suiteElement.style.display = 'block'; // Show suite if it matches or 'all' is selected
                }

                 suiteElement.querySelectorAll('.test-result').forEach(testElement => {
                     const testStatus = testElement.getAttribute('data-status');
                     const testName = testElement.querySelector('.test-name').textContent.toLowerCase();
                     let isVisible = true;

                     // Status filter
                     if (selectedStatus !== 'all' && testStatus !== selectedStatus) {
                         isVisible = false;
                     }

                     // Search filter
                     if (searchTerm && !testName.includes(searchTerm)) {
                         isVisible = false;
                     }

                    testElement.style.display = isVisible ? 'flex' : 'none';
                    if (isVisible) {
                        suiteHasVisibleTests = true;
                         hasVisibleResults = true; // Mark that at least one test is visible overall
                    }
                 });

                 // Hide suite header if no tests within it are visible
                 if (!suiteHasVisibleTests) {
                     suiteElement.style.display = 'none';
                 } else {
                      suiteElement.style.display = 'block'; // Ensure suite is visible if it has results
                 }
            });

             // Show/hide the "no results" message
            noResultsMessage.style.display = hasVisibleResults ? 'none' : 'block';
        }

        statusFilter.addEventListener('change', applyFilters);
        suiteFilter.addEventListener('change', applyFilters);
        searchFilter.addEventListener('input', applyFilters);

        // Initial filter application
        applyFilters();

    </script>
</body>
</html>
    `;
}

function generateStatusBar(summary) {
  const total = summary.totalTests;
  if (total === 0)
    return '<div class="status-bar" style="width: 100%; background-color: #e5e7eb;"></div>'; // Handle no tests case
  const passedWidth = total > 0 ? (summary.passed / total) * 100 : 0;
  const failedWidth = total > 0 ? (summary.failed / total) * 100 : 0;
  const skippedWidth = 100 - passedWidth - failedWidth; // Remainder

  return `
        <div class="status-bar passed" style="width: ${passedWidth}%;" title="Passed: ${summary.passed}"></div>
        <div class="status-bar failed" style="width: ${failedWidth}%;" title="Failed: ${summary.failed}"></div>
        <div class="status-bar skipped" style="width: ${skippedWidth}%;" title="Skipped: ${summary.skipped}"></div>
    `;
}

function generateLegendItem(label, count, total, statusClass) {
  if (total === 0) return ""; // Don't show legend items if no tests
  const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
  return `
        <div class="legend-item">
            <span class="legend-color status-${statusClass}"></span>
            <span>${label}: ${count} (${percentage}%)</span>
        </div>
    `;
}

function generateTestList(groupedResults) {
  if (Object.keys(groupedResults).length === 0) {
    return '<div class="no-results">No test results available.</div>';
  }
  return Object.entries(groupedResults)
    .map(
      ([suiteName, tests]) => `
        <div class="test-suite" data-suite-name="${escapeHtml(suiteName)}">
            <div class="suite-header">${escapeHtml(suiteName)} (${
        tests.length
      })</div>
            <div class="suite-content">
                ${tests.map((test) => generateTestResultItem(test)).join("")}
            </div>
        </div>
    `
    )
    .join("");
}

function generateTestResultItem(result) {
  const timeAgo = result.endTime
    ? formatDistanceToNow(result.endTime, { addSuffix: true })
    : "N/A";
  const durationSeconds = result.duration
    ? (result.duration / 1000).toFixed(2) + "s"
    : "N/A";

  // Generate attachments HTML only if needed
  const attachmentsHtml =
    result.status === "failed" || result.status === "skipped"
      ? generateAttachmentsHtml(result)
      : "";

  return `
        <div class="test-result" data-status="${result.status}">
            <span class="test-status status-${result.status}">${
    result.status
  }</span>
            <div class="test-info">
                <div class="test-name">${escapeHtml(result.name)}</div>
                <div class="test-meta">
                    <span class="test-duration">${durationSeconds}</span>
                    ${
                      result.retries > 0
                        ? `<span class="test-retries">${result.retries} retries</span>`
                        : ""
                    }
                    <span style="margin-left: 10px;">Finished ${timeAgo}</span>
                 </div>
            </div>
        </div>
        <div class="test-details" style="display: none;">
            ${
              result.errorMessage
                ? `
                <div class="details-section">
                    <h4>Error Message</h4>
                    <div class="details-content"><pre><code>${escapeHtml(
                      result.errorMessage
                    )}</code></pre></div>
                </div>
            `
                : ""
            }
             ${
               result.stackTrace
                 ? `
                <div class="details-section">
                    <h4>Stack Trace</h4>
                    <div class="details-content"><pre><code>${escapeHtml(
                      result.stackTrace
                    )}</code></pre></div>
                </div>
            `
                 : ""
             }
            <div class="details-section">
                <h4>Test Steps (${result.steps?.length || 0})</h4>
                <div class="details-content">
                    ${generateStepsHtml(result.steps || [])}
                </div>
            </div>
             ${attachmentsHtml} {/* Include attachments section */}
             ${
               result.codeSnippet
                 ? `
                <div class="details-section">
                    <h4>Code Snippet</h4>
                     <div class="details-content"><pre><code>${escapeHtml(
                       result.codeSnippet
                     )}</code></pre></div>
                 </div>
            `
                 : ""
             }
             <div class="details-section">
                <h4>Timestamps</h4>
                 <div class="details-content" style="font-size: 0.85rem;">
                    Start: ${
                      result.startTime
                        ? format(result.startTime, "PP pp")
                        : "N/A"
                    }<br>
                    End: ${
                      result.endTime ? format(result.endTime, "PP pp") : "N/A"
                    }
                </div>
             </div>
        </div>
    `;
}

function generateStepsHtml(steps) {
  if (!steps || steps.length === 0) {
    return "<p>No steps recorded.</p>";
  }
  return `
        <ul class="step-list">
            ${steps
              .map(
                (step) => `
                <li class="step-item">
                    <span class="step-status step-status-${step.status}">
                        ${
                          step.status === "passed"
                            ? "✓"
                            : step.status === "failed"
                            ? "✕"
                            : "»"
                        }
                    </span>
                    <span class="step-title">${escapeHtml(step.title)}</span>
                    <span class="step-duration">(${(
                      step.duration / 1000
                    ).toFixed(2)}s)</span>
                 </li>
                 ${
                   step.errorMessage
                     ? `<li class="step-error">${escapeHtml(
                         step.errorMessage
                       )}</li>`
                     : ""
                 }
                  ${
                    step.screenshot
                      ? `<li><div class="attachment-section"><img src="${escapeHtml(
                          step.screenshot
                        )}" alt="Step Screenshot" loading="lazy"></div></li>`
                      : ""
                  }
            `
              )
              .join("")}
        </ul>
    `;
}

function generateAttachmentsHtml(result) {
  let html =
    '<div class="details-section attachment-section"><h4>Attachments</h4><div class="details-content">';
  let foundAttachment = false;

  if (result.screenshot) {
    // Assume screenshot path is absolute or relative *to the project root* where tests ran
    // We need to make it relative to the HTML report location for it to work reliably
    const relativeScreenshotPath = path.relative(
      path.dirname(reportHtmlPath),
      result.screenshot
    );
    html += `
            <div>
                <h5>Screenshot (on failure/skip)</h5>
                 <a href="${escapeHtml(
                   relativeScreenshotPath
                 )}" target="_blank" rel="noopener noreferrer">
                    <img src="${escapeHtml(
                      relativeScreenshotPath
                    )}" alt="Failure Screenshot" loading="lazy" style="max-width: 400px; height: auto;">
                 </a>
            </div>`;
    foundAttachment = true;
  }

  if (result.video) {
    const relativeVideoPath = path.relative(
      path.dirname(reportHtmlPath),
      result.video
    );
    html += `
             <div style="margin-top: 15px;">
                 <h5>Video Recording</h5>
                 <video controls preload="none" style="max-width: 400px;">
                     <source src="${escapeHtml(
                       relativeVideoPath
                     )}" type="video/webm">
                     Your browser does not support the video tag. <a href="${escapeHtml(
                       relativeVideoPath
                     )}" target="_blank">Download video</a>
                 </video>
            </div>`;
    foundAttachment = true;
  }

  if (!foundAttachment) {
    html += "<p>No attachments available for this test.</p>";
  }

  html += "</div></div>";
  return html;
}

function escapeHtml(unsafe) {
  if (unsafe === null || typeof unsafe === "undefined") {
    return "";
  }
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// --- Execution ---
generateReport();

    