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
          display: none; /* Changed to none */
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
          .metrics-grid {
            grid-template-columns: 1fr;
          }
          .filters {
            flex-direction: column;
            align-items: flex-start;
            gap: 15px;
          }
          .test-runs-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
        }
        
        @media (max-width: 480px) {
          .filters input,
          .filters select {
            min-width: 100%;
            flex: none;
          }
          .tab-button {
            padding: 10px 12px;
          }
          .header h1 {
            font-size: 1.8em;
          }
          .run-info {
            font-size: 0.9em;
          }
          .summary-card .value {
            font-size: 2em;
          }
          .metric-value {
            font-size: 1.4em;
          }
          .test-result-item {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
          .test-result-item .duration {
            text-align: left;
          }
          .share-options {
            flex-direction: column;
            gap: 12px;
          }
          .share-btn {
            width: 100%;
            text-align: center;
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
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16.59 4.57A2 2 0 0 0 15.17 4H9.83a2 2 0 0 0-1.42.57L8.68 6.15a2 2 0 0 1-.58 1.41V11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7.56a2 2 0 0 1-.59-1.42L16.59 4.57z"></path>
                    <path d="M7.5 17a3.5 3.5 0 1 1 9 0"></path>
                    <path d="M3 10h18"></path>
                    <path d="M12 10v7"></path>
                </svg>
                Playwright Pulse Report
            </h1>
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
            <button class="tab-button" data-tab="test-runs">Test Runs</button>
        </div>
        
        <div id="dashboard" class="tab-content active">
            <div class="dashboard-grid">
                <div class="summary-card">
                    <h3>Total Tests</h3>
                    <div class="value">${runSummary.totalTests}</div>
                </div>
                <div class="summary-card status-passed">
                    <h3>Passed</h3>
                    <div class="value">${runSummary.passed}</div>
                    <div class="trend trend-up">+${passPercentage}%</div>
                </div>
                <div class="summary-card status-failed">
                    <h3>Failed</h3>
                    <div class="value">${runSummary.failed}</div>
                    <div class="trend trend-down">-${
                      100 - passPercentage
                    }%</div>
                </div>
                <div class="summary-card status-skipped">
                    <h3>Skipped</h3>
                    <div class="value">${runSummary.skipped}</div>
                </div>
                <div class="pie-chart-container">
                    ${generatePieChartSVG(runSummary)}
                </div>
                <div class="metrics-grid">
                    <div class="metric-card">
                        <h3>Pass Rate</h3>
                        <div class="metric-value">${passPercentage}%</div>
                        <div class="metric-description">Percentage of tests passed</div>
                    </div>
                    <div class="metric-card">
                        <h3>Avg. Test Duration</h3>
                        <div class="metric-value">${avgTestDuration}</div>
                        <div class="metric-description">Average time per test</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="test-runs" class="tab-content">
    <div class="test-list" id="test-list"></div>
</div>
    </div>
    
    <script>
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const testTableRows = document.querySelectorAll('.test-table tbody tr');
    const testDetailsDivs = document.querySelectorAll('.test-details');
    
    let activeTestRow = null; // Track the currently selected test row
    
    function showTab(tabId) {
        tabButtons.forEach(button => button.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        const tabButton = document.querySelector(\`[data-tab="\${tabId}"]\`);
        const tabContent = document.getElementById(tabId);
        
        tabButton.classList.add('active');
        tabContent.classList.add('active');
    }
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.tab;
            showTab(tabId);
            
            // If switching to the test runs tab, clear any selected test details
            if (tabId === 'test-runs' && activeTestRow) {
                activeTestRow.classList.remove('selected');
                activeTestRow = null;
                testDetailsDivs.forEach(div => div.style.display = 'none');
            }
        });
    });
    
    showTab('dashboard'); // Show the dashboard tab by default
    
    // Function to filter test runs table
    function filterTestRuns() {
        const nameFilter = document.getElementById('filter-name').value.toLowerCase();
        const statusFilter = document.getElementById('filter-status').value.toLowerCase();
        
        testTableRows.forEach(row => {
            const name = row.dataset.name.toLowerCase();
            const status = row.dataset.status.toLowerCase();
            
            const nameMatch = name.includes(nameFilter);
            const statusMatch = !statusFilter || status === statusFilter;
            
            if (nameMatch && statusMatch) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
        
        // Also hide test details when filtering
        testDetailsDivs.forEach(div => div.style.display = 'none');
        activeTestRow = null;
    }
    
    document.getElementById('filter-name').addEventListener('input', filterTestRuns);
    document.getElementById('filter-status').addEventListener('change', filterTestRuns);
    
    // Event listener for test table row clicks
    testTableRows.forEach(row => {
        row.addEventListener('click', () => {
            const testId = row.id.replace('test-row-', ''); // Extract test ID
            const testDetailsDiv = document.getElementById(\`test-details-\${testId}\`);
            
            // Remove 'selected' class from any previously selected row
            if (activeTestRow) {
                activeTestRow.classList.remove('selected');
            }
            
            // Add 'selected' class to the clicked row
            row.classList.add('selected');
            activeTestRow = row; // Update the active row
            
            // Show the corresponding test details
            testDetailsDivs.forEach(div => {
                div.style.display = 'none'; // Hide all details first
            });
            
            if (testDetailsDiv) {
                testDetailsDiv.style.display = 'block'; // Show the matching details
            }
           
        });
    });

    // Event listener for expanding steps
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('expand-steps-button')) {
            const stepsContainer = target.nextElementSibling; // Get the steps container
            if (stepsContainer.style.display === 'none') {
                stepsContainer.style.display = 'block';
                target.textContent = 'Collapse Steps'; // Change button text
            } else {
                stepsContainer.style.display = 'none';
                target.textContent = 'Expand Steps';
            }
        }
    });
    // Step management functions
function toggleStepDetails(element) {
    const details = element.nextElementSibling;
    if (details && details.classList.contains('step-details')) {
        details.style.display = details.style.display === 'block' ? 'none' : 'block';
    }
    const nestedSteps = element.parentElement.querySelector('.nested-steps');
    if (nestedSteps) {
        nestedSteps.style.display = nestedSteps.style.display === 'block' ? 'none' : 'block';
    }
}

function expandAllSteps() {
    document.querySelectorAll('.step-details').forEach(el => {
        el.style.display = 'block';
    });
    document.querySelectorAll('.nested-steps').forEach(el => {
        el.style.display = 'block';
    });
}

function collapseAllSteps() {
    document.querySelectorAll('.step-details').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('.nested-steps').forEach(el => {
        el.style.display = 'none';
    });
}
    </script>

    <script>
    // Helper functions
    function formatDuration(ms) {
        if (!ms) return '0ms';
        if (ms < 1000) return ms + 'ms';
        return (ms / 1000).toFixed(2) + 's';
    }

    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleString();
    }

    function getStatusIcon(status) {
        switch (status) {
            case 'passed': return '✓';
            case 'failed': return '✖';
            case 'skipped': return '↷';
            default: return '?';
        }
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Initialize the report
    function initReport() {
        // Update summary counts
        document.getElementById('passed-count').textContent = reportData.run.passed;
        document.getElementById('failed-count').textContent = reportData.run.failed;
        document.getElementById('skipped-count').textContent = reportData.run.skipped;
        
        // Update run info
        document.getElementById('generated-time').textContent = formatDate(reportData.metadata.generatedAt);
        document.getElementById('duration').textContent = formatDuration(reportData.run.duration);
        
        // Render tests
        const testListEl = document.getElementById('test-list');
        reportData.results.forEach(function(test) {
            testListEl.appendChild(renderTest(test));
        });

        // Tab functionality
        var tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(function(button) {
            button.addEventListener('click', function() {
                var tabId = this.dataset.tab;
                showTab(tabId);
            });
        });

        function showTab(tabId) {
            document.querySelectorAll('.tab-button').forEach(function(btn) {
                btn.classList.remove('active');
            });
            document.querySelectorAll('.tab-content').forEach(function(content) {
                content.classList.remove('active');
            });
            
            document.querySelector('[data-tab="' + tabId + '"]').classList.add('active');
            document.getElementById(tabId).classList.add('active');
        }
    }

    // Render a test
    function renderTest(test) {
        var testEl = document.createElement('div');
        testEl.className = 'test-item';
        
        var headerEl = document.createElement('div');
        headerEl.className = 'test-header';
        headerEl.innerHTML = [
            '<span class="status-icon">', getStatusIcon(test.status), '</span>',
            '<span class="test-title">', escapeHtml(test.name), '</span>',
            '<span class="duration">', formatDuration(test.duration), '</span>'
        ].join('');
        
        var detailsEl = document.createElement('div');
        detailsEl.className = 'test-details';
        
        // Test metadata
        var metaEl = document.createElement('div');
        metaEl.className = 'section';
        metaEl.innerHTML = [
            '<div class="section-title">Test Details</div>',
            '<div><strong>Suite:</strong> ', escapeHtml(test.suiteName), '</div>',
            '<div><strong>Started:</strong> ', formatDate(test.startTime), '</div>',
            '<div><strong>Ended:</strong> ', formatDate(test.endTime), '</div>',
            '<div><strong>Duration:</strong> ', formatDuration(test.duration), '</div>',
            test.tags && test.tags.length > 0 ? 
                '<div><strong>Tags:</strong> ' + 
                test.tags.map(function(tag) { 
                    return '<span class="tag">' + escapeHtml(tag) + '</span>'; 
                }).join(', ') + '</div>' : ''
        ].join('');
        detailsEl.appendChild(metaEl);
        
        // Steps
        if (test.steps && test.steps.length > 0) {
            var stepsEl = document.createElement('div');
            stepsEl.className = 'section';
            stepsEl.innerHTML = '<div class="section-title">Test Steps</div>';
            
            var stepsListEl = document.createElement('ul');
            stepsListEl.className = 'steps-list';
            test.steps.forEach(function(step) {
                stepsListEl.appendChild(renderStep(step));
            });
            
            stepsEl.appendChild(stepsListEl);
            detailsEl.appendChild(stepsEl);
        }
        
        // Error
        if (test.errorMessage) {
            var errorEl = document.createElement('div');
            errorEl.className = 'section';
            errorEl.innerHTML = [
                '<div class="section-title">Error</div>',
                '<pre class="error-message">', escapeHtml(test.errorMessage), '</pre>'
            ].join('');
            
            if (test.stackTrace) {
                errorEl.innerHTML += [
                    '<div class="section-title">Stack Trace</div>',
                    '<pre class="error-message">', escapeHtml(test.stackTrace), '</pre>'
                ].join('');
            }
            detailsEl.appendChild(errorEl);
        }
        
        // Attachments
        if (test.screenshots && test.screenshots.length > 0) {
            var attachmentsEl = document.createElement('div');
            attachmentsEl.className = 'section';
            attachmentsEl.innerHTML = '<div class="section-title">Attachments</div>';
            
            var attachmentsContainer = document.createElement('div');
            attachmentsContainer.className = 'attachments';
            
            test.screenshots.forEach(function(screenshot) {
                var attachmentEl = document.createElement('div');
                attachmentEl.className = 'attachment';
                attachmentEl.innerHTML = '<img src="' + escapeHtml(screenshot) + '" alt="Screenshot">';
                attachmentsContainer.appendChild(attachmentEl);
            });
            
            attachmentsEl.appendChild(attachmentsContainer);
            detailsEl.appendChild(attachmentsEl);
        }
        
        headerEl.addEventListener('click', function() {
            detailsEl.classList.toggle('show');
        });
        
        testEl.appendChild(headerEl);
        testEl.appendChild(detailsEl);
        
        return testEl;
    }

    // Render a step
    function renderStep(step) {
        var stepEl = document.createElement('li');
        stepEl.className = 'step-item';
        
        var headerEl = document.createElement('div');
        headerEl.className = 'step-header';
        headerEl.innerHTML = [
            '<span class="status-icon">', getStatusIcon(step.status), '</span>',
            '<span class="step-title">',
                step.isHook ? '<span class="hook-badge ' + step.hookType + '">' + step.hookType.toUpperCase() + '</span>' : '',
                escapeHtml(step.title),
            '</span>',
            '<span class="duration">', formatDuration(step.duration), '</span>'
        ].join('');
        
        var detailsEl = document.createElement('div');
        detailsEl.className = 'step-details';
        
        if (step.codeLocation) {
            var locationEl = document.createElement('div');
            locationEl.className = 'code-location';
            locationEl.textContent = step.codeLocation;
            detailsEl.appendChild(locationEl);
        }
        
        if (step.errorMessage) {
            var errorEl = document.createElement('pre');
            errorEl.className = 'error-message';
            errorEl.textContent = step.errorMessage + (step.stackTrace ? '\n' + step.stackTrace : '');
            detailsEl.appendChild(errorEl);
        }
        
        if (step.steps && step.steps.length > 0) {
            var nestedStepsEl = document.createElement('ul');
            nestedStepsEl.className = 'nested-steps';
            step.steps.forEach(function(nestedStep) {
                nestedStepsEl.appendChild(renderStep(nestedStep));
            });
            detailsEl.appendChild(nestedStepsEl);
        }
        
        headerEl.addEventListener('click', function() {
            detailsEl.classList.toggle('show');
        });
        
        stepEl.appendChild(headerEl);
        stepEl.appendChild(detailsEl);
        
        return stepEl;
    }

    // Start the report when page loads
    window.addEventListener('DOMContentLoaded', initReport);
</script>
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
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

// Run the main function
main();
