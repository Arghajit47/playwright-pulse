#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Determine the project root based on script location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Assume the script is in 'scripts/' directory, go up one level for project root
const projectRoot = path.resolve(__dirname, '..');

const defaultReportDir = "pulse-report-output";
const defaultJsonFile = "playwright-pulse-report.json";
const defaultHtmlFile = "playwright-pulse-static-report.html";

async function generateStaticReport() {
  const reportDir = path.resolve(projectRoot, defaultReportDir);
  const jsonFilePath = path.join(reportDir, defaultJsonFile);
  const htmlFilePath = path.join(reportDir, defaultHtmlFile);

  console.log(`Reading report data from: ${jsonFilePath}`);

  let reportData;
  try {
    const fileContent = await fs.readFile(jsonFilePath, "utf-8");
    // Basic JSON parsing (dates will be strings, handled in HTML generation)
    reportData = JSON.parse(fileContent);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Report JSON file not found at ${jsonFilePath}.`);
      console.error(
        "Ensure Playwright tests ran with 'playwright-pulse-reporter' and the file was generated."
      );
    } else {
      console.error(
        `Error reading or parsing report JSON file: ${error.message}`
      );
    }
    process.exit(1);
  }

  console.log("Generating static HTML report...");

  const { run, results } = reportData;

  // Helper function to format duration
  const formatDuration = (ms) => (ms / 1000).toFixed(2) + "s";

  // Helper function to format date strings (assuming ISO format)
  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return dateString || "N/A"; // Fallback
    }
  };

  // --- Generate HTML Content ---
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse - Static Report</title>
    <style>
        /* Reset and Base Styles */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        body { background-color: #f8f9fa; color: #343a40; padding: 2rem; }
        h1, h2, h3, h4, h5, h6 { font-weight: 600; margin-bottom: 0.75rem; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
        pre { background-color: #e9ecef; padding: 1rem; border-radius: 0.3rem; overflow-x: auto; font-family: monospace; font-size: 0.875rem; margin-top: 0.5rem; margin-bottom: 1rem; white-space: pre-wrap; word-wrap: break-word; }
        code { font-family: monospace; }

        /* Layout */
        .container { max-width: 1200px; margin: 0 auto; }
        .grid { display: grid; gap: 1.5rem; }
        .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
        .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .grid-cols-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .space-y-6 > * + * { margin-top: 1.5rem; }

        /* Card Component */
        .card { background-color: #ffffff; border: 1px solid #dee2e6; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; display: flex; flex-direction: column; }
        .card-header { padding: 1rem 1.5rem; border-bottom: 1px solid #e9ecef; }
        .card-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; }
        .card-description { color: #6c757d; font-size: 0.875rem; }
        .card-content { padding: 1.5rem; flex-grow: 1; }
        .card-footer { padding: 1rem 1.5rem; border-top: 1px solid #e9ecef; background-color: #f8f9fa; color: #6c757d; font-size: 0.875rem; }

        /* Badge Component */
        .badge { display: inline-flex; align-items: center; padding: 0.25em 0.6em; font-size: 0.75rem; font-weight: 600; line-height: 1; text-align: center; white-space: nowrap; vertical-align: baseline; border-radius: 0.375rem; border: 1px solid transparent; }
        .badge-passed { color: #155724; background-color: #d4edda; border-color: #c3e6cb; }
        .badge-failed { color: #721c24; background-color: #f8d7da; border-color: #f5c6cb; }
        .badge-skipped { color: #856404; background-color: #fff3cd; border-color: #ffeeba; }
        .badge svg { width: 0.75em; height: 0.75em; margin-right: 0.25em; }

        /* Text Colors */
        .text-green-600 { color: #28a745; }
        .text-red-600 { color: #dc3545; }
        .text-yellow-600 { color: #ffc107; }
        .text-muted-foreground { color: #6c757d; }
        .text-destructive { color: #dc3545; }

        /* Icons (Inline SVG for simplicity) */
        .icon { display: inline-block; width: 1em; height: 1em; vertical-align: -0.125em; fill: currentColor; }
        .icon-list-checks { /* SVG Placeholder */}
        .icon-check-circle { /* SVG Placeholder */}
        .icon-x-circle { /* SVG Placeholder */}
        .icon-skip-forward { /* SVG Placeholder */}
        .icon-clock { /* SVG Placeholder */}
        .icon-alert-triangle { /* SVG Placeholder */}
        .icon-code { /* SVG Placeholder */}

         /* Chart Placeholders */
        .chart-placeholder { min-height: 200px; display: flex; align-items: center; justify-content: center; background-color: #e9ecef; border-radius: 0.3rem; color: #6c757d; font-style: italic; }
        .chart-legend { list-style: none; padding: 0; display: flex; justify-content: center; gap: 1rem; margin-top: 1rem; font-size: 0.875rem; }
        .chart-legend li { display: flex; align-items: center; gap: 0.5rem; }
        .legend-color-box { width: 12px; height: 12px; border-radius: 2px; }

         /* Test Result Item */
        .test-result-item { border-bottom: 1px solid #e9ecef; padding: 1rem; transition: background-color 0.2s ease-in-out; }
        .test-result-item:last-child { border-bottom: none; }
        .test-result-item:hover { background-color: #f8f9fa; }
        .test-result-item .status-duration { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
        .test-result-item .title { font-weight: 500; color: #007bff; margin-bottom: 0.25rem; display: block;}
        .test-result-item .suite { font-size: 0.8rem; color: #6c757d; margin-bottom: 0.5rem;}
        .test-result-item .error { font-size: 0.8rem; color: #dc3545; margin-top: 0.5rem; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .test-result-item .time { font-size: 0.75rem; color: #6c757d; text-align: right; margin-top: 0.5rem; }

        /* Responsive */
        @media (max-width: 768px) {
          body { padding: 1rem; }
          .grid-cols-5, .grid-cols-4, .grid-cols-3, .grid-cols-2 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
        }

    </style>
</head>
<body>
    <div class="container space-y-6">
        <header>
            <h1>Playwright Pulse Report</h1>
            ${
              run
                ? `<p class="text-muted-foreground">Generated: ${formatDate(
                    reportData.metadata?.generatedAt
                  )} | Run ID: ${run.id} | Run Timestamp: ${formatDate(
                    run.timestamp
                  )}</p>`
                : '<p class="text-muted-foreground">No run data available.</p>'
            }
        </header>

        <!-- Summary Metrics -->
        ${
          run
            ? `
        <h2>Summary</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5">
            <div class="card">
                <div class="card-header"><h4 class="card-title text-sm font-medium text-muted-foreground">Total Tests</h4></div>
                <div class="card-content"><div class="text-2xl font-bold">${
                  run.totalTests
                }</div></div>
            </div>
            <div class="card">
                <div class="card-header"><h4 class="card-title text-sm font-medium text-muted-foreground">Passed</h4></div>
                <div class="card-content"><div class="text-2xl font-bold text-green-600">${
                  run.passed
                }</div></div>
            </div>
            <div class="card">
                <div class="card-header"><h4 class="card-title text-sm font-medium text-muted-foreground">Failed</h4></div>
                <div class="card-content"><div class="text-2xl font-bold text-red-600">${
                  run.failed
                }</div></div>
            </div>
            <div class="card">
                <div class="card-header"><h4 class="card-title text-sm font-medium text-muted-foreground">Skipped</h4></div>
                <div class="card-content"><div class="text-2xl font-bold text-yellow-600">${
                  run.skipped
                }</div></div>
            </div>
            <div class="card">
                <div class="card-header"><h4 class="card-title text-sm font-medium text-muted-foreground">Duration</h4></div>
                <div class="card-content"><div class="text-2xl font-bold">${formatDuration(
                  run.duration
                )}</div></div>
            </div>
        </div>
        `
            : ""
        }

        <!-- Charts -->
        <div class="grid grid-cols-1 md:grid-cols-2">
            <!-- Test Status Pie Chart Placeholder -->
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Test Status Distribution</h3>
                    <p class="card-description">Latest Run Summary</p>
                </div>
                <div class="card-content">
                    ${
                      run && run.totalTests > 0
                        ? `
                    <div class="chart-placeholder" style="padding: 1rem; text-align: center;">
                        <p><strong>Total Tests:</strong> ${run.totalTests}</p>
                        <ul class="chart-legend">
                            <li><span class="legend-color-box" style="background-color: #d4edda;"></span>Passed: ${
                              run.passed
                            } (${((run.passed / run.totalTests) * 100).toFixed(
                            1
                          )}%)</li>
                            <li><span class="legend-color-box" style="background-color: #f8d7da;"></span>Failed: ${
                              run.failed
                            } (${((run.failed / run.totalTests) * 100).toFixed(
                            1
                          )}%)</li>
                            <li><span class="legend-color-box" style="background-color: #fff3cd;"></span>Skipped: ${
                              run.skipped
                            } (${((run.skipped / run.totalTests) * 100).toFixed(
                            1
                          )}%)</li>
                        </ul>
                        <p style="font-size: 0.8rem; margin-top: 1rem;">(Actual chart rendering requires JavaScript or server-side generation)</p>
                    </div>
                    `
                        : `<p class="text-muted-foreground chart-placeholder">No data to display chart.</p>`
                    }
                </div>
            </div>

            <!-- Trends Area Chart Placeholder -->
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Test Result Trends</h3>
                     <p class="card-description">Trends over time (placeholder)</p>
                </div>
                 <div class="card-content">
                     <div class="chart-placeholder">Trend chart placeholder</div>
                 </div>
            </div>
        </div>

        <!-- Test Results -->
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Test Results</h2>
                 <p class="card-description">Details for each test case.</p>
            </div>
            <div class="card-content" style="padding: 0;"> <!-- Remove padding for list items -->
                 ${
                   results.length > 0
                     ? results
                         .map(
                           (test) => `
                    <div class="test-result-item">
                        <div class="status-duration">
                            <span class="badge badge-${test.status}">${
                             test.status.charAt(0).toUpperCase() +
                             test.status.slice(1)
                           }</span>
                            <span class="text-xs text-muted-foreground">Duration: ${formatDuration(
                              test.duration
                            )}</span>
                        </div>
                         <a href="#test-${test.id}" class="title">${
                             test.name
                           }</a>
                         ${
                           test.suiteName
                             ? `<div class="suite">Suite: ${test.suiteName}</div>`
                             : ""
                         }
                        ${
                          test.status === "failed" && test.errorMessage
                            ? `<div class="error">${test.errorMessage}</div>`
                            : ""
                        }
                        <div class="time">Finished: ${formatDate(
                          test.endTime
                        )}</div>
                        <!-- Simple anchor link for potential detail expansion later -->
                        <div id="test-${
                          test.id
                        }" style="margin-top: 1rem; display: none;"> <!-- Hidden details area -->
                             <h4>Steps & Details (Placeholder)</h4>
                             ${
                               test.errorMessage
                                 ? `<p><strong>Error:</strong> ${test.errorMessage}</p>`
                                 : ""
                             }
                             ${
                               test.stackTrace
                                 ? `<p><strong>Stack Trace:</strong></p><pre><code>${test.stackTrace}</code></pre>`
                                 : ""
                             }
                         </div>
                     </div>
                 `
                         )
                         .join("")
                     : '<p class="text-muted-foreground" style="padding: 1.5rem;">No test results found.</p>'
                 }
            </div>
        </div>

    </div>
     <script>
         // Basic script to toggle test details (optional enhancement)
         document.querySelectorAll('.test-result-item .title').forEach(titleLink => {
             titleLink.addEventListener('click', (event) => {
                 event.preventDefault();
                 const detailId = titleLink.getAttribute('href').substring(1);
                 const detailElement = document.getElementById(detailId);
                 if (detailElement) {
                     detailElement.style.display = detailElement.style.display === 'none' ? 'block' : 'none';
                 }
             });
         });
     </script>
</body>
</html>
    `;

  try {
    await fs.mkdir(reportDir, { recursive: true }); // Ensure directory exists
    await fs.writeFile(htmlFilePath, htmlContent);
    console.log(
      `Static HTML report successfully generated at: ${htmlFilePath}`
    );
  } catch (error) {
    console.error(`Error writing static HTML report: ${error.message}`);
    process.exit(1);
  }
}

generateStaticReport();

    