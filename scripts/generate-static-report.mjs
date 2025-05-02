#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

// --- Configuration ---
const DEFAULT_PULSE_REPORT_DIR = "pulse-report-output";
const REPORT_JSON_FILE = "playwright-pulse-report.json";
const STATIC_HTML_FILE = "playwright-pulse-static-report.html";
const DEFAULT_PLAYWRIGHT_OUTPUT_DIR_NAME = "test-results"; // Default if not found in JSON

// --- Helper Functions ---

// Function to format duration in milliseconds to a readable string (e.g., 1.23s)
function formatDuration(ms) {
  if (typeof ms !== "number" || ms < 0) return "N/A";
  return (ms / 1000).toFixed(2) + "s";
}

// Function to format date objects to a readable string
function formatDate(date) {
  if (!date) return "N/A";
  // Check if it's already a Date object or needs parsing
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "N/A"; // Invalid date
  return d.toLocaleString(); // Adjust format as needed
}

// Function to get status color class
function getStatusClass(status) {
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
}

// Function to encode image path to base64 data URI
async function encodeImageToBase64(filePath) {
  if (!filePath) return null;
  try {
    const absolutePath = path.resolve(filePath); // Ensure absolute path
    const imageBuffer = await fs.readFile(absolutePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = path.extname(filePath).slice(1); // Get extension without dot
    // Handle common image types; default to png if unknown
    const validMimeType = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(
      mimeType
    )
      ? `image/${mimeType}`
      : "image/png";
    return `data:${validMimeType};base64,${base64Image}`;
  } catch (error) {
    console.warn(
      `   - Warning: Could not read or encode image at ${filePath}: ${error.message}`
    );
    return null; // Return null if image cannot be processed
  }
}

// --- Main Generation Logic ---

async function generateStaticReport(pulseReportDir = DEFAULT_PULSE_REPORT_DIR) {
  // Determine the correct directory for the JSON report
  const reportJsonPath = path.resolve(
    process.cwd(),
    pulseReportDir,
    REPORT_JSON_FILE
  );
  const staticHtmlPath = path.resolve(
    process.cwd(),
    pulseReportDir,
    STATIC_HTML_FILE
  );

  console.log(`Generating static HTML report...`);
  console.log(` > Reading report data from: ${reportJsonPath}`);

  let reportData;
  try {
    const fileContent = await fs.readFile(reportJsonPath, "utf-8");
    reportData = JSON.parse(fileContent); // Dates are still strings here initially
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Report JSON file not found at ${reportJsonPath}.`);
      console.error(
        "Ensure Playwright tests ran with 'playwright-pulse-reporter' configured with the correct 'outputDir'."
      );
    } else {
      console.error(
        `Error reading or parsing report JSON file: ${error.message}`
      );
    }
    process.exit(1); // Exit if report data is missing
  }

  // Basic validation
  if (!reportData || !reportData.results) {
    console.error("Error: Invalid report data structure in JSON file.");
    process.exit(1);
  }

  // --- Resolve Attachment Paths ---
  // Determine the Playwright output directory (where attachments like screenshots/videos are stored)
  // Ideally, the reporter saves this information, but we need a fallback.
  // For now, assume it's relative to the project root (where command is run)
  const playwrightOutputDir = path.resolve(
    process.cwd(),
    DEFAULT_PLAYWRIGHT_OUTPUT_DIR_NAME
  );
  console.log(
    ` > Assuming Playwright output (attachments) directory: ${playwrightOutputDir}`
  );

  // Process results to resolve paths and encode images
  const processedResults = await Promise.all(
    reportData.results.map(async (result) => {
      let base64Screenshot = null;
      if (result.screenshot) {
        const screenshotPath = path.resolve(
          playwrightOutputDir,
          result.screenshot
        );
        base64Screenshot = await encodeImageToBase64(screenshotPath);
      }

      const processedSteps = await Promise.all(
        (result.steps || []).map(async (step) => {
          let base64StepScreenshot = null;
          if (step.screenshot) {
            const stepScreenshotPath = path.resolve(
              playwrightOutputDir,
              step.screenshot
            );
            base64StepScreenshot = await encodeImageToBase64(
              stepScreenshotPath
            );
          }
          return { ...step, screenshotDataUri: base64StepScreenshot };
        })
      );

      // Store relative video path for linking
      const videoRelativePath = result.video
        ? path.relative(
            pulseReportDir,
            path.resolve(playwrightOutputDir, result.video)
          )
        : null;

      return {
        ...result,
        screenshotDataUri: base64Screenshot,
        videoRelativePath: videoRelativePath, // Use relative path for link
        steps: processedSteps, // Update steps with embedded screenshot data
      };
    })
  );

  reportData.results = processedResults; // Update report data with processed results

  // --- Calculate Summary ---
  const run = reportData.run || {}; // Use empty object if run data is missing
  const totalTests = reportData.results.length;
  const passed = reportData.results.filter((r) => r.status === "passed").length;
  const failed = reportData.results.filter((r) => r.status === "failed").length;
  const skipped = reportData.results.filter(
    (r) => r.status === "skipped"
  ).length;
  const duration = run.duration ? formatDuration(run.duration) : "N/A";
  const timestamp = run.timestamp ? formatDate(run.timestamp) : "N/A";

  // Data for Pie Chart
  const chartData = [
    { label: "Passed", value: passed, color: "#22c55e" }, // green-500
    { label: "Failed", value: failed, color: "#ef4444" }, // red-500
    { label: "Skipped", value: skipped, color: "#f59e0b" }, // amber-500
  ].filter((d) => d.value > 0); // Filter out zero values

  // --- Group Tests by Suite ---
  const testsBySuite = reportData.results.reduce((acc, result) => {
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
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; margin: 0; background-color: #f9fafb; color: #1f2937; }
        .container { max-width: 1200px; margin: 20px auto; padding: 20px; background-color: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        header { border-bottom: 1px solid #e5e7eb; padding-bottom: 15px; margin-bottom: 20px; }
        header h1 { margin: 0; font-size: 2em; color: #708090; /* Slate Blue */ }
        nav { display: flex; gap: 15px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px; }
        nav button { padding: 10px 15px; font-size: 1em; background: none; border: none; border-bottom: 3px solid transparent; cursor: pointer; color: #4b5563; transition: border-color 0.2s, color 0.2s; }
        nav button.active { border-bottom-color: #008080; /* Teal */ color: #008080; font-weight: 600; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .summary-card { background-color: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 15px; text-align: center; }
        .summary-card h3 { margin: 0 0 5px 0; font-size: 1em; color: #4b5563; }
        .summary-card .value { font-size: 2em; font-weight: 600; }
        .status-passed .value { color: #16a34a; }
        .status-failed .value { color: #dc2626; }
        .status-skipped .value { color: #d97706; }
        .chart-container { display: flex; justify-content: center; align-items: center; min-height: 250px; margin-bottom: 30px; background-color: #f3f4f6; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; }
        .test-list { margin-top: 20px; }
        .suite-group { margin-bottom: 25px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
        .suite-header { background-color: #f3f4f6; padding: 10px 15px; font-weight: 600; border-bottom: 1px solid #e5e7eb; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .suite-header::after { content: '▼'; font-size: 0.8em; transition: transform 0.2s; }
        .suite-header.collapsed::after { transform: rotate(-90deg); }
        .suite-content { display: block; } /* Initially shown */
        .suite-content.collapsed { display: none; }
        .test-item { border-bottom: 1px solid #e5e7eb; padding: 15px; display: flex; align-items: center; gap: 15px; cursor: pointer; transition: background-color 0.2s; }
        .test-item:last-child { border-bottom: none; }
        .test-item:hover { background-color: #f9fafb; }
        .test-status-badge { padding: 3px 8px; border-radius: 12px; font-size: 0.8em; font-weight: 500; white-space: nowrap; }
        .status-passed { background-color: #dcfce7; color: #15803d; }
        .status-failed { background-color: #fee2e2; color: #b91c1c; }
        .status-skipped { background-color: #fef3c7; color: #a16207; }
        .test-name { flex-grow: 1; font-weight: 500; }
        .test-duration { font-size: 0.9em; color: #6b7280; white-space: nowrap; }
        .test-details { display: none; padding: 15px; background-color: #f9fafb; border-top: 1px dashed #e5e7eb; }
        .test-details.visible { display: block; }
        .details-section { margin-bottom: 15px; }
        .details-section h4 { margin: 0 0 8px 0; font-size: 1.1em; font-weight: 600; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        pre { background-color: #e5e7eb; padding: 10px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; font-size: 0.9em; white-space: pre-wrap; word-wrap: break-word; overflow-x: auto; }
        .steps-list { list-style: none; padding: 0; margin: 0; }
        .step-item { display: flex; align-items: start; gap: 10px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
        .step-item:last-child { border-bottom: none; }
        .step-status-icon { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
        .step-passed { background-color: #22c55e; }
        .step-failed { background-color: #ef4444; }
        .step-skipped { background-color: #f59e0b; }
        .step-info { flex-grow: 1; }
        .step-title { font-weight: 500; margin-bottom: 3px; }
        .step-details { font-size: 0.85em; color: #6b7280; }
        .step-error { color: #dc2626; font-weight: 500; margin-top: 5px; font-family: 'Courier New', Courier, monospace; }
        .attachment-container img, .attachment-container video { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid #ddd; margin-top: 10px; }
        .step-screenshot img { max-width: 300px; cursor: pointer; } /* Smaller preview for steps */
        .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.8); justify-content: center; align-items: center; }
        .modal-content { max-width: 90%; max-height: 90%; }
        .modal-close { position: absolute; top: 20px; right: 35px; color: #fff; font-size: 40px; font-weight: bold; cursor: pointer; }
        .filters { display: flex; gap: 15px; margin-bottom: 20px; }
        .filters input, .filters select { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.9em; }
        .filters input { flex-grow: 1; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="container">
        <header>
            <h1>Playwright Pulse Report</h1>
            <p>Run Timestamp: ${timestamp} | Total Duration: ${duration}</p>
        </header>

        <nav>
            <button class="tab-button active" data-tab="dashboard">Dashboard</button>
            <button class="tab-button" data-tab="test-runs">Test Runs</button>
        </nav>

        <!-- Dashboard Tab -->
        <div id="dashboard" class="tab-content active">
            <h2>Run Summary</h2>
            <div class="summary-grid">
                <div class="summary-card">
                    <h3>Total Tests</h3>
                    <div class="value">${totalTests}</div>
                </div>
                <div class="summary-card status-passed">
                    <h3>Passed</h3>
                    <div class="value">${passed}</div>
                </div>
                <div class="summary-card status-failed">
                    <h3>Failed</h3>
                    <div class="value">${failed}</div>
                </div>
                <div class="summary-card status-skipped">
                    <h3>Skipped</h3>
                    <div class="value">${skipped}</div>
                </div>
            </div>

            <h2>Test Status Distribution</h2>
            <div class="chart-container">
                 ${
                   chartData.length > 0
                     ? '<canvas id="statusPieChart"></canvas>'
                     : "<p>No test results to display chart.</p>"
                 }
            </div>
        </div>

        <!-- Test Runs Tab -->
        <div id="test-runs" class="tab-content">
            <h2>All Test Results</h2>
             <div class="filters">
                 <input type="text" id="searchInput" placeholder="Search by test name...">
                 <select id="statusFilter">
                     <option value="all">All Statuses</option>
                     <option value="passed">Passed</option>
                     <option value="failed">Failed</option>
                     <option value="skipped">Skipped</option>
                 </select>
            </div>
            <div class="test-list">
                ${Object.entries(testsBySuite)
                  .map(
                    ([suiteName, tests]) => `
                    <div class="suite-group" data-suite="${suiteName}">
                        <div class="suite-header">
                            <span>${suiteName} (${tests.length})</span>
                        </div>
                        <div class="suite-content">
                            ${tests
                              .map(
                                (result) => `
                                <div class="test-item" data-testid="${
                                  result.id
                                }" data-status="${result.status}">
                                    <span class="test-status-badge ${getStatusClass(
                                      result.status
                                    )}">${
                                  result.status.charAt(0).toUpperCase() +
                                  result.status.slice(1)
                                }</span>
                                    <span class="test-name">${
                                      result.name
                                    }</span>
                                    <span class="test-duration">${formatDuration(
                                      result.duration
                                    )}</span>
                                </div>
                                <div class="test-details" id="details-${
                                  result.id
                                }">
                                    <h4>Test Information</h4>
                                    <p><strong>Full Name:</strong> ${
                                      result.name
                                    }</p>
                                    <p><strong>Suite:</strong> ${
                                      result.suiteName || "Default Suite"
                                    }</p>
                                    <p><strong>Status:</strong> ${
                                      result.status
                                    }</p>
                                    <p><strong>Duration:</strong> ${formatDuration(
                                      result.duration
                                    )}</p>
                                    <p><strong>Start Time:</strong> ${formatDate(
                                      result.startTime
                                    )}</p>
                                    <p><strong>End Time:</strong> ${formatDate(
                                      result.endTime
                                    )}</p>
                                    <p><strong>Retries:</strong> ${
                                      result.retries
                                    }</p>
                                    ${
                                      result.tags && result.tags.length > 0
                                        ? `<p><strong>Tags:</strong> ${result.tags.join(
                                            ", "
                                          )}</p>`
                                        : ""
                                    }

                                    ${
                                      result.errorMessage
                                        ? `
                                        <div class="details-section">
                                            <h4>Error</h4>
                                            <pre><code>${
                                              result.errorMessage
                                            }</code></pre>
                                            ${
                                              result.stackTrace
                                                ? `<h4>Stack Trace</h4><pre><code>${result.stackTrace}</code></pre>`
                                                : ""
                                            }
                                        </div>
                                    `
                                        : ""
                                    }

                                    ${
                                      result.screenshotDataUri
                                        ? `
                                        <div class="details-section attachment-container">
                                            <h4>Screenshot (on failure)</h4>
                                            <img src="${result.screenshotDataUri}" alt="Failure Screenshot" loading="lazy">
                                        </div>
                                    `
                                        : ""
                                    }

                                    ${
                                      result.videoRelativePath
                                        ? `
                                        <div class="details-section attachment-container">
                                            <h4>Video Recording</h4>
                                            <video controls preload="none" loading="lazy">
                                                 <source src="${result.videoRelativePath}" type="video/webm"> <!-- Adjust type if needed -->
                                                 Your browser does not support the video tag. <a href="${result.videoRelativePath}" target="_blank">Download video</a>
                                             </video>
                                        </div>
                                    `
                                        : ""
                                    }

                                    ${
                                      result.steps && result.steps.length > 0
                                        ? `
                                        <div class="details-section">
                                            <h4>Test Steps</h4>
                                            <ul class="steps-list">
                                                ${result.steps
                                                  .map(
                                                    (step) => `
                                                    <li class="step-item">
                                                        <span class="step-status-icon ${getStatusClass(
                                                          step.status
                                                        )}"></span>
                                                        <div class="step-info">
                                                            <div class="step-title">${
                                                              step.title
                                                            }</div>
                                                            <div class="step-details">Duration: ${formatDuration(
                                                              step.duration
                                                            )} | Start: ${formatDate(
                                                      step.startTime
                                                    )} | End: ${formatDate(
                                                      step.endTime
                                                    )}</div>
                                                            ${
                                                              step.errorMessage
                                                                ? `<div class="step-error">${step.errorMessage}</div>`
                                                                : ""
                                                            }
                                                            ${
                                                              step.screenshotDataUri
                                                                ? `
                                                                <div class="step-screenshot">
                                                                    <img src="${step.screenshotDataUri}" alt="Step Screenshot" loading="lazy" onclick="openModal(this.src)">
                                                                </div>`
                                                                : ""
                                                            }
                                                        </div>
                                                    </li>
                                                `
                                                  )
                                                  .join("")}
                                            </ul>
                                        </div>
                                    `
                                        : "<p>No steps recorded for this test.</p>"
                                    }

                                    ${
                                      result.codeSnippet
                                        ? `
                                    <div class="details-section">
                                        <h4>Test Location</h4>
                                        <pre><code>${result.codeSnippet}</code></pre>
                                    </div>
                                    `
                                        : ""
                                    }

                                </div>
                            `
                              )
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
     <div id="imageModal" class="modal" onclick="closeModal()">
         <span class="modal-close" onclick="closeModal(event)">&times;</span>
         <img class="modal-content" id="modalImage">
     </div>

    <script>
        // Tab Switching Logic
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tab = button.getAttribute('data-tab');

                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                tabContents.forEach(content => {
                    if (content.id === tab) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });
            });
        });

        // Test Details Toggling
        const testItems = document.querySelectorAll('.test-item');
        testItems.forEach(item => {
            item.addEventListener('click', () => {
                const testId = item.getAttribute('data-testid');
                const detailsDiv = document.getElementById(\`details-\${testId}\`);
                if (detailsDiv) {
                    detailsDiv.classList.toggle('visible');
                }
            });
        });

        // Suite Group Toggling
        const suiteHeaders = document.querySelectorAll('.suite-header');
        suiteHeaders.forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                const content = header.nextElementSibling;
                if (content && content.classList.contains('suite-content')) {
                    content.classList.toggle('collapsed');
                }
            });
        });

        // Filtering Logic
        const searchInput = document.getElementById('searchInput');
        const statusFilter = document.getElementById('statusFilter');
        const allTestItems = document.querySelectorAll('#test-runs .test-item');
        const allSuiteGroups = document.querySelectorAll('#test-runs .suite-group');

        function applyFilters() {
            const searchTerm = searchInput.value.toLowerCase();
            const selectedStatus = statusFilter.value;

            allSuiteGroups.forEach(suiteGroup => {
                let suiteVisible = false;
                const suiteTestItems = suiteGroup.querySelectorAll('.test-item');

                suiteTestItems.forEach(item => {
                    const testName = item.querySelector('.test-name').textContent.toLowerCase();
                    const testStatus = item.getAttribute('data-status');
                    const detailsDiv = document.getElementById(\`details-\${item.getAttribute('data-testid')}\`);

                    const searchMatch = testName.includes(searchTerm);
                    const statusMatch = selectedStatus === 'all' || testStatus === selectedStatus;

                    if (searchMatch && statusMatch) {
                        item.style.display = 'flex';
                        if (detailsDiv) detailsDiv.style.display = detailsDiv.classList.contains('visible') ? 'block' : 'none'; // Keep details visibility if toggled open
                        suiteVisible = true; // Show suite if any test matches
                    } else {
                        item.style.display = 'none';
                         if (detailsDiv) detailsDiv.style.display = 'none'; // Hide details if test is filtered out
                    }
                });

                // Show/hide the entire suite group based on whether any test items are visible
                suiteGroup.style.display = suiteVisible ? 'block' : 'none';
            });
        }

        searchInput.addEventListener('input', applyFilters);
        statusFilter.addEventListener('change', applyFilters);

         // Pie Chart Rendering (using Chart.js)
         const ctx = document.getElementById('statusPieChart')?.getContext('2d');
         if (ctx && ${chartData.length > 0}) {
             new Chart(ctx, {
                 type: 'pie',
                 data: {
                     labels: ${JSON.stringify(chartData.map((d) => d.label))},
                     datasets: [{
                         label: 'Test Status',
                         data: ${JSON.stringify(chartData.map((d) => d.value))},
                         backgroundColor: ${JSON.stringify(
                           chartData.map((d) => d.color)
                         )},
                         borderColor: '#fff',
                         borderWidth: 1
                     }]
                 },
                 options: {
                     responsive: true,
                     maintainAspectRatio: false,
                     plugins: {
                         legend: {
                             position: 'top',
                         },
                         tooltip: {
                             callbacks: {
                                 label: function(context) {
                                     let label = context.label || '';
                                     if (label) {
                                         label += ': ';
                                     }
                                     if (context.parsed !== null) {
                                         label += context.parsed;
                                     }
                                     return label;
                                 }
                             }
                         }
                     }
                 }
             });
         }

         // Image Modal Logic
         const modal = document.getElementById('imageModal');
         const modalImg = document.getElementById('modalImage');

         function openModal(src) {
            if (modal && modalImg) {
                 modal.style.display = 'flex';
                 modalImg.src = src;
             }
         }

         function closeModal(event) {
            // Prevent closing if clicking inside the image itself
            if (event && event.target === modalImg) {
                return;
            }
             if (modal) {
                 modal.style.display = 'none';
                 modalImg.src = ""; // Clear src
            }
         }

         // Close modal on Escape key
         document.addEventListener('keydown', function(event) {
             if (event.key === 'Escape') {
                 closeModal();
             }
         });


    </script>
</body>
</html>
    `;

  // --- Write HTML File ---
  try {
    await fs.writeFile(staticHtmlPath, htmlContent);
    console.log(
      `Static HTML report generated successfully at: ${staticHtmlPath}`
    );
  } catch (error) {
    console.error(`Error writing static HTML report: ${error.message}`);
    process.exit(1);
  }
}

// --- Script Execution ---
// Allow running with an optional directory argument
const customReportDir = process.argv[2]; // Get directory from command line argument if provided
generateStaticReport(customReportDir);

// Export the function for potential programmatic use (e.g., by the reporter)
export default generateStaticReport;
