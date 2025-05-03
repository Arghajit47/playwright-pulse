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

// Enhanced HTML generation
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

  // Generate HTML
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse Report</title>
    <style>
        :root {
          --primary-color: #3f51b5;
          --secondary-color: #ff4081;
          --success-color: #4CAF50;
          --danger-color: #F44336;
          --warning-color: #FFC107;
          --info-color: #2196F3;
          --light-color: #f5f5f5;
          --dark-color: #212121;
          --text-color: #424242;
          --border-color: #e0e0e0;
        }
        
        body {
          font-family: 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', sans-serif;
          margin: 0;
          background-color: #fafafa;
          color: var(--text-color);
          line-height: 1.6;
        }
        
        .container {
          max-width: 1200px;
          margin: 20px auto;
          padding: 20px;
          background-color: #fff;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        
        .header {
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 20px;
          margin-bottom: 30px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .header h1 {
          margin: 0;
          font-size: 2.2em;
          color: var(--primary-color);
          font-weight: 600;
          display: flex;
          align-items: center;
        }
        
        .header h1 svg {
          margin-right: 10px;
          width: 36px;
          height: 36px;
        }
        
        .run-info {
          text-align: right;
          font-size: 0.95em;
          color: #757575;
          background: #f5f5f5;
          padding: 12px 16px;
          border-radius: 8px;
        }
        
        .run-info strong {
          color: var(--dark-color);
        }
        
        .tabs {
          display: flex;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 25px;
        }
        
        .tab-button {
          padding: 12px 24px;
          cursor: pointer;
          border: none;
          background-color: transparent;
          font-size: 1em;
          font-weight: 500;
          color: #757575;
          position: relative;
          transition: all 0.3s ease;
        }
        
        .tab-button.active {
          color: var(--primary-color);
        }
        
        .tab-button.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 3px;
          background-color: var(--primary-color);
          border-radius: 3px 3px 0 0;
        }
        
        .tab-button:hover {
          color: var(--primary-color);
          background-color: rgba(63, 81, 181, 0.05);
        }
        
        .tab-content {
          display: none;
          animation: fadeIn 0.5s;
        }
        
        .tab-content.active {
          display: block;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        /* Dashboard Styles */
        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .summary-card {
          background-color: #fff;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 20px;
          text-align: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .summary-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 8px 16px rgba(0,0,0,0.1);
        }
        
        .summary-card h3 {
          margin: 0 0 10px;
          font-size: 1.1em;
          color: #757575;
          font-weight: 500;
        }
        
        .summary-card .value {
          font-size: 2.4em;
          font-weight: 600;
          margin: 10px 0;
        }
        
        .status-passed .value {
          color: var(--success-color);
        }
        
        .status-failed .value {
          color: var(--danger-color);
        }
        
        .status-skipped .value {
          color: var(--warning-color);
        }
        
        .summary-card .trend {
          font-size: 0.9em;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #757575;
        }
        
        .trend-up {
          color: var(--success-color);
        }
        
        .trend-down {
          color: var(--danger-color);
        }
        
        .pie-chart-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          background-color: #fff;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
          grid-column: span 2;
        }
        
        .pie-chart-svg {
          display: block;
          margin: 0 auto 20px;
        }
        
        .pie-chart-total {
          font-size: 24px;
          font-weight: bold;
          fill: var(--dark-color);
        }
        
        .pie-chart-label {
          font-size: 12px;
          fill: #757575;
        }
        
        .pie-chart-legend {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 15px;
          margin-top: 15px;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.9em;
        }
        
        .legend-color {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        
        .legend-value {
          font-weight: 500;
          color: var(--dark-color);
        }
        
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .metric-card {
          background-color: #fff;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        
        .metric-card h3 {
          margin-top: 0;
          color: var(--primary-color);
          font-size: 1.2em;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 10px;
        }
        
        .metric-value {
          font-size: 1.8em;
          font-weight: 600;
          margin: 15px 0;
          color: var(--dark-color);
        }
        
        .metric-description {
          color: #757575;
          font-size: 0.9em;
        }
        
        /* Test Runs Styles */
        .filters {
          display: flex;
          gap: 15px;
          margin-bottom: 20px;
          flex-wrap: wrap;
          align-items: center;
        }
        
        .filters input, .filters select {
          padding: 10px 15px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          font-size: 0.95em;
          min-width: 200px;
          background-color: #fff;
          transition: border-color 0.3s ease;
        }
        
        .filters input:focus, .filters select:focus {
          outline: none;
          border-color: var(--primary-color);
          box-shadow: 0 0 0 2px rgba(63, 81, 181, 0.2);
        }
        
        .test-suite {
          margin-bottom: 25px;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: hidden;
          background-color: #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        
        .suite-header {
          background-color: #f5f5f5;
          padding: 15px;
          font-weight: 600;
          border-bottom: 1px solid var(--border-color);
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: background-color 0.2s ease;
        }
        
        .suite-header:hover {
          background-color: #eeeeee;
        }
        
        .suite-header::after {
          content: '▼';
          font-size: 0.8em;
          transition: transform 0.2s ease;
        }
        
        .suite-header.collapsed::after {
          content: '►';
        }
        
        .suite-content {
          display: block;
        }
        
        .suite-content.collapsed {
          display: none;
        }
        
        .test-result-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          border-bottom: 1px solid #f5f5f5;
          cursor: pointer;
          transition: background-color 0.2s ease;
        }
        
        .test-result-item:last-child {
          border-bottom: none;
        }
        
        .test-result-item:hover {
          background-color: #fafafa;
        }
        
        .test-result-item .name {
          flex-grow: 1;
          margin-right: 15px;
          font-size: 0.95em;
          font-weight: 500;
        }
        
        .test-result-item .status-badge {
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 0.85em;
          font-weight: 600;
          min-width: 80px;
          text-align: center;
        }
        
        .status-passed .status-badge {
          background-color: rgba(76, 175, 80, 0.1);
          color: var(--success-color);
        }
        
        .status-failed .status-badge {
          background-color: rgba(244, 67, 54, 0.1);
          color: var(--danger-color);
        }
        
        .status-skipped .status-badge {
          background-color: rgba(255, 193, 7, 0.1);
          color: var(--warning-color);
        }
        
        .test-result-item .duration {
          font-size: 0.9em;
          color: #757575;
          min-width: 60px;
          text-align: right;
        }
        
        .test-details {
          background-color: #fafafa;
          padding: 20px;
          border-top: 1px solid var(--border-color);
          display: none;
          animation: slideDown 0.3s ease-out;
        }
        
        .test-details h3 {
          margin-top: 0;
          margin-bottom: 15px;
          font-size: 1.2em;
          color: var(--dark-color);
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 8px;
        }
        
        .test-details p {
          margin: 8px 0;
          font-size: 0.95em;
        }
        
        .test-details strong {
          color: var(--dark-color);
          font-weight: 500;
        }
        
        .test-details pre {
          background-color: #f5f5f5;
          padding: 12px;
          border-radius: 6px;
          font-size: 0.9em;
          overflow-x: auto;
          white-space: pre-wrap;
          word-wrap: break-word;
          border-left: 3px solid var(--primary-color);
        }
        
        .test-details code {
          font-family: 'Courier New', Courier, monospace;
        }
        
        .steps-list {
          list-style: none;
          padding: 0;
          margin: 15px 0 0;
        }
        
        .step-item {
          padding: 10px 0;
          border-bottom: 1px dashed #e0e0e0;
          font-size: 0.95em;
        }
        
        .step-item:last-child {
          border-bottom: none;
        }
        
        .step-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .step-duration {
          font-size: 0.9em;
          color: #757575;
        }
        
        .step-error {
          color: var(--danger-color);
          margin-top: 8px;
          font-size: 0.9em;
          padding-left: 20px;
          border-left: 2px solid var(--danger-color);
          background-color: rgba(244, 67, 54, 0.05);
          padding: 8px 12px;
          border-radius: 4px;
        }
        
        .status-failed .step-title {
          color: var(--danger-color);
        }
        
        .status-skipped .step-title {
          color: #757575;
        }
        
        .attachments-section {
          margin-top: 15px;
        }
        
        .attachments-section h4 {
          margin: 15px 0 10px;
          font-size: 1.1em;
          color: var(--dark-color);
        }
        
        .attachments-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 15px;
          margin-top: 10px;
        }
        
        .attachment-item {
          border: 1px solid var(--border-color);
          border-radius: 6px;
          overflow: hidden;
          background-color: #fff;
        }
        
        .attachment-item img {
          width: 100%;
          height: auto;
          display: block;
        }
        
        .attachment-info {
          padding: 10px;
          font-size: 0.85em;
        }
        
        .attachment-info a {
          color: var(--primary-color);
          text-decoration: none;
          font-weight: 500;
        }
        
        .attachment-info a:hover {
          text-decoration: underline;
        }
        
        .share-section {
          margin-top: 30px;
          padding: 20px;
          background-color: #f5f5f5;
          border-radius: 8px;
        }
        
        .share-section h3 {
          margin-top: 0;
          color: var(--primary-color);
        }
        
        .share-options {
          display: flex;
          gap: 15px;
          margin-top: 15px;
          flex-wrap: wrap;
        }
        
        .share-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          font-size: 0.95em;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background-color 0.3s ease;
        }
        
        .email-btn {
          background-color: var(--primary-color);
          color: white;
        }
        
        .email-btn:hover {
          background-color: #303f9f;
        }
        
        .copy-btn {
          background-color: #757575;
          color: white;
        }
        
        .copy-btn:hover {
          background-color: #616161;
        }
        
        @keyframes slideDown {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 1000px; }
        }
        
        /* Responsive adjustments */
        @media (max-width: 768px) {
          .header {
            flex-direction: column;
            align-items: flex-start;
            gap: 15px;
          }
          
          .run-info {
            text-align: left;
            width: 100%;
          }
          
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
          
          .pie-chart-container {
            grid-column: span 1;
          }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
                </svg>
                Playwright Pulse Report
            </h1>
            <div class="run-info">
                <div><strong>Generated:</strong> ${formatDate(new Date())}</div>
                <div><strong>Run Started:</strong> ${formatDate(
                  runSummary.timestamp
                )}</div>
                <div><strong>Total Duration:</strong> ${formatDuration(
                  runSummary.duration
                )}</div>
            </div>
        </div>

        <div class="tabs">
            <button class="tab-button active" onclick="openTab('dashboard')">Dashboard</button>
            <button class="tab-button" onclick="openTab('testRuns')">Test Runs</button>
        </div>

        <!-- Dashboard Tab -->
        <div id="dashboard" class="tab-content active">
            <h2>Test Execution Overview</h2>
            
            <div class="dashboard-grid">
                <div class="summary-card">
                    <h3>Total Tests</h3>
                    <div class="value">${runSummary.totalTests}</div>
                    <div class="trend">All test cases executed</div>
                </div>
                
                <div class="summary-card status-passed">
                    <h3>Passed</h3>
                    <div class="value">${runSummary.passed}</div>
                    <div class="trend">${passPercentage}% success rate</div>
                </div>
                
                <div class="summary-card status-failed">
                    <h3>Failed</h3>
                    <div class="value">${runSummary.failed}</div>
                    <div class="trend">${
                      runSummary.failed > 0
                        ? "Needs investigation"
                        : "All tests passed"
                    }</div>
                </div>
                
                <div class="summary-card status-skipped">
                    <h3>Skipped</h3>
                    <div class="value">${runSummary.skipped}</div>
                    <div class="trend">${
                      runSummary.skipped > 0
                        ? "Tests were skipped"
                        : "No skipped tests"
                    }</div>
                </div>
                
                ${generatePieChartSVG(runSummary)}
            </div>
            
            <div class="metrics-grid">
                <div class="metric-card">
                    <h3>Test Execution Efficiency</h3>
                    <div class="metric-value">${avgTestDuration}</div>
                    <div class="metric-description">Average test duration across all test cases</div>
                </div>
                
                <div class="metric-card">
                    <h3>Test Stability</h3>
                    <div class="metric-value">${passPercentage}%</div>
                    <div class="metric-description">Percentage of tests that passed successfully</div>
                </div>
                
                <div class="metric-card">
                    <h3>Failure Rate</h3>
                    <div class="metric-value">${
                      runSummary.totalTests > 0
                        ? Math.round(
                            (runSummary.failed / runSummary.totalTests) * 100
                          )
                        : 0
                    }%</div>
                    <div class="metric-description">Percentage of tests that failed during execution</div>
                </div>
            </div>
            
            <div class="share-section">
                <h3>Share This Report</h3>
                <p>Share this test report with your team members or stakeholders.</p>
                <div class="share-options">
                    <button class="share-btn email-btn" onclick="shareViaEmail()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white">
                            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                        </svg>
                        Share via Email
                    </button>
                    <button class="share-btn copy-btn" onclick="copyReportLink()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                        Copy Report Link
                    </button>
                </div>
            </div>
        </div>

        <!-- Test Runs Tab -->
        <div id="testRuns" class="tab-content">
            <h2>Detailed Test Results</h2>
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
                ${Object.entries(
                  results.reduce((acc, result) => {
                    const suiteName = result.suiteName || "Default Suite";
                    if (!acc[suiteName]) acc[suiteName] = [];
                    acc[suiteName].push(result);
                    return acc;
                  }, {})
                )
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

                                return `
                                <div class="test-result-item ${getStatusClass(
                                  result.status
                                )}" 
                                     data-test-name="${sanitizeHTML(
                                       result.name
                                     )}" 
                                     data-status="${result.status}" 
                                     onclick="toggleDetails(this)">
                                    <div class="name">${sanitizeHTML(
                                      result.name
                                    )}</div>
                                    <div class="status-badge">${result.status.toUpperCase()}</div>
                                    <div class="duration">${formatDuration(
                                      result.duration
                                    )}</div>
                                </div>
                                <div class="test-details">
                                     <h3>Test Details</h3>
                                     <p><strong>Run ID:</strong> ${sanitizeHTML(
                                       result.runId || "N/A"
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
                                       result.retries || 0
                                     }</p>
                                     
                                     ${
                                       result.tags && result.tags.length > 0
                                         ? `
                                        <p><strong>Tags:</strong> ${result.tags
                                          .map(
                                            (tag) => `
                                            <span style="background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 0.8em;">
                                                ${sanitizeHTML(tag)}
                                            </span>
                                        `
                                          )
                                          .join(" ")}</p>
                                     `
                                         : ""
                                     }

                                     ${
                                       result.errorMessage
                                         ? `
                                        <h3>Error Details</h3>
                                        <pre><code>${sanitizeHTML(
                                          result.errorMessage
                                        )}</code></pre>
                                        ${
                                          result.stackTrace
                                            ? `
                                            <pre><code>${sanitizeHTML(
                                              result.stackTrace
                                            )}</code></pre>
                                        `
                                            : ""
                                        }
                                     `
                                         : ""
                                     }

                                     ${
                                       result.steps && result.steps.length > 0
                                         ? `
                                        <h3>Execution Steps</h3>
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
                                                        ? `
                                                        <div class="step-error">${sanitizeHTML(
                                                          step.errorMessage
                                                        )}</div>
                                                    `
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
                                       attachments.length > 0
                                         ? `
                                        <h3>Attachments</h3>
                                        <div class="attachments-grid">
                                            ${attachments
                                              .map((att) => {
                                                const isScreenshot =
                                                  att.startsWith(
                                                    "data:image"
                                                  ) ||
                                                  [
                                                    ".png",
                                                    ".jpg",
                                                    ".jpeg",
                                                  ].some((ext) =>
                                                    att.endsWith(ext)
                                                  );
                                                const isVideo = [
                                                  ".webm",
                                                  ".mp4",
                                                ].some((ext) =>
                                                  att.endsWith(ext)
                                                );
                                                const isTrace =
                                                  att.endsWith(".zip");
                                                const src = att.startsWith(
                                                  "data:image"
                                                )
                                                  ? att
                                                  : att;

                                                if (isScreenshot) {
                                                  return `
                                                  <div class="attachment-item">
                                                    <img src="${sanitizeHTML(
                                                      src
                                                    )}" alt="Screenshot" loading="lazy">
                                                    <div class="attachment-info">Screenshot</div>
                                                  </div>
                                                `;
                                                } else if (isVideo) {
                                                  return `
                                                  <div class="attachment-item">
                                                    <div class="attachment-info">
                                                      <a href="${sanitizeHTML(
                                                        src
                                                      )}" target="_blank" rel="noopener noreferrer">
                                                        View Video (${sanitizeHTML(
                                                          path.basename(src)
                                                        )})
                                                      </a>
                                                    </div>
                                                  </div>
                                                `;
                                                } else if (isTrace) {
                                                  return `
                                                  <div class="attachment-item">
                                                    <div class="attachment-info">
                                                      <a href="${sanitizeHTML(
                                                        src
                                                      )}" download>
                                                        Download Trace (${sanitizeHTML(
                                                          path.basename(src)
                                                        )})
                                                      </a>
                                                    </div>
                                                  </div>
                                                `;
                                                }
                                                return "";
                                              })
                                              .join("")}
                                        </div>
                                     `
                                         : "<p>No attachments available.</p>"
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

        <script>
      
            // Tab navigation
            function openTab(tabName) {
                const tabContents = document.querySelectorAll('.tab-content');
                tabContents.forEach(content => content.classList.remove('active'));
                const tabButtons = document.querySelectorAll('.tab-button');
                tabButtons.forEach(button => button.classList.remove('active'));

                document.getElementById(tabName).classList.add('active');
                document.querySelector(\`.tab-button[onclick="openTab('\${tabName}')"]\`).classList.add('active');
            }

            // Toggle test details
            function toggleDetails(element) {
                const details = element.nextElementSibling;
                if (details && details.classList.contains('test-details')) {
                    details.style.display = details.style.display === 'block' ? 'none' : 'block';
                }
            }

            // Toggle suite collapse/expand
            function toggleSuite(headerElement) {
                headerElement.classList.toggle('collapsed');
                const content = headerElement.nextElementSibling;
                if (content && content.classList.contains('suite-content')) {
                    content.classList.toggle('collapsed');
                }
            }

            // Filter tests by name and status
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
                        const statusMatch = statusFilter === 'all' || testStatus === statusFilter;

                        if (nameMatch && statusMatch) {
                            test.style.display = 'flex';
                            if (details) details.style.display = 'none';
                            suiteVisible = true;
                        } else {
                            test.style.display = 'none';
                            if (details) details.style.display = 'none';
                        }
                    });
                    
                    suite.style.display = suiteVisible ? 'block' : 'none';
                });
            }

            // Copy report link to clipboard
            function copyReportLink() {
                // In a real implementation, you would copy the actual URL to the report
                // For now, we'll just copy a placeholder message
                const el = document.createElement('textarea');
                el.value = 'Playwright test report (local file)';
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
                
                alert('Report information copied to clipboard');
            }

            // Initialize the page
            document.addEventListener('DOMContentLoaded', function() {
                openTab('dashboard');
                
                // Collapse all suites by default in test runs view
                document.querySelectorAll('.suite-header').forEach(header => {
                    header.classList.add('collapsed');
                    header.nextElementSibling.classList.add('collapsed');
                });
            });
        </script>
    </div>
</body>
</html>
  `;
}

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
    console.error(chalk.red(`Error generating report: ${error.message}`));
    process.exit(1);
  }
}

// Execute
main();
