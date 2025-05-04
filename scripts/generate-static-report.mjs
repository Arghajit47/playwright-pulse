#!/usr/bin/env node
// Using Node.js syntax compatible with `.mjs`
import * as fs from "fs/promises";
import path from "path";
import * as d3 from "d3";
import { JSDOM } from "jsdom";
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

function generatePieChartD3(data, width = 280, height = 280) {
  // Create simulated DOM
  const { document } = new JSDOM().window;
  const body = d3.select(document.body);

  // Calculate passed percentage
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const passedPercentage =
    total > 0
      ? Math.round(
          ((data.find((d) => d.label === "Passed")?.value || 0) / total) * 100
        )
      : 0;

  // Chart dimensions
  const radius = Math.min(width, height) / 2 - 40;
  const legendRectSize = 18;
  const legendSpacing = 4;

  // Pie generator
  const pie = d3
    .pie()
    .value((d) => d.value)
    .sort(null);

  const arc = d3.arc().innerRadius(0).outerRadius(radius);

  // Color scale
  const color = d3
    .scaleOrdinal()
    .domain(data.map((d) => d.label))
    .range(["#4CAF50", "#F44336", "#FFC107"]);

  // Create SVG
  const svg = body
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g")
    .attr("transform", `translate(${width / 2},${height / 2})`);

  // Add tooltip container (hidden by default)
  const tooltip = body
    .append("div")
    .style("opacity", 0)
    .style("position", "absolute")
    .style("background", "white")
    .style("padding", "5px")
    .style("border", "1px solid #ddd")
    .style("border-radius", "4px")
    .style("pointer-events", "none");

  // Draw pie slices
  const arcs = svg
    .selectAll(".arc")
    .data(pie(data))
    .enter()
    .append("g")
    .attr("class", "arc");

  arcs
    .append("path")
    .attr("d", arc)
    .attr("fill", (d) => color(d.data.label))
    .style("stroke", "#fff")
    .style("stroke-width", 2)
    .on("mouseover", function (event, d) {
      tooltip.transition().style("opacity", 1);
      tooltip
        .html(
          `${d.data.label}: ${d.data.value} (${Math.round(
            (d.data.value / total) * 100
          )}%)`
        )
        .style("left", event.pageX + 10 + "px")
        .style("top", event.pageY - 28 + "px");
    })
    .on("mouseout", function () {
      tooltip.transition().style("opacity", 0);
    });

  // Add passed percentage in center
  svg
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", ".3em")
    .style("font-size", "24px")
    .style("font-weight", "bold")
    .text(`${passedPercentage}%`);

  // Add legend
  const legend = svg
    .selectAll(".legend")
    .data(color.domain())
    .enter()
    .append("g")
    .attr("class", "legend")
    .attr(
      "transform",
      (d, i) =>
        `translate(-${width / 2 - 30},${
          i * (legendRectSize + legendSpacing) - 60
        })`
    );

  legend
    .append("rect")
    .attr("width", legendRectSize)
    .attr("height", legendRectSize)
    .style("fill", color)
    .style("stroke", color);

  legend
    .append("text")
    .attr("x", legendRectSize + 4)
    .attr("y", legendRectSize - 4)
    .text((d) => d)
    .style("font-size", "12px")
    .style("text-anchor", "start");

  return `
    <div class="pie-chart-container">
      ${body.html()}
      <style>
        .pie-chart-container {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .pie-chart-container svg {
          margin-bottom: 20px;
        }
      </style>
    </div>
  `;
}

