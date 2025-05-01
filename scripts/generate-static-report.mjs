#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import { format } from 'date-fns'; // Use date-fns for formatting

// --- Helper Functions ---

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#039;");
}

function getStatusClass(status) {
    switch (status) {
        case 'passed': return 'status-passed';
        case 'failed': return 'status-failed';
        case 'skipped': return 'status-skipped';
        default: return '';
    }
}

function getStatusIcon(status) {
     switch (status) {
        case 'passed': return '<span>&#10004;</span>'; // Check mark
        case 'failed': return '<span>&#10008;</span>'; // Cross mark
        case 'skipped': return '<span>&#9724;</span>'; // Square
        default: return '';
    }
}

function formatDuration(ms) {
    return `${(ms / 1000).toFixed(2)}s`;
}

// --- HTML Template ---

function generateHtml(reportData) {
  const { run, results, metadata } = reportData;

  const css = `
    :root {
      --color-bg: #f8f9fa;
      --color-text: #212529;
      --color-border: #dee2e6;
      --color-card-bg: #ffffff;
      --color-muted: #6c757d;
      --color-primary: #708090; /* Slate Blue */
      --color-accent: #008080; /* Teal */
      --color-passed: #28a745;
      --color-failed: #dc3545;
      --color-skipped: #ffc107;
      --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --radius: 0.375rem;
    }
    body {
      font-family: var(--font-sans);
      background-color: var(--color-bg);
      color: var(--color-text);
      margin: 0;
      padding: 1rem;
      font-size: 14px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: auto; }
    .card { background-color: var(--color-card-bg); border: 1px solid var(--color-border); border-radius: var(--radius); margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .card-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); background-color: rgba(0,0,0,0.02); font-size: 1.1rem; font-weight: 500; }
    .card-content { padding: 1.25rem; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
    .summary-item { text-align: center; padding: 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); background-color: #fff; }
    .summary-label { font-size: 0.9em; color: var(--color-muted); margin-bottom: 0.25rem; display: block;}
    .summary-value { font-size: 1.5em; font-weight: 600; }
    .tabs { display: flex; border-bottom: 1px solid var(--color-border); margin-bottom: 1rem; }
    .tab-button { padding: 0.75rem 1rem; border: none; background: none; cursor: pointer; font-size: 1em; color: var(--color-muted); border-bottom: 2px solid transparent; margin-bottom: -1px;}
    .tab-button.active { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 500; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--color-border); }
    th { background-color: var(--color-bg); font-weight: 500; }
    tbody tr:hover { background-color: rgba(0,0,0,0.03); }
    .status-badge { display: inline-block; padding: 0.25em 0.6em; font-size: 0.8em; font-weight: 600; border-radius: var(--radius); line-height: 1; }
    .status-passed { color: #fff; background-color: var(--color-passed); }
    .status-failed { color: #fff; background-color: var(--color-failed); }
    .status-skipped { color: #212529; background-color: var(--color-skipped); }
    .test-item { border: 1px solid var(--color-border); margin-bottom: 0.5rem; border-radius: var(--radius); overflow: hidden; }
    .test-header { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1rem; background-color: rgba(0,0,0,0.02); border-bottom: 1px solid var(--color-border); }
    .test-title { font-weight: 500; }
    .test-details { padding: 1rem; font-size: 0.9em; }
    .test-details p { margin: 0 0 0.5rem 0; }
    .test-details strong { color: var(--color-muted); display: inline-block; min-width: 80px; }
    .test-steps details { margin-left: 1rem; border-left: 2px solid var(--color-border); padding-left: 1rem; margin-bottom: 0.5rem; }
    .test-steps summary { cursor: pointer; padding: 0.25rem 0; display: flex; align-items: center; gap: 0.5rem; }
    .step-status { display: inline-block; width: 1em; height: 1em; border-radius: 50%; margin-right: 0.5em; }
    .step-content { padding-left: 1.5rem; font-size: 0.9em; color: var(--color-muted); }
    pre { background-color: var(--color-bg); padding: 0.75rem; border-radius: var(--radius); overflow-x: auto; font-size: 0.85em; white-space: pre-wrap; word-wrap: break-word; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .text-muted { color: var(--color-muted); }
    .font-mono { font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    footer { text-align: center; margin-top: 2rem; font-size: 0.85em; color: var(--color-muted); }
  `;

  const runDetailsHtml = run ? `
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Total Tests</span>
        <span class="summary-value">${escapeHtml(run.totalTests)}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Passed</span>
        <span class="summary-value" style="color: var(--color-passed);">${escapeHtml(run.passed)}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Failed</span>
        <span class="summary-value" style="color: var(--color-failed);">${escapeHtml(run.failed)}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Skipped</span>
        <span class="summary-value" style="color: var(--color-skipped);">${escapeHtml(run.skipped)}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Duration</span>
        <span class="summary-value">${escapeHtml(formatDuration(run.duration))}</span>
      </div>
       <div class="summary-item">
        <span class="summary-label">Timestamp</span>
        <span class="summary-value" style="font-size: 1em;">${escapeHtml(format(run.timestamp, 'PP pp'))}</span>
      </div>
    </div>
    <p class="text-muted text-center" style="margin-top: 1rem;">Run ID: ${escapeHtml(run.id)}</p>
  ` : '<p class="text-muted text-center">No run data available.</p>';

  const resultsHtml = results.length > 0 ? results.map(result => `
    <div class="test-item">
      <div class="test-header">
        <span class="test-title">${escapeHtml(result.name)}</span>
        <span class="status-badge ${getStatusClass(result.status)}">${escapeHtml(result.status)}</span>
      </div>
      <div class="test-details">
        <p><strong>Suite:</strong> ${escapeHtml(result.suiteName || 'N/A')}</p>
        <p><strong>Duration:</strong> ${escapeHtml(formatDuration(result.duration))}</p>
        <p><strong>Timings:</strong> ${escapeHtml(format(result.startTime, 'p'))} - ${escapeHtml(format(result.endTime, 'p'))}</p>
        <p><strong>Retries:</strong> ${escapeHtml(result.retries)}</p>
        ${result.tags && result.tags.length > 0 ? `<p><strong>Tags:</strong> ${result.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</p>` : ''}
        ${result.status === 'failed' ? `
          <div><strong>Error:</strong> <pre class="font-mono">${escapeHtml(result.errorMessage || 'No error message.')}</pre></div>
          ${result.stackTrace ? `<div><strong>Stack Trace:</strong> <pre class="font-mono">${escapeHtml(result.stackTrace)}</pre></div>` : ''}
        ` : ''}
         ${result.codeSnippet ? `<div><strong>Code Snippet:</strong> <pre class="font-mono">${escapeHtml(result.codeSnippet)}</pre></div>` : ''}

         ${result.steps && result.steps.length > 0 ? `
         <div class="test-steps" style="margin-top: 1rem;">
             <strong>Steps:</strong>
             ${result.steps.map(step => `
                <details>
                    <summary>
                        <span class="step-status ${getStatusClass(step.status)}" style="background-color: var(--color-${step.status});"></span>
                        ${escapeHtml(step.title)} (${escapeHtml(formatDuration(step.duration))})
                    </summary>
                    <div class="step-content">
                        <p>Status: ${escapeHtml(step.status)}</p>
                        <p>Timings: ${escapeHtml(format(step.startTime, 'p'))} - ${escapeHtml(format(step.endTime, 'p'))}</p>
                        ${step.errorMessage ? `<p>Error: ${escapeHtml(step.errorMessage)}</p>` : ''}
                    </div>
                </details>
             `).join('')}
         </div>
         ` : '<p><strong>Steps:</strong> No steps recorded.</p>'}
      </div>
    </div>
  `).join('') : '<p class="text-muted text-center">No test results available.</p>';


   const runsTableHtml = run ? `
       <tr>
           <td>${escapeHtml(run.id)}</td>
           <td>${escapeHtml(format(run.timestamp, 'PP pp'))}</td>
           <td class="text-center"><span class="status-badge ${run.failed > 0 ? 'status-failed' : 'status-passed'}">${run.failed > 0 ? 'Failed' : 'Passed'}</span></td>
           <td class="text-right">${escapeHtml(run.totalTests)}</td>
           <td class="text-right">${escapeHtml(run.passed)}</td>
           <td class="text-right">${escapeHtml(run.failed)}</td>
           <td class="text-right">${escapeHtml(run.skipped)}</td>
           <td class="text-right">${escapeHtml(formatDuration(run.duration))}</td>
       </tr>
   ` : '<tr><td colspan="8" class="text-center text-muted">No run data available.</td></tr>';


  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Playwright Pulse Report</title>
      <style>${css}</style>
    </head>
    <body>
      <div class="container">
        <h1>Playwright Pulse Report</h1>
        <p class="text-muted">Generated at: ${escapeHtml(format(new Date(metadata.generatedAt), 'PPP p'))}</p>

        <div class="tabs">
          <button class="tab-button active" onclick="openTab(event, 'summary')">Summary</button>
          <button class="tab-button" onclick="openTab(event, 'results')">Test Results</button>
           <button class="tab-button" onclick="openTab(event, 'runs')">Run History (Current)</button>
        </div>

        <div id="summary" class="tab-content active">
          <div class="card">
            <div class="card-header">Run Summary</div>
            <div class="card-content">
              ${runDetailsHtml}
            </div>
          </div>
        </div>

        <div id="results" class="tab-content">
          <div class="card">
            <div class="card-header">All Test Results</div>
            <div class="card-content">
              ${resultsHtml}
            </div>
          </div>
        </div>

         <div id="runs" class="tab-content">
           <div class="card">
             <div class="card-header">Run History</div>
             <div class="card-content">
                 <table>
                     <thead>
                         <tr>
                             <th>Run ID</th>
                             <th>Timestamp</th>
                             <th class="text-center">Status</th>
                             <th class="text-right">Total</th>
                             <th class="text-right">Passed</th>
                             <th class="text-right">Failed</th>
                             <th class="text-right">Skipped</th>
                             <th class="text-right">Duration</th>
                         </tr>
                     </thead>
                     <tbody>
                        ${runsTableHtml}
                     </tbody>
                 </table>
             </div>
           </div>
         </div>

        <footer>
          Playwright Pulse Reporter
        </footer>
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
        // Ensure the default active tab is displayed on load
        document.addEventListener('DOMContentLoaded', () => {
            const activeTab = document.querySelector('.tab-content.active');
            if (activeTab) activeTab.style.display = 'block';
        });
      </script>
    </body>
    </html>
  `;
  return html;
}


// --- Main Script Logic ---

async function main() {
    const reportFileNameJson = 'playwright-pulse-report.json';
    const reportFileNameHtml = 'playwright-pulse-static-report.html';
    const reportDir = path.resolve(process.cwd(), 'pulse-report-output'); // Use the same output dir as reporter config
    const jsonFilePath = path.join(reportDir, reportFileNameJson);
    const htmlFilePath = path.join(reportDir, reportFileNameHtml);

    console.log(`Generating static HTML report from: ${jsonFilePath}`);

    try {
        // Read the JSON report data
        const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
        let reportData;

        // Revive dates from JSON strings
        const reviveDates = (key, value) => {
           const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
           if (typeof value === 'string' && isoDateRegex.test(value)) {
               const date = new Date(value);
               return !isNaN(date.getTime()) ? date : value;
           }
           return value;
        };

        try {
            reportData = JSON.parse(fileContent, reviveDates);
        } catch (parseError) {
            console.error(`Error parsing JSON from ${jsonFilePath}:`, parseError);
            throw new Error(`Invalid JSON in report file: ${parseError.message}`);
        }

        // Validate basic structure
         if (!reportData || typeof reportData !== 'object' || !reportData.metadata || !Array.isArray(reportData.results)) {
             throw new Error('Invalid report data structure in JSON file.');
         }

        // Generate the HTML content
        const htmlContent = generateHtml(reportData);

        // Ensure output directory exists
         await fs.mkdir(reportDir, { recursive: true });

        // Write the HTML file
        await fs.writeFile(htmlFilePath, htmlContent, 'utf-8');

        console.log(`Successfully generated static HTML report: ${htmlFilePath}`);

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`Error: JSON report file not found at ${jsonFilePath}.`);
            console.error('Please run your Playwright tests with the playwright-pulse-reporter enabled first.');
        } else {
            console.error('Error generating static HTML report:', error);
        }
        process.exit(1); // Exit with error code
    }
}

main();