// Enhanced HTML generation with properly integrated CSS and JS
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

  // Generate test cases HTML
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

    return results
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
  };

  // Generate HTML with optimized CSS and JS
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playwright Pulse Report</title>
    <style>
        /* Base Styles */
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
          padding: 0;
          background-color: #fafafa;
          color: var(--text-color);
          line-height: 1.6;
        }
        
        .container {
          max-width: 1200px;
          margin: 20px auto;
          padding: 20px;
          background-color: #fff;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        /* Header Styles */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 20px;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--border-color);
        }
        
        .header h1 {
          margin: 0;
          font-size: 24px;
          color: var(--primary-color);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .run-info {
          background: #f5f5f5;
          padding: 10px 15px;
          border-radius: 6px;
          font-size: 14px;
        }
        
        /* Tab Styles */
        .tabs {
          display: flex;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 20px;
        }
        
        .tab-button {
          padding: 10px 20px;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: #666;
          position: relative;
        }
        
        .tab-button.active {
          color: var(--primary-color);
          font-weight: 500;
        }
        
        .tab-button.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--primary-color);
        }
        
        .tab-content {
          display: none;
        }
        
        .tab-content.active {
          display: block;
        }
        
        /* Dashboard Styles */
        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .summary-card {
          background: #fff;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
          text-align: center;
        }
        
        .summary-card h3 {
          margin: 0 0 10px;
          font-size: 16px;
          color: #666;
        }
        
        .summary-card .value {
          font-size: 28px;
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
        
        .pie-chart-container {
          grid-column: span 2;
          background: #fff;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        
        /* Test Run Summary Styles */
        .filters {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .filters input, 
        .filters select {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }
        
        .filters button {
          padding: 8px 16px;
          background: var(--primary-color);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .test-suite {
          margin-bottom: 15px;
          border: 1px solid #eee;
          border-radius: 6px;
          overflow: hidden;
        }
        
        .suite-header {
          padding: 12px 15px;
          background: #f9f9f9;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .suite-header:hover {
          background: #f0f0f0;
        }
        
        .suite-content {
          display: none;
          padding: 15px;
          background: white;
        }
        
        .test-details h3 {
          margin-top: 0;
          font-size: 18px;
          color: var(--dark-color);
        }
        
        .steps-list {
          margin: 15px 0;
          padding: 0;
          list-style: none;
        }
        
        .step-item {
          margin-bottom: 8px;
        }
        
        .step-header {
          display: flex;
          align-items: center;
          cursor: pointer;
          padding: 8px;
          border-radius: 4px;
        }
        
        .step-header:hover {
          background: #f5f5f5;
        }
        
        .step-icon {
          margin-right: 8px;
          width: 20px;
          text-align: center;
        }
        
        .step-title {
          flex: 1;
        }
        
        .step-duration {
          color: #666;
          font-size: 12px;
        }
        
        .step-details {
          display: none;
          padding: 10px;
          margin-top: 5px;
          background: #f9f9f9;
          border-radius: 4px;
          font-size: 14px;
        }
        
        .step-error {
          color: var(--danger-color);
          margin-top: 8px;
          padding: 8px;
          background: rgba(244, 67, 54, 0.1);
          border-radius: 4px;
          font-size: 13px;
        }
        
        .step-hook {
          background: rgba(33, 150, 243, 0.1);
        }
        
        .nested-steps {
          display: none;
          padding-left: 20px;
          border-left: 2px solid #eee;
          margin-top: 8px;
        }
        
        .attachments-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 15px;
          margin-top: 15px;
        }
        
        .attachment-item {
          border: 1px solid #eee;
          border-radius: 4px;
          overflow: hidden;
        }
        
        .attachment-item img {
          width: 100%;
          height: auto;
          display: block;
        }
        
        .tag {
          display: inline-block;
          background: #e0e0e0;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
          margin-right: 5px;
        }
        .status-badge {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
          color: white;
          text-transform: uppercase;
        }

        span.status-badge .status-passed  {
          background-color: #4CAF50 !important; /* Bright green */
        }

        span.status-badge .status-failed {
          background-color: #F44336 !important; /* Bright red */
        }

        span.status-badge .status-skipped {
          background-color: #FFC107 !important; /* Deep yellow */
        }

        /* Enhanced Pie Chart Styles */
        .pie-chart-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 20px 0;
        }

        .pie-chart-svg {
          margin: 0 auto;
        }

        .pie-chart-total {
          font-size: 18px;
          font-weight: bold;
          fill: #333;
        }

        .pie-chart-label {
          font-size: 12px;
          fill: #666;
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
          gap: 5px;
          font-size: 14px;
        }

        .legend-color {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          display: inline-block;
        }

        .legend-value {
          font-weight: 500;
        }
        
        /* Responsive Styles */
        @media (max-width: 768px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
          
          .pie-chart-container {
            grid-column: span 1;
          }
          
          .filters {
            flex-direction: column;
          }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div style="display: flex; align-items: center; gap: 15px;">
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
            <div class="dashboard-grid">
                <div class="summary-card">
                    <h3>Total Tests</h3>
                    <div class="value">${runSummary.totalTests}</div>
                </div>
                <div class="summary-card status-passed">
                    <h3>Passed</h3>
                    <div class="value">${runSummary.passed}</div>
                    <div class="trend">${passPercentage}%</div>
                </div>
                <div class="summary-card status-failed">
                    <h3>Failed</h3>
                    <div class="value">${runSummary.failed}</div>
                </div>
                <div class="summary-card status-skipped">
                    <h3>Skipped</h3>
                    <div class="value">${runSummary.skipped}</div>
                </div>
                <div class="pie-chart-container">
                    ${generatePieChartD3([
                      { label: "Passed", value: runSummary.passed },
                      { label: "Failed", value: runSummary.failed },
                      { label: "Skipped", value: runSummary.skipped },
                    ])}
                </div>
            </div>
        </div>
        
        <div id="test-runs" class="tab-content">
            <div class="filters">
                <input type="text" id="filter-name" placeholder="Search by test name...">
                <select id="filter-status">
                    <option value="">All Statuses</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                </select>
                <select id="filter-browser">
                    <option value="">All Browsers</option>
                    ${Array.from(
                      new Set(
                        results.map((test) => {
                          const match = test.name.match(/ > (\w+) > /);
                          return match ? match[1] : "unknown";
                        })
                      )
                    )
                      .map(
                        (browser) => `
                      <option value="${browser}">${browser}</option>
                    `
                      )
                      .join("")}
                </select>
                <button onclick="expandAllTests()">Expand All</button>
                <button onclick="collapseAllTests()">Collapse All</button>
            </div>
            <div class="test-suites">
                ${generateTestCasesHTML()}
            </div>
        </div>
    </div>
    
    <script>
    // Tab switching functionality
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        // Remove active class from all buttons and contents
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        // Add active class to clicked button and corresponding content
        const tabId = button.getAttribute('data-tab');
        button.classList.add('active');
        document.getElementById(tabId).classList.add('active');
      });
    });
    
    // Test filtering functionality
    function setupFilters() {
      const nameFilter = document.getElementById('filter-name');
      const statusFilter = document.getElementById('filter-status');
      const browserFilter = document.getElementById('filter-browser');
      
      const filterTests = () => {
        const nameValue = nameFilter.value.toLowerCase();
        const statusValue = statusFilter.value;
        const browserValue = browserFilter.value;
        
        document.querySelectorAll('.test-suite').forEach(suite => {
          const name = suite.querySelector('.test-name').textContent.toLowerCase();
          const status = suite.getAttribute('data-status');
          const browser = suite.getAttribute('data-browser');
          
          const nameMatch = name.includes(nameValue);
          const statusMatch = !statusValue || status === statusValue;
          const browserMatch = !browserValue || browser === browserValue;
          
          if (nameMatch && statusMatch && browserMatch) {
            suite.style.display = 'block';
          } else {
            suite.style.display = 'none';
          }
        });
      };
      
      nameFilter.addEventListener('input', filterTests);
      statusFilter.addEventListener('change', filterTests);
      browserFilter.addEventListener('change', filterTests);
    }
    
    // Test expansion functionality
    function toggleTestDetails(header) {
      const content = header.nextElementSibling;
      content.style.display = content.style.display === 'block' ? 'none' : 'block';
    }
    
    // Step expansion functionality
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
    
    // Initialize everything when DOM is loaded
    document.addEventListener('DOMContentLoaded', () => {
      setupFilters();
      
      // Make step headers clickable
      document.querySelectorAll('.step-header').forEach(header => {
        header.addEventListener('click', function() {
          toggleStepDetails(this);
        });
      });
      
      // Make test headers clickable
      document.querySelectorAll('.suite-header').forEach(header => {
        header.addEventListener('click', function() {
          toggleTestDetails(this);
        });
      });
    });

    // Enhanced expand/collapse functionality
    function toggleTestDetails(header) {
      const content = header.nextElementSibling;
      const isExpanded = content.style.display === 'block';
      content.style.display = isExpanded ? 'none' : 'block';
      header.setAttribute('aria-expanded', !isExpanded);
    }

    function toggleStepDetails(header) {
      const details = header.nextElementSibling;
      const nestedSteps = header.parentElement.querySelector('.nested-steps');

      // Toggle main step details
      const isExpanded = details.style.display === 'block';
      details.style.display = isExpanded ? 'none' : 'block';

      // Toggle nested steps if they exist
      if (nestedSteps) {
        nestedSteps.style.display = isExpanded ? 'none' : 'block';
      }
    
      header.setAttribute('aria-expanded', !isExpanded);
    }

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
      document.querySelectorAll('[aria-expanded]').forEach(el => {
        el.setAttribute('aria-expanded', 'true');
      });
    }

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
      document.querySelectorAll('[aria-expanded]').forEach(el => {
        el.setAttribute('aria-expanded', 'false');
      });
    }

    // Initialize all interactive elements
    function initializeInteractiveElements() {
      // Test headers
      document.querySelectorAll('.suite-header').forEach(header => {
        header.addEventListener('click', () => toggleTestDetails(header));
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', 'false');
    });

      // Step headers
    document.querySelectorAll('.step-header').forEach(header => {
      header.addEventListener('click', () => toggleStepDetails(header));
      header.setAttribute('role', 'button');
      header.setAttribute('aria-expanded', 'false');
    });

    // Filter buttons
    document.getElementById('filter-name').addEventListener('input', filterTests);
    document.getElementById('filter-status').addEventListener('change', filterTests);
    document.getElementById('filter-browser').addEventListener('change', filterTests);
  }

    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', initializeInteractiveElements);
    </script>
</body>
</html>
  `;
}

// [Keep the rest of the file unchanged...]

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
