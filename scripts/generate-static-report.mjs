#!/usr/bin/env node
// Using Node.js syntax compatible with `.mjs`
import * as fs from "fs/promises";
import path from "path";
// import * as d3 from "d3"; // Removed D3
import { JSDOM } from "jsdom"; // JSDOM still used by other parts, but not directly in chart string generation
import * as XLSX from "xlsx";
import { fork } from "child_process"; // Add this
import { fileURLToPath } from "url"; // Add this for resolving path in ESM

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
const DEFAULT_OUTPUT_DIR = "pulse-report";
const DEFAULT_JSON_FILE = "playwright-pulse-report.json";
const DEFAULT_HTML_FILE = "playwright-pulse-static-report.html";

// Helper functions
function sanitizeHTML(str) {
  // User's provided version (note: this doesn't escape HTML special chars correctly)
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, `"`)
    .replace(/'/g, "'");
}
function capitalize(str) {
  if (!str) return ""; // Handle empty string
  return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

// User-provided formatDuration function
function formatDuration(ms) {
  if (ms === undefined || ms === null || ms < 0) return "0.0s";
  return (ms / 1000).toFixed(1) + "s";
}

function generateTestTrendsChart(trendData) {
  if (!trendData || !trendData.overall || trendData.overall.length === 0) {
    return '<div class="no-data">No overall trend data available for test counts.</div>';
  }

  const chartId = `testTrendsChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const runs = trendData.overall;

  const series = [
    {
      name: "Total",
      data: runs.map((r) => r.totalTests),
      color: "var(--primary-color)", // Blue
      marker: { symbol: "circle" },
    },
    {
      name: "Passed",
      data: runs.map((r) => r.passed),
      color: "var(--success-color)", // Green
      marker: { symbol: "circle" },
    },
    {
      name: "Failed",
      data: runs.map((r) => r.failed),
      color: "var(--danger-color)", // Red
      marker: { symbol: "circle" },
    },
    {
      name: "Skipped",
      data: runs.map((r) => r.skipped || 0),
      color: "var(--warning-color)", // Yellow
      marker: { symbol: "circle" },
    },
  ];

  // Data needed by the tooltip formatter, stringified to be embedded in the client-side script
  const runsForTooltip = runs.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    duration: r.duration,
  }));

  const optionsObjectString = `
  {
      chart: { type: "line", height: 350, backgroundColor: "transparent" },
      title: { text: null },
      xAxis: {
          categories: ${JSON.stringify(runs.map((run, i) => `Run ${i + 1}`))},
          crosshair: true,
          labels: { style: { color: 'var(--text-color-secondary)', fontSize: '12px' }}
      },
      yAxis: {
          title: { text: "Test Count", style: { color: 'var(--text-color)'} },
          min: 0,
          labels: { style: { color: 'var(--text-color-secondary)', fontSize: '12px' }}
      },
      legend: {
          layout: "horizontal", align: "center", verticalAlign: "bottom",
          itemStyle: { fontSize: "12px", color: 'var(--text-color)' }
      },
      plotOptions: {
          series: { marker: { radius: 4, states: { hover: { radius: 6 }}}, states: { hover: { halo: { size: 5, opacity: 0.1 }}}},
          line: { lineWidth: 2.5 } // fillOpacity was 0.1, but for line charts, area fill is usually separate (area chart type)
      },
      tooltip: {
          shared: true, useHTML: true,
          backgroundColor: 'rgba(10,10,10,0.92)',
          borderColor: 'rgba(10,10,10,0.92)',
          style: { color: '#f5f5f5' },
          formatter: function () {
              const runsData = ${JSON.stringify(runsForTooltip)};
              const pointIndex = this.points[0].point.x; // Get index from point
              const run = runsData[pointIndex];
              let tooltip = '<strong>Run ' + (run.runId || pointIndex + 1) + '</strong><br>' +
                            'Date: ' + new Date(run.timestamp).toLocaleString() + '<br><br>';
              this.points.forEach(point => {
                  tooltip += '<span style="color:' + point.color + '">●</span> ' + point.series.name + ': <b>' + point.y + '</b><br>';
              });
              tooltip += '<br>Duration: ' + formatDuration(run.duration);
              return tooltip;
          }
      },
      series: ${JSON.stringify(series)},
      credits: { enabled: false }
  }
  `;

  return `
      <div id="${chartId}" class="trend-chart-container"></div>
      <script>
          document.addEventListener('DOMContentLoaded', function() {
              if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                  try {
                      const chartOptions = ${optionsObjectString};
                      Highcharts.chart('${chartId}', chartOptions);
                  } catch (e) {
                      console.error("Error rendering chart ${chartId}:", e);
                      document.getElementById('${chartId}').innerHTML = '<div class="no-data">Error rendering test trends chart.</div>';
                  }
              } else {
                  document.getElementById('${chartId}').innerHTML = '<div class="no-data">Charting library not available.</div>';
              }
          });
      </script>
  `;
}

function generateDurationTrendChart(trendData) {
  if (!trendData || !trendData.overall || trendData.overall.length === 0) {
    return '<div class="no-data">No overall trend data available for durations.</div>';
  }
  const chartId = `durationTrendChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const runs = trendData.overall;

  // Assuming var(--accent-color-alt) is Orange #FF9800
  const accentColorAltRGB = "255, 152, 0";

  const seriesString = `[{
      name: 'Duration',
      data: ${JSON.stringify(runs.map((run) => run.duration))},
      color: 'var(--accent-color-alt)',
      type: 'area',
      marker: {
          symbol: 'circle', enabled: true, radius: 4,
          states: { hover: { radius: 6, lineWidthPlus: 0 } }
      },
      fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
              [0, 'rgba(${accentColorAltRGB}, 0.4)'],
              [1, 'rgba(${accentColorAltRGB}, 0.05)']
          ]
      },
      lineWidth: 2.5
  }]`;

  const runsForTooltip = runs.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    duration: r.duration,
    totalTests: r.totalTests,
  }));

  const optionsObjectString = `
  {
      chart: { type: 'area', height: 350, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: {
          categories: ${JSON.stringify(runs.map((run, i) => `Run ${i + 1}`))},
          crosshair: true,
          labels: { style: { color: 'var(--text-color-secondary)', fontSize: '12px' } }
      },
      yAxis: {
          title: { text: 'Duration', style: { color: 'var(--text-color)' } },
          labels: {
              formatter: function() { return formatDuration(this.value); },
              style: { color: 'var(--text-color-secondary)', fontSize: '12px' }
          },
          min: 0
      },
      legend: {
          layout: 'horizontal', align: 'center', verticalAlign: 'bottom',
          itemStyle: { fontSize: '12px', color: 'var(--text-color)' }
      },
      plotOptions: {
          area: {
              lineWidth: 2.5,
              states: { hover: { lineWidthPlus: 0 } },
              threshold: null 
          }
      },
      tooltip: {
          shared: true, useHTML: true,
          backgroundColor: 'rgba(10,10,10,0.92)',
          borderColor: 'rgba(10,10,10,0.92)',
          style: { color: '#f5f5f5' },
          formatter: function () {
              const runsData = ${JSON.stringify(runsForTooltip)};
              const pointIndex = this.points[0].point.x;
              const run = runsData[pointIndex];
              let tooltip = '<strong>Run ' + (run.runId || pointIndex + 1) + '</strong><br>' +
                            'Date: ' + new Date(run.timestamp).toLocaleString() + '<br>';
              this.points.forEach(point => {
                  tooltip += '<span style="color:' + point.series.color + '">●</span> ' +
                             point.series.name + ': <b>' + formatDuration(point.y) + '</b><br>';
              });
              tooltip += '<br>Tests: ' + run.totalTests;
              return tooltip;
          }
      },
      series: ${seriesString},
      credits: { enabled: false }
  }
  `;

  return `
      <div id="${chartId}" class="trend-chart-container"></div>
      <script>
          document.addEventListener('DOMContentLoaded', function() {
              if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                  try {
                      const chartOptions = ${optionsObjectString};
                      Highcharts.chart('${chartId}', chartOptions);
                  } catch (e) {
                      console.error("Error rendering chart ${chartId}:", e);
                      document.getElementById('${chartId}').innerHTML = '<div class="no-data">Error rendering duration trend chart.</div>';
                  }
              } else {
                   document.getElementById('${chartId}').innerHTML = '<div class="no-data">Charting library not available.</div>';
              }
          });
      </script>
  `;
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

function generateTestHistoryChart(history) {
  if (!history || history.length === 0)
    return '<div class="no-data-chart">No data for chart</div>';

  const validHistory = history.filter(
    (h) => h && typeof h.duration === "number" && h.duration >= 0
  );
  if (validHistory.length === 0)
    return '<div class="no-data-chart">No valid data for chart</div>';

  const chartId = `testHistoryChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  const seriesDataPoints = validHistory.map((run) => {
    let color;
    switch (String(run.status).toLowerCase()) {
      case "passed":
        color = "var(--success-color)";
        break;
      case "failed":
        color = "var(--danger-color)";
        break;
      case "skipped":
        color = "var(--warning-color)";
        break;
      default:
        color = "var(--dark-gray-color)";
    }
    return {
      y: run.duration,
      marker: {
        fillColor: color,
        symbol: "circle",
        radius: 3.5,
        states: { hover: { radius: 5 } },
      },
      status: run.status,
      runId: run.runId,
    };
  });

  // Assuming var(--accent-color) is Deep Purple #673ab7 -> RGB 103, 58, 183
  const accentColorRGB = "103, 58, 183";

  const optionsObjectString = `
  {
      chart: { type: 'area', height: 100, width: 320, backgroundColor: 'transparent', spacing: [10,10,15,35] },
      title: { text: null },
      xAxis: {
          categories: ${JSON.stringify(
            validHistory.map((_, i) => `R${i + 1}`)
          )},
          labels: { style: { fontSize: '10px', color: 'var(--text-color-secondary)' } }
      },
      yAxis: {
          title: { text: null },
          labels: {
              formatter: function() { return formatDuration(this.value); },
              style: { fontSize: '10px', color: 'var(--text-color-secondary)' },
              align: 'left', x: -35, y: 3
          },
          min: 0,
          gridLineWidth: 0,
          tickAmount: 4
      },
      legend: { enabled: false },
      plotOptions: {
          area: {
              lineWidth: 2,
              lineColor: 'var(--accent-color)',
              fillColor: {
                  linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                  stops: [
                      [0, 'rgba(${accentColorRGB}, 0.4)'],
                      [1, 'rgba(${accentColorRGB}, 0)']
                  ]
              },
              marker: { enabled: true },
              threshold: null
          }
      },
      tooltip: {
          useHTML: true,
          backgroundColor: 'rgba(10,10,10,0.92)',
          borderColor: 'rgba(10,10,10,0.92)',
          style: { color: '#f5f5f5', padding: '8px' },
          formatter: function() {
              const pointData = this.point;
              let statusBadgeHtml = '<span style="padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-weight: 600; color: white; text-transform: uppercase; background-color: ';
              switch(String(pointData.status).toLowerCase()) {
                  case 'passed': statusBadgeHtml += 'var(--success-color)'; break;
                  case 'failed': statusBadgeHtml += 'var(--danger-color)'; break;
                  case 'skipped': statusBadgeHtml += 'var(--warning-color)'; break;
                  default: statusBadgeHtml += 'var(--dark-gray-color)';
              }
              statusBadgeHtml += ';">' + String(pointData.status).toUpperCase() + '</span>';

              return '<strong>Run ' + (pointData.runId || (this.point.index + 1)) + '</strong><br>' +
                     'Status: ' + statusBadgeHtml + '<br>' +
                     'Duration: ' + formatDuration(pointData.y);
          }
      },
      series: [{
          data: ${JSON.stringify(seriesDataPoints)},
          showInLegend: false
      }],
      credits: { enabled: false }
  }
  `;
  return `
      <div id="${chartId}" style="width: 320px; height: 100px;"></div>
      <script>
          document.addEventListener('DOMContentLoaded', function() {
              if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                  try {
                      const chartOptions = ${optionsObjectString};
                      Highcharts.chart('${chartId}', chartOptions);
                  } catch (e) {
                      console.error("Error rendering chart ${chartId}:", e);
                      document.getElementById('${chartId}').innerHTML = '<div class="no-data-chart">Error rendering history chart.</div>';
                  }
              } else {
                  document.getElementById('${chartId}').innerHTML = '<div class="no-data-chart">Charting library not available.</div>';
              }
          });
      </script>
  `;
}

function generatePieChart(data, chartWidth = 300, chartHeight = 300) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return '<div class="pie-chart-wrapper"><h3>Test Distribution</h3><div class="no-data">No data for Test Distribution chart.</div></div>';
  }
  const passedEntry = data.find((d) => d.label === "Passed");
  const passedPercentage = Math.round(
    ((passedEntry ? passedEntry.value : 0) / total) * 100
  );

  const chartId = `pieChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  const seriesData = [
    {
      name: "Tests", // Changed from 'Test Distribution' for tooltip clarity
      data: data
        .filter((d) => d.value > 0)
        .map((d) => {
          let color;
          switch (d.label) {
            case "Passed":
              color = "var(--success-color)";
              break;
            case "Failed":
              color = "var(--danger-color)";
              break;
            case "Skipped":
              color = "var(--warning-color)";
              break;
            default:
              color = "#CCCCCC"; // A neutral default color
          }
          return { name: d.label, y: d.value, color: color };
        }),
      size: "100%",
      innerSize: "55%",
      dataLabels: { enabled: false },
      showInLegend: true,
    },
  ];

  // Approximate font size for center text, can be adjusted or made dynamic with more client-side JS
  const centerTitleFontSize =
    Math.max(12, Math.min(chartWidth, chartHeight) / 12) + "px";
  const centerSubtitleFontSize =
    Math.max(10, Math.min(chartWidth, chartHeight) / 18) + "px";

  const optionsObjectString = `
  {
      chart: {
          type: 'pie',
          width: ${chartWidth},
          height: ${
            chartHeight - 40
          }, // Adjusted height to make space for legend if chartHeight is for the whole wrapper
          backgroundColor: 'transparent',
          plotShadow: false,
          spacingBottom: 40 // Ensure space for legend
      },
      title: {
          text: '${passedPercentage}%',
          align: 'center',
          verticalAlign: 'middle',
          y: 5, 
          style: { fontSize: '${centerTitleFontSize}', fontWeight: 'bold', color: 'var(--primary-color)' }
      },
      subtitle: {
          text: 'Passed',
          align: 'center',
          verticalAlign: 'middle',
          y: 25, 
          style: { fontSize: '${centerSubtitleFontSize}', color: 'var(--text-color-secondary)' }
      },
      tooltip: {
          pointFormat: '{series.name}: <b>{point.percentage:.1f}%</b> ({point.y})',
          backgroundColor: 'rgba(10,10,10,0.92)',
          borderColor: 'rgba(10,10,10,0.92)',
          style: { color: '#f5f5f5' }
      },
      legend: {
          layout: 'horizontal',
          align: 'center',
          verticalAlign: 'bottom',
          itemStyle: { color: 'var(--text-color)', fontWeight: 'normal', fontSize: '12px' }
      },
      plotOptions: {
          pie: {
              allowPointSelect: true,
              cursor: 'pointer',
              borderWidth: 3,
              borderColor: 'var(--card-background-color)', // Match D3 style
              states: {
                  hover: {
                      // Using default Highcharts halo which is generally good
                  }
              }
          }
      },
      series: ${JSON.stringify(seriesData)},
      credits: { enabled: false }
  }
  `;

  return `
      <div class="pie-chart-wrapper" style="align-items: center">
          <div style="display: flex; align-items: start; width: 100%;"><h3>Test Distribution</h3></div>
          <div id="${chartId}" style="width: ${chartWidth}px; height: ${
    chartHeight - 40
  }px;"></div>
          <script>
              document.addEventListener('DOMContentLoaded', function() {
                  if (typeof Highcharts !== 'undefined') {
                      try {
                          const chartOptions = ${optionsObjectString};
                          Highcharts.chart('${chartId}', chartOptions);
                      } catch (e) {
                          console.error("Error rendering chart ${chartId}:", e);
                          document.getElementById('${chartId}').innerHTML = '<div class="no-data">Error rendering pie chart.</div>';
                      }
                  } else {
                      document.getElementById('${chartId}').innerHTML = '<div class="no-data">Charting library not available.</div>';
                  }
              });
          </script>
      </div>
  `;
}

function generateTestHistoryContent(trendData) {
  if (
    !trendData ||
    !trendData.testRuns ||
    Object.keys(trendData.testRuns).length === 0
  ) {
    return '<div class="no-data">No historical test data available.</div>';
  }

  const allTestNamesAndPaths = new Map();
  Object.values(trendData.testRuns).forEach((run) => {
    if (Array.isArray(run)) {
      run.forEach((test) => {
        if (test && test.testName && !allTestNamesAndPaths.has(test.testName)) {
          const parts = test.testName.split(" > ");
          const title = parts[parts.length - 1];
          allTestNamesAndPaths.set(test.testName, title);
        }
      });
    }
  });

  if (allTestNamesAndPaths.size === 0) {
    return '<div class="no-data">No historical test data found after processing.</div>';
  }

  const testHistory = Array.from(allTestNamesAndPaths.entries())
    .map(([fullTestName, testTitle]) => {
      const history = [];
      (trendData.overall || []).forEach((overallRun, index) => {
        const runKey = overallRun.runId
          ? `test run ${overallRun.runId}`
          : `test run ${index + 1}`;
        const testRunForThisOverallRun = trendData.testRuns[runKey]?.find(
          (t) => t && t.testName === fullTestName
        );
        if (testRunForThisOverallRun) {
          history.push({
            runId: overallRun.runId || index + 1,
            status: testRunForThisOverallRun.status || "unknown",
            duration: testRunForThisOverallRun.duration || 0,
            timestamp:
              testRunForThisOverallRun.timestamp ||
              overallRun.timestamp ||
              new Date(),
          });
        }
      });
      return { fullTestName, testTitle, history };
    })
    .filter((item) => item.history.length > 0);

  return `
    <div class="test-history-container">
      <div class="filters" style="border-color: black; border-style: groove;">
        <input type="text" id="history-filter-name" placeholder="Search by test title..." style="border-color: black; border-style: outset;">
        <select id="history-filter-status">
          <option value="">All Statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>
      
      <div class="test-history-grid">
        ${testHistory
          .map((test) => {
            const latestRun =
              test.history.length > 0
                ? test.history[test.history.length - 1]
                : { status: "unknown" };
            return `
            <div class="test-history-card" data-test-name="${sanitizeHTML(
              test.testTitle.toLowerCase()
            )}" data-latest-status="${latestRun.status}">
              <div class="test-history-header">
                <p title="${sanitizeHTML(test.testTitle)}">${capitalize(
              sanitizeHTML(test.testTitle)
            )}</p>
                <span class="status-badge ${getStatusClass(latestRun.status)}">
                  ${String(latestRun.status).toUpperCase()}
                </span>
              </div>
              <div class="test-history-trend">
                ${generateTestHistoryChart(test.history)}
              </div>
              <details class="test-history-details-collapsible">
                <summary>Show Run Details (${test.history.length})</summary>
                <div class="test-history-details">
                  <table>
                    <thead><tr><th>Run</th><th>Status</th><th>Duration</th><th>Date</th></tr></thead>
                    <tbody>
                      ${test.history
                        .slice()
                        .reverse()
                        .map(
                          (run) => `
                        <tr>
                          <td>${run.runId}</td>
                          <td><span class="status-badge-small ${getStatusClass(
                            run.status
                          )}">${String(run.status).toUpperCase()}</span></td>
                          <td>${formatDuration(run.duration)}</td>
                          <td>${formatDate(run.timestamp)}</td>
                        </tr>`
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>`;
          })
          .join("")}
      </div>
    </div>
  `;
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

function getSuitesData(results) {
  const suitesMap = new Map();
  if (!results || results.length === 0) return [];

  results.forEach((test) => {
    const browser = test.browser || "unknown";
    const suiteParts = test.name.split(" > ");
    let suiteNameCandidate = "Default Suite";
    if (suiteParts.length > 2) {
      suiteNameCandidate = suiteParts[1];
    } else if (suiteParts.length > 1) {
      suiteNameCandidate = suiteParts[0]
        .split(path.sep)
        .pop()
        .replace(/\.(spec|test)\.(ts|js|mjs|cjs)$/, "");
    } else {
      suiteNameCandidate = test.name
        .split(path.sep)
        .pop()
        .replace(/\.(spec|test)\.(ts|js|mjs|cjs)$/, "");
    }
    const suiteName = suiteNameCandidate;
    const key = `${suiteName}|${browser}`;

    if (!suitesMap.has(key)) {
      suitesMap.set(key, {
        id: test.id || key,
        name: suiteName,
        browser: browser,
        passed: 0,
        failed: 0,
        skipped: 0,
        count: 0,
        statusOverall: "passed",
      });
    }
    const suite = suitesMap.get(key);
    suite.count++;
    const currentStatus = String(test.status).toLowerCase();
    if (currentStatus && suite[currentStatus] !== undefined) {
      suite[currentStatus]++;
    }

    if (currentStatus === "failed") {
      suite.statusOverall = "failed";
    } else if (
      currentStatus === "skipped" &&
      suite.statusOverall !== "failed"
    ) {
      suite.statusOverall = "skipped";
    }
  });
  return Array.from(suitesMap.values());
}

function generateSuitesWidget(suitesData) {
  if (!suitesData || suitesData.length === 0) {
    return `<div class="suites-widget"><div class="suites-header"><h2>Test Suites</h2></div><div class="no-data">No suite data available.</div></div>`;
  }
  return `
<div class="suites-widget">
  <div class="suites-header">
    <h2>Test Suites</h2>
    <span class="summary-badge">
      ${suitesData.length} suites • ${suitesData.reduce(
    (sum, suite) => sum + suite.count,
    0
  )} tests
    </span>
  </div>
  <div class="suites-grid">
    ${suitesData
      .map(
        (suite) => `
    <div class="suite-card status-${suite.statusOverall}">
      <div class="suite-card-header">
        <h3 class="suite-name" title="${sanitizeHTML(
          suite.name
        )} (${sanitizeHTML(suite.browser)})">${sanitizeHTML(suite.name)}</h3>
        <span class="browser-tag">${sanitizeHTML(suite.browser)}</span>
      </div>
      <div class="suite-card-body">
        <span class="test-count">${suite.count} test${
          suite.count !== 1 ? "s" : ""
        }</span>
        <div class="suite-stats">
            ${
              suite.passed > 0
                ? `<span class="stat-passed" title="Passed"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" class="bi bi-check-circle-fill" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/></svg> ${suite.passed}</span>`
                : ""
            }
            ${
              suite.failed > 0
                ? `<span class="stat-failed" title="Failed"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" class="bi bi-x-circle-fill" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/></svg> ${suite.failed}</span>`
                : ""
            }
            ${
              suite.skipped > 0
                ? `<span class="stat-skipped" title="Skipped"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" class="bi bi-exclamation-triangle-fill" viewBox="0 0 16 16"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg> ${suite.skipped}</span>`
                : ""
            }
        </div>
      </div>
    </div>`
      )
      .join("")}
  </div>
</div>`;
}

function generateHTML(reportData, trendData = null) {
  const { run, results } = reportData;
  const suitesData = getSuitesData(reportData.results || []);
  const runSummary = run || {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    timestamp: new Date().toISOString(),
  };

  const totalTestsOr1 = runSummary.totalTests || 1; // Avoid division by zero
  const passPercentage = Math.round((runSummary.passed / totalTestsOr1) * 100);
  const failPercentage = Math.round((runSummary.failed / totalTestsOr1) * 100);
  const skipPercentage = Math.round(
    ((runSummary.skipped || 0) / totalTestsOr1) * 100
  );
  const avgTestDuration =
    runSummary.totalTests > 0
      ? formatDuration(runSummary.duration / runSummary.totalTests)
      : "0.0s";

  function generateTestCasesHTML() {
    if (!results || results.length === 0) {
      return '<div class="no-tests">No test results found in this run.</div>';
    }

    return results
      .map((test, index) => {
        const browser = test.browser || "unknown";
        const testFileParts = test.name.split(" > ");
        const testTitle =
          testFileParts[testFileParts.length - 1] || "Unnamed Test";

        const generateStepsHTML = (steps, depth = 0) => {
          if (!steps || steps.length === 0)
            return "<div class='no-steps'>No steps recorded for this test.</div>";
          return steps
            .map((step) => {
              const hasNestedSteps = step.steps && step.steps.length > 0;
              const isHook = step.hookType;
              const stepClass = isHook
                ? `step-hook step-hook-${step.hookType}`
                : "";
              const hookIndicator = isHook ? ` (${step.hookType} hook)` : "";

              return `
          <div class="step-item" style="--depth: ${depth};">
            <div class="step-header ${stepClass}" role="button" aria-expanded="false">
              <span class="step-icon">${getStatusIcon(step.status)}</span>
              <span class="step-title">${sanitizeHTML(
                step.title
              )}${hookIndicator}</span>
              <span class="step-duration">${formatDuration(
                step.duration
              )}</span>
            </div>
            <div class="step-details" style="display: none;">
              ${
                step.codeLocation
                  ? `<div class="step-info"><strong>Location:</strong> ${sanitizeHTML(
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
                      ? `<pre class="stack-trace">${sanitizeHTML(
                          step.stackTrace
                        )}</pre>`
                      : ""
                  }
                </div>`
                  : ""
              }
              ${
                hasNestedSteps
                  ? `<div class="nested-steps">${generateStepsHTML(
                      step.steps,
                      depth + 1
                    )}</div>`
                  : ""
              }
            </div>
          </div>`;
            })
            .join("");
        };

        return `
      <div class="test-case" data-status="${
        test.status
      }" data-browser="${sanitizeHTML(browser)}" data-tags="${(test.tags || [])
          .join(",")
          .toLowerCase()}">
        <div class="test-case-header" role="button" aria-expanded="false">
          <div class="test-case-summary">
            <span class="status-badge ${getStatusClass(test.status)}">${String(
          test.status
        ).toUpperCase()}</span>
            <span class="test-case-title" title="${sanitizeHTML(
              test.name
            )}">${sanitizeHTML(testTitle)}</span>
            <span class="test-case-browser">(${sanitizeHTML(browser)})</span>
          </div>
          <div class="test-case-meta">
            ${
              test.tags && test.tags.length > 0
                ? test.tags
                    .map((t) => `<span class="tag">${sanitizeHTML(t)}</span>`)
                    .join(" ")
                : ""
            }
            <span class="test-duration">${formatDuration(test.duration)}</span>
          </div>
        </div>
        <div class="test-case-content" style="display: none;">
          <p><strong>Full Path:</strong> ${sanitizeHTML(test.name)}</p>
          ${
            test.error
              ? `<div class="test-error-summary"><h4>Test Error:</h4><pre>${sanitizeHTML(
                  test.error
                )}</pre></div>`
              : ""
          }

          <h4>Steps</h4>
          <div class="steps-list">${generateStepsHTML(test.steps)}</div>

          ${
            test.stdout && test.stdout.length > 0
              ? `
            <div class="console-output-section">
              <h4>Console Output (stdout)</h4>
              <pre class="console-log stdout-log" style="background-color: #2d2d2d; color: wheat; padding: 1.25em; border-radius: 0.85em; line-height: 1.2;">${test.stdout
                .map((line) => sanitizeHTML(line))
                .join("\n")}</pre>
            </div>`
              : ""
          }
          ${
            test.stderr && test.stderr.length > 0
              ? `
            <div class="console-output-section">
              <h4>Console Output (stderr)</h4>
              <pre class="console-log stderr-log" style="background-color: #2d2d2d; color: indianred; padding: 1.25em; border-radius: 0.85em; line-height: 1.2;">${test.stderr
                .map((line) => sanitizeHTML(line))
                .join("\n")}</pre>
            </div>`
              : ""
          }
          
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
            test.videoPath
              ? `
            <div class="attachments-section">
              <h4>Videos</h4>
              <div class="attachments-grid">
                ${(() => {
                  // Handle both string and array cases
                  const videos = Array.isArray(test.videoPath)
                    ? test.videoPath
                    : [test.videoPath];
                  const mimeTypes = {
                    mp4: "video/mp4",
                    webm: "video/webm",
                    ogg: "video/ogg",
                    mov: "video/quicktime",
                    avi: "video/x-msvideo",
                  };

                  return videos
                    .map((video, index) => {
                      const videoUrl =
                        typeof video === "object" ? video.url || "" : video;
                      const videoName =
                        typeof video === "object"
                          ? video.name || `Video ${index + 1}`
                          : `Video ${index + 1}`;
                      const fileExtension = videoUrl
                        .split(".")
                        .pop()
                        .toLowerCase();
                      const mimeType = mimeTypes[fileExtension] || "video/mp4";

                      return `
                      <div class="attachment-item">
                        <video controls width="100%" height="auto" title="${videoName}">
                          <source src="${videoUrl}" type="${mimeType}">
                          Your browser does not support the video tag.
                        </video>
                        <div class="attachment-info">
                          <span class="video-name">${videoName}</span>
                          <a href="${videoUrl}" target="_blank" download="${videoName}.${fileExtension}">
                            Download
                          </a>
                        </div>
                      </div>
                    `;
                    })
                    .join("");
                })()}
              </div>
            </div>
          `
              : ""
          }
          
          ${
            test.tracePath
              ? `
  <div class="attachments-section">
    <h4>Trace Files</h4>
    <div class="attachments-grid">
      ${(() => {
        // Handle both string and array cases
        const traces = Array.isArray(test.tracePath)
          ? test.tracePath
          : [test.tracePath];

        return traces
          .map((trace, index) => {
            const traceUrl =
              typeof trace === "object" ? trace.url || "" : trace;
            const traceName =
              typeof trace === "object"
                ? trace.name || `Trace ${index + 1}`
                : `Trace ${index + 1}`;
            const traceFileName = traceUrl.split("/").pop();
            const traceViewerUrl = `https://trace.playwright.dev/?trace=${encodeURIComponent(
              traceUrl
            )}&traceFileName=${encodeURIComponent(traceFileName)}`;

            return `
            <div class="attachment-item">
              <div class="trace-preview">
                <span class="trace-icon">📄</span>
                <span class="trace-name">${traceName}</span>
              </div>
              <div class="attachment-info">
                <div class="trace-actions">
                  <a href="${traceUrl}" target="_blank" download="${traceFileName}" class="download-trace">
                    Download
                  </a>
                </div>
              </div>
            </div>
          `;
          })
          .join("");
      })()}
    </div>
  </div>
`
              : ""
          }

          ${
            test.codeSnippet
              ? `<div class="code-section"><h4>Code Snippet</h4><pre><code>${sanitizeHTML(
                  test.codeSnippet
                )}</code></pre></div>`
              : ""
          }
        </div>
      </div>`;
      })
      .join("");
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="https://i.postimg.cc/XqVn1NhF/pulse.png">
    <link rel="apple-touch-icon" href="https://i.postimg.cc/XqVn1NhF/pulse.png">
    <script src="https://code.highcharts.com/highcharts.js"></script>
    <title>Playwright Pulse Report</title>
    <style>
        :root {
          --primary-color: #3f51b5; /* Indigo */
          --secondary-color: #ff4081; /* Pink */
          --accent-color: #673ab7; /* Deep Purple */
          --accent-color-alt: #FF9800; /* Orange for duration charts */
          --success-color: #4CAF50; /* Green */
          --danger-color: #F44336; /* Red */
          --warning-color: #FFC107; /* Amber */
          --info-color: #2196F3; /* Blue */
          --light-gray-color: #f5f5f5;
          --medium-gray-color: #e0e0e0;
          --dark-gray-color: #757575;
          --text-color: #333;
          --text-color-secondary: #555;
          --border-color: #ddd;
          --background-color: #f8f9fa; 
          --card-background-color: #fff;
          --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          --border-radius: 8px;
          --box-shadow: 0 5px 15px rgba(0,0,0,0.08); 
          --box-shadow-light: 0 3px 8px rgba(0,0,0,0.05);
          --box-shadow-inset: inset 0 1px 3px rgba(0,0,0,0.07);
        }

        /* General Highcharts styling */
        .highcharts-background { fill: transparent; }
        .highcharts-title, .highcharts-subtitle { font-family: var(--font-family); }
        .highcharts-axis-labels text, .highcharts-legend-item text { fill: var(--text-color-secondary) !important; font-size: 12px !important; }
        .highcharts-axis-title { fill: var(--text-color) !important; }
        .highcharts-tooltip > span { background-color: rgba(10,10,10,0.92) !important; border-color: rgba(10,10,10,0.92) !important; color: #f5f5f5 !important; padding: 10px !important; border-radius: 6px !important; }
        
        body {
          font-family: var(--font-family);
          margin: 0;
          background-color: var(--background-color);
          color: var(--text-color);
          line-height: 1.65; 
          font-size: 16px;
        }
        
        .container {
          max-width: 1600px; 
          padding: 30px; 
          border-radius: var(--border-radius);
          box-shadow: var(--box-shadow);
          background: repeating-linear-gradient(#f1f8e9, #f9fbe7, #fce4ec);
        }
        
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          padding-bottom: 25px;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 25px;
        }
        .header-title { display: flex; align-items: center; gap: 15px; }
        .header h1 { margin: 0; font-size: 1.85em; font-weight: 600; color: var(--primary-color); }
        #report-logo { height: 40px; width: 40px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);}
        .run-info { font-size: 0.9em; text-align: right; color: var(--text-color-secondary); line-height:1.5;}
        .run-info strong { color: var(--text-color); }
        
        .tabs { display: flex; border-bottom: 2px solid var(--border-color); margin-bottom: 30px; overflow-x: auto; }
        .tab-button {
          padding: 15px 25px; background: none; border: none; border-bottom: 3px solid transparent;
          cursor: pointer; font-size: 1.1em; font-weight: 600; color: black;
          transition: color 0.2s ease, border-color 0.2s ease; white-space: nowrap;
        }
        .tab-button:hover { color: var(--accent-color); }
        .tab-button.active { color: var(--primary-color); border-bottom-color: var(--primary-color); }
        .tab-content { display: none; animation: fadeIn 0.4s ease-out; }
        .tab-content.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); 
          gap: 22px; margin-bottom: 35px;
        }
        .summary-card {
          background-color: var(--card-background-color); border: 1px solid var(--border-color);
          border-radius: var(--border-radius); padding: 22px; text-align: center;
          box-shadow: var(--box-shadow-light); transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .summary-card:hover { transform: translateY(-5px); box-shadow: var(--box-shadow); }
        .summary-card h3 { margin: 0 0 10px; font-size: 1.05em; font-weight: 500; color: var(--text-color-secondary); }
        .summary-card .value { font-size: 2.4em; font-weight: 600; margin-bottom: 8px; }
        .summary-card .trend-percentage { font-size: 1em; color: var(--dark-gray-color); }
        .status-passed .value, .stat-passed svg { color: var(--success-color); }
        .status-failed .value, .stat-failed svg { color: var(--danger-color); }
        .status-skipped .value, .stat-skipped svg { color: var(--warning-color); }
        
        .dashboard-bottom-row {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); 
            gap: 28px; align-items: stretch; 
        }
        .pie-chart-wrapper, .suites-widget, .trend-chart {
            background-color: var(--card-background-color); padding: 28px; 
            border-radius: var(--border-radius); box-shadow: var(--box-shadow-light);
            display: flex; flex-direction: column; 
        }

        .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3 { 
            text-align: center; margin-top: 0; margin-bottom: 25px; 
            font-size: 1.25em; font-weight: 600; color: var(--text-color);
        }
         .trend-chart-container, .pie-chart-wrapper div[id^="pieChart-"] { /* For Highcharts containers */
            flex-grow: 1;
            min-height: 250px; /* Ensure charts have some min height */
        }
        
        .chart-tooltip { /* This class was for D3, Highcharts has its own tooltip styling via JS/SVG */
          /* Basic styling for Highcharts HTML tooltips can be done via .highcharts-tooltip span */
        }
        .status-badge-small-tooltip { padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-weight: 600; color: white; text-transform: uppercase; }
        .status-badge-small-tooltip.status-passed { background-color: var(--success-color); }
        .status-badge-small-tooltip.status-failed { background-color: var(--danger-color); }
        .status-badge-small-tooltip.status-skipped { background-color: var(--warning-color); }
        .status-badge-small-tooltip.status-unknown { background-color: var(--dark-gray-color); }
        
        .suites-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .summary-badge { background-color: var(--light-gray-color); color: var(--text-color-secondary); padding: 7px 14px; border-radius: 16px; font-size: 0.9em; }
        .suites-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }
        .suite-card {
          border: 1px solid var(--border-color); border-left-width: 5px;
          border-radius: calc(var(--border-radius) / 1.5); padding: 20px;
          background-color: var(--card-background-color); transition: box-shadow 0.2s ease, border-left-color 0.2s ease;
        }
        .suite-card:hover { box-shadow: var(--box-shadow); }
        .suite-card.status-passed { border-left-color: var(--success-color); }
        .suite-card.status-failed { border-left-color: var(--danger-color); }
        .suite-card.status-skipped { border-left-color: var(--warning-color); }
        .suite-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
        .suite-name { font-weight: 600; font-size: 1.05em; color: var(--text-color); margin-right: 10px; word-break: break-word;}
        .browser-tag { font-size: 0.8em; background-color: var(--medium-gray-color); color: var(--text-color-secondary); padding: 3px 8px; border-radius: 4px; white-space: nowrap;}
        .suite-card-body .test-count { font-size: 0.95em; color: var(--text-color-secondary); display: block; margin-bottom: 10px; }
        .suite-stats { display: flex; gap: 14px; font-size: 0.95em; align-items: center; }
        .suite-stats span { display: flex; align-items: center; gap: 6px; }
        .suite-stats svg { vertical-align: middle; font-size: 1.15em; }

        .filters {
          display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 28px;
          padding: 20px; background-color: var(--light-gray-color); border-radius: var(--border-radius);
          box-shadow: var(--box-shadow-inset); border-color: black; border-style: groove;
        }
        .filters input, .filters select, .filters button {
          padding: 11px 15px; border: 1px solid var(--border-color);
          border-radius: 6px; font-size: 1em;
        }
        .filters input { flex-grow: 1; min-width: 240px;}
        .filters select {min-width: 180px;}
        .filters button { background-color: var(--primary-color); color: white; cursor: pointer; transition: background-color 0.2s ease, box-shadow 0.2s ease; border: none; }
        .filters button:hover { background-color: var(--accent-color); box-shadow: 0 2px 5px rgba(0,0,0,0.15);}

        .test-case {
          margin-bottom: 15px; border: 1px solid var(--border-color);
          border-radius: var(--border-radius); background-color: var(--card-background-color);
          box-shadow: var(--box-shadow-light); overflow: hidden; 
        }
        .test-case-header {
          padding: 10px 15px; background-color: #fff; cursor: pointer;
          display: flex; justify-content: space-between; align-items: center;
          border-bottom: 1px solid transparent; 
          transition: background-color 0.2s ease;
        }
        .test-case-header:hover { background-color: #f4f6f8; } 
        .test-case-header[aria-expanded="true"] { border-bottom-color: var(--border-color); background-color: #f9fafb; }
        
        .test-case-summary { display: flex; align-items: center; gap: 14px; flex-grow: 1; flex-wrap: wrap;}
        .test-case-title { font-weight: 600; color: var(--text-color); font-size: 1em; }
        .test-case-browser { font-size: 0.9em; color: var(--text-color-secondary); }
        .test-case-meta { display: flex; align-items: center; gap: 12px; font-size: 0.9em; color: var(--text-color-secondary); flex-shrink: 0; }
        .test-duration { background-color: var(--light-gray-color); padding: 4px 10px; border-radius: 12px; font-size: 0.9em;}
        
        .status-badge {
          padding: 5px; border-radius: 6px; font-size: 0.8em; font-weight: 600; color: white; text-transform: uppercase;
          min-width: 70px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .status-badge.status-passed { background-color: var(--success-color); }
        .status-badge.status-failed { background-color: var(--danger-color); }
        .status-badge.status-skipped { background-color: var(--warning-color); }
        .status-badge.status-unknown { background-color: var(--dark-gray-color); }
        
        .tag { display: inline-block; background: linear-gradient( #fff, #333, #000); color: #fff; padding: 3px 10px; border-radius: 12px; font-size: 0.85em; margin-right: 6px; font-weight: 400; }
        
        .test-case-content { display: none; padding: 20px; border-top: 1px solid var(--border-color); background-color: #fcfdff; }
        .test-case-content h4 { margin-top: 22px; margin-bottom: 14px; font-size: 1.15em; color: var(--primary-color); }
        .test-case-content p { margin-bottom: 10px; font-size: 1em; }
        .test-error-summary { margin-bottom: 20px; padding: 14px; background-color: rgba(244,67,54,0.05); border: 1px solid rgba(244,67,54,0.2); border-left: 4px solid var(--danger-color); border-radius: 4px; }
        .test-error-summary h4 { color: var(--danger-color); margin-top:0;}
        .test-error-summary pre { white-space: pre-wrap; word-break: break-all; color: var(--danger-color); font-size: 0.95em;}

        .steps-list { margin: 18px 0; }
        .step-item { margin-bottom: 8px; padding-left: calc(var(--depth, 0) * 28px); } 
        .step-header {
          display: flex; align-items: center; cursor: pointer;
          padding: 10px 14px; border-radius: 6px; background-color: #fff;
          border: 1px solid var(--light-gray-color); 
          transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .step-header:hover { background-color: #f0f2f5; border-color: var(--medium-gray-color); box-shadow: var(--box-shadow-inset); }
        .step-icon { margin-right: 12px; width: 20px; text-align: center; font-size: 1.1em; }
        .step-title { flex: 1; font-size: 1em; }
        .step-duration { color: var(--dark-gray-color); font-size: 0.9em; }
        .step-details { display: none; padding: 14px; margin-top: 8px; background: #fdfdfd; border-radius: 6px; font-size: 0.95em; border: 1px solid var(--light-gray-color); }
        .step-info { margin-bottom: 8px; }
        .step-error { color: var(--danger-color); margin-top: 12px; padding: 14px; background: rgba(244,67,54,0.05); border-radius: 4px; font-size: 0.95em; border-left: 3px solid var(--danger-color); }
        .step-error pre.stack-trace { margin-top: 10px; padding: 12px; background-color: rgba(0,0,0,0.03); border-radius: 4px; font-size:0.9em; max-height: 280px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
        .step-hook { background-color: rgba(33,150,243,0.04); border-left: 3px solid var(--info-color) !important; } 
        .step-hook .step-title { font-style: italic; color: var(--info-color)}
        .nested-steps { margin-top: 12px; }

        .attachments-section { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--light-gray-color); }
        .attachments-section h4 { margin-top: 0; margin-bottom: 20px; font-size: 1.1em; color: var(--text-color); }
        .attachments-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 22px; }
        .attachment-item {
          border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: #fff;
          box-shadow: var(--box-shadow-light); overflow: hidden; display: flex; flex-direction: column;
          transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
        }
        .attachment-item:hover { transform: translateY(-4px); box-shadow: var(--box-shadow); }
        .attachment-item img {
          width: 100%; height: 180px; object-fit: cover; display: block;
          border-bottom: 1px solid var(--border-color); transition: opacity 0.3s ease;
        }
        .attachment-item a:hover img { opacity: 0.85; }
        .attachment-caption {
          padding: 12px 15px; font-size: 0.9em; text-align: center;
          color: var(--text-color-secondary); word-break: break-word; background-color: var(--light-gray-color);
        }
        .video-item a, .trace-item a { display: block; margin-bottom: 8px; color: var(--primary-color); text-decoration: none; font-weight: 500; }
        .video-item a:hover, .trace-item a:hover { text-decoration: underline; }
        .code-section pre { background-color: #2d2d2d; color: #f0f0f0; padding: 20px; border-radius: 6px; overflow-x: auto; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 0.95em; line-height:1.6;}

        .trend-charts-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 28px; margin-bottom: 35px; }
        /* Removed D3 specific .chart-axis, .main-chart-title, .chart-line.* rules */
        /* Highcharts styles its elements with classes like .highcharts-axis, .highcharts-title etc. */
        
        .test-history-container h2.tab-main-title { font-size: 1.6em; margin-bottom: 18px; color: var(--primary-color); border-bottom: 1px solid var(--border-color); padding-bottom: 12px;}
        .test-history-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 22px; margin-top: 22px; }
        .test-history-card {
            background: var(--card-background-color); border: 1px solid var(--border-color); border-radius: var(--border-radius);
            padding: 22px; box-shadow: var(--box-shadow-light); display: flex; flex-direction: column;
        }
        .test-history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--light-gray-color); }
        .test-history-header h3 { margin: 0; font-size: 1.15em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .test-history-header p { font-weight: 500 }
        .test-history-trend { margin-bottom: 20px; min-height: 110px; }
        .test-history-trend div[id^="testHistoryChart-"] { /* Highcharts container for history */
            display: block; margin: 0 auto; max-width:100%; height: 100px; width: 320px; /* Match JS config */
        }
        /* .test-history-trend .small-axis text {font-size: 11px;} Removed D3 specific */
        .test-history-details-collapsible summary { cursor: pointer; font-size: 1em; color: var(--primary-color); margin-bottom: 10px; font-weight:500; }
        .test-history-details-collapsible summary:hover {text-decoration: underline;}
        .test-history-details table { width: 100%; border-collapse: collapse; font-size: 0.95em; }
        .test-history-details th, .test-history-details td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--light-gray-color); }
        .test-history-details th { background-color: var(--light-gray-color); font-weight: 600; }
        .status-badge-small { 
            padding: 3px 7px; border-radius: 4px; font-size: 0.8em; font-weight: 600; 
            color: white; text-transform: uppercase; display: inline-block;
        }
        .status-badge-small.status-passed { background-color: var(--success-color); }
        .status-badge-small.status-failed { background-color: var(--danger-color); }
        .status-badge-small.status-skipped { background-color: var(--warning-color); }
        .status-badge-small.status-unknown { background-color: var(--dark-gray-color); }

        .no-data, .no-tests, .no-steps, .no-data-chart { 
          padding: 28px; text-align: center; color: var(--dark-gray-color); font-style: italic; font-size:1.1em;
          background-color: var(--light-gray-color); border-radius: var(--border-radius); margin: 18px 0;
          border: 1px dashed var(--medium-gray-color);
        }
        .no-data-chart {font-size: 0.95em; padding: 18px;}
        
        #test-ai iframe { border: 1px solid var(--border-color); width: 100%; height: 85vh; border-radius: var(--border-radius); box-shadow: var(--box-shadow-light); }
        #test-ai p {margin-bottom: 18px; font-size: 1em; color: var(--text-color-secondary);}
        pre .stdout-log { background-color: #2d2d2d; color: wheat; padding: 1.25em; border-radius: 0.85em; line-height: 1.2; }
        pre .stderr-log { background-color: #2d2d2d; color: indianred; padding: 1.25em; border-radius: 0.85em; line-height: 1.2; }
        
        .trace-preview {
  padding: 1rem;
  text-align: center;
  background: #f5f5f5;
  border-bottom: 1px solid #e1e1e1;
}

.trace-icon {
  font-size: 2rem;
  display: block;
  margin-bottom: 0.5rem;
}

.trace-name {
  word-break: break-word;
  font-size: 0.9rem;
}

.trace-actions {
  display: flex;
  gap: 0.5rem;
}

.trace-actions a {
  flex: 1;
  text-align: center;
  padding: 0.25rem 0.5rem;
  font-size: 0.85rem;
  border-radius: 4px;
  text-decoration: none;
}

.view-trace {
  background: #3182ce;
  color: white;
}

.view-trace:hover {
  background: #2c5282;
}

.download-trace {
  background: #e2e8f0;
  color: #2d3748;
}

.download-trace:hover {
  background: #cbd5e0;
}
        @media (max-width: 1200px) {
            .trend-charts-row { grid-template-columns: 1fr; } 
        }
        @media (max-width: 992px) { 
            .dashboard-bottom-row { grid-template-columns: 1fr; }
            .pie-chart-wrapper div[id^="pieChart-"] { max-width: 350px; margin: 0 auto; }
            .filters input { min-width: 180px; }
            .filters select { min-width: 150px; }
        }
        @media (max-width: 768px) { 
          body { font-size: 15px; }
          .container { margin: 10px; padding: 20px; } 
          .header { flex-direction: column; align-items: flex-start; gap: 15px; }
          .header h1 { font-size: 1.6em; }
          .run-info { text-align: left; font-size:0.9em; }
          .tabs { margin-bottom: 25px;}
          .tab-button { padding: 12px 20px; font-size: 1.05em;}
          .dashboard-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px;}
          .summary-card .value {font-size: 2em;}
          .summary-card h3 {font-size: 0.95em;}
          .filters { flex-direction: column; padding: 18px; gap: 12px;}
          .filters input, .filters select, .filters button {width: 100%; box-sizing: border-box;} 
          .test-case-header { flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px; }
          .test-case-summary {gap: 10px;}
          .test-case-title {font-size: 1.05em;}
          .test-case-meta { flex-direction: row; flex-wrap: wrap; gap: 8px; margin-top: 8px;}
          .attachments-grid {grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 18px;}
          .test-history-grid {grid-template-columns: 1fr;}
          .pie-chart-wrapper {min-height: auto;} 
        }
        @media (max-width: 480px) { 
            body {font-size: 14px;}
            .container {padding: 15px;}
            .header h1 {font-size: 1.4em;}
            #report-logo { height: 35px; width: 35px; }
            .tab-button {padding: 10px 15px; font-size: 1em;}
            .summary-card .value {font-size: 1.8em;}
            .attachments-grid {grid-template-columns: 1fr;}
            .step-item {padding-left: calc(var(--depth, 0) * 18px);} 
            .test-case-content, .step-details {padding: 15px;}
            .trend-charts-row {gap: 20px;}
            .trend-chart {padding: 20px;}
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-title">
                <img id="report-logo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJMNCA3bDggNSA4LTUtOC01eiIgZmlsbD0iIzNmNTFiNSIvPjxwYXRoIGQ9Ik0xMiA2TDQgMTFsOCA1IDgtNS04LTV6IiBmaWxsPSIjNDI4NWY0Ii8+PHBhdGggZD0iTTEyIDEwbC04IDUgOCA1IDgtNS04LTV6IiBmaWxsPSIjM2Q1NWI0Ii8+PC9zdmc+" alt="Report Logo">
                <h1>Playwright Pulse Report</h1>
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
            <button class="tab-button" data-tab="test-history">Test History</button>
            <button class="tab-button" data-tab="test-ai">AI Analysis</button>
        </div>
        
        <div id="dashboard" class="tab-content active">
            <div class="dashboard-grid">
                <div class="summary-card">
                    <h3>Total Tests</h3><div class="value">${
                      runSummary.totalTests
                    }</div>
                </div>
                <div class="summary-card status-passed">
                    <h3>Passed</h3><div class="value">${runSummary.passed}</div>
                    <div class="trend-percentage">${passPercentage}%</div>
                </div>
                <div class="summary-card status-failed">
                    <h3>Failed</h3><div class="value">${runSummary.failed}</div>
                    <div class="trend-percentage">${failPercentage}%</div>
                </div>
                <div class="summary-card status-skipped">
                    <h3>Skipped</h3><div class="value">${
                      runSummary.skipped || 0
                    }</div>
                    <div class="trend-percentage">${skipPercentage}%</div>
                </div>
                <div class="summary-card">
                    <h3>Avg. Test Time</h3><div class="value">${avgTestDuration}</div>
                </div>
                 <div class="summary-card">
                    <h3>Run Duration</h3><div class="value">${formatDuration(
                      runSummary.duration
                    )}</div>
                </div>
            </div>
            <div class="dashboard-bottom-row">
                ${generatePieChart(
                  // Changed from generatePieChartD3
                  [
                    { label: "Passed", value: runSummary.passed },
                    { label: "Failed", value: runSummary.failed },
                    { label: "Skipped", value: runSummary.skipped || 0 },
                  ],
                  400, // Default width
                  390 // Default height (adjusted for legend + title)
                )} 
                ${generateSuitesWidget(suitesData)}
            </div>
        </div>
        
        <div id="test-runs" class="tab-content">
            <div class="filters">
                <input type="text" id="filter-name" placeholder="Filter by test name/path..." style="border-color: black; border-style: outset;">
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
                        (results || []).map((test) => test.browser || "unknown")
                      )
                    )
                      .map(
                        (browser) =>
                          `<option value="${sanitizeHTML(
                            browser
                          )}">${sanitizeHTML(browser)}</option>`
                      )
                      .join("")}
                </select>
                <button id="expand-all-tests">Expand All</button>
                <button id="collapse-all-tests">Collapse All</button>
            </div>
            <div class="test-cases-list">
                ${generateTestCasesHTML()}
            </div>
        </div>

        <div id="test-history" class="tab-content">
          <h2 class="tab-main-title">Execution Trends</h2>
          <div class="trend-charts-row">
            <div class="trend-chart">
              <h3 class="chart-title-header">Test Volume & Outcome Trends</h3>
              ${
                trendData && trendData.overall && trendData.overall.length > 0
                  ? generateTestTrendsChart(trendData)
                  : '<div class="no-data">Overall trend data not available for test counts.</div>'
              }
            </div>
            <div class="trend-chart">
              <h3 class="chart-title-header">Execution Duration Trends</h3>
              ${
                trendData && trendData.overall && trendData.overall.length > 0
                  ? generateDurationTrendChart(trendData)
                  : '<div class="no-data">Overall trend data not available for durations.</div>'
              }
            </div>
          </div>
          <h2 class="tab-main-title">Individual Test History</h2>
          ${
            trendData &&
            trendData.testRuns &&
            Object.keys(trendData.testRuns).length > 0
              ? generateTestHistoryContent(trendData)
              : '<div class="no-data">Individual test history data not available.</div>'
          }
        </div>

        <div id="test-ai" class="tab-content">
             <iframe 
            src="https://ai-test-analyser.netlify.app/" 
            width="100%" 
            height="100%"
            frameborder="0"
            allowfullscreen 
            style="border: none; height: 100vh;">
          </iframe>
        </div>
        <footer style="
  padding: 0.5rem;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
  text-align: center;
  font-family: 'Segoe UI', system-ui, sans-serif;
">
  <div style="
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #333;
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 0.5px;
  ">
    <img width="48" height="48" src="https://img.icons8.com/emoji/48/index-pointing-at-the-viewer-light-skin-tone-emoji.png" alt="index-pointing-at-the-viewer-light-skin-tone-emoji"/>
    <span>Created by</span>
    <a href="https://github.com/Arghajit47"
       target="_blank"
       rel="noopener noreferrer"
       style="
         color: #7737BF;
         font-weight: 700;
         font-style: italic;
         text-decoration: none;
         transition: all 0.2s ease;
       "
       onmouseover="this.style.color='#BF5C37'"
       onmouseout="this.style.color='#7737BF'">
      Arghajit Singha
    </a>
  </div>
  <div style="
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: #666;
  ">
    Crafted with precision
  </div>
</footer>
    </div>
    
    
    <script>
    // Ensure formatDuration is globally available for Highcharts formatters
    // It's defined in the Node script, but needs to be available client-side.
    // The original script structure implies it might be defined elsewhere or this script itself is embedded.
    // For safety, re-define it here or ensure it's globally accessible.
    if (typeof formatDuration === 'undefined') {
        function formatDuration(ms) {
            if (ms === undefined || ms === null || ms < 0) return "0.0s";
            return (ms / 1000).toFixed(1) + "s";
        }
    }

    function initializeReportInteractivity() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                button.classList.add('active');
                const tabId = button.getAttribute('data-tab');
                const activeContent = document.getElementById(tabId);
                if (activeContent) activeContent.classList.add('active');
            });
        });

        const nameFilter = document.getElementById('filter-name');
        const statusFilter = document.getElementById('filter-status');
        const browserFilter = document.getElementById('filter-browser');

        function filterTestCases() {
            const nameValue = nameFilter ? nameFilter.value.toLowerCase() : "";
            const statusValue = statusFilter ? statusFilter.value : "";
            const browserValue = browserFilter ? browserFilter.value : "";
            
            document.querySelectorAll('#test-runs .test-case').forEach(testCaseElement => {
                const titleElement = testCaseElement.querySelector('.test-case-title');
                const fullTestName = titleElement ? titleElement.getAttribute('title').toLowerCase() : "";
                const status = testCaseElement.getAttribute('data-status');
                const browser = testCaseElement.getAttribute('data-browser');
                
                const nameMatch = fullTestName.includes(nameValue);
                const statusMatch = !statusValue || status === statusValue;
                const browserMatch = !browserValue || browser === browserValue;
                
                testCaseElement.style.display = (nameMatch && statusMatch && browserMatch) ? '' : 'none';
            });
        }
        if(nameFilter) nameFilter.addEventListener('input', filterTestCases);
        if(statusFilter) statusFilter.addEventListener('change', filterTestCases);
        if(browserFilter) browserFilter.addEventListener('change', filterTestCases);

        const historyNameFilter = document.getElementById('history-filter-name');
        const historyStatusFilter = document.getElementById('history-filter-status');

        function filterTestHistoryCards() {
            const nameValue = historyNameFilter ? historyNameFilter.value.toLowerCase() : "";
            const statusValue = historyStatusFilter ? historyStatusFilter.value : "";

            document.querySelectorAll('.test-history-card').forEach(card => {
                const testTitle = card.getAttribute('data-test-name').toLowerCase(); 
                const latestStatus = card.getAttribute('data-latest-status');

                const nameMatch = testTitle.includes(nameValue);
                const statusMatch = !statusValue || latestStatus === statusValue;

                card.style.display = (nameMatch && statusMatch) ? '' : 'none';
            });
        }
        if(historyNameFilter) historyNameFilter.addEventListener('input', filterTestHistoryCards);
        if(historyStatusFilter) historyStatusFilter.addEventListener('change', filterTestHistoryCards);

        function toggleElementDetails(headerElement, contentSelector) {
            let contentElement;
            if (headerElement.classList.contains('test-case-header')) {
                contentElement = headerElement.parentElement.querySelector('.test-case-content');
            } else if (headerElement.classList.contains('step-header')) {
                contentElement = headerElement.nextElementSibling;
                if (!contentElement || !contentElement.matches(contentSelector || '.step-details')) {
                     contentElement = null;
                }
            }

            if (contentElement) {
                 const isExpanded = contentElement.style.display === 'block';
                 contentElement.style.display = isExpanded ? 'none' : 'block';
                 headerElement.setAttribute('aria-expanded', String(!isExpanded));
            }
        }
        
        document.querySelectorAll('#test-runs .test-case-header').forEach(header => {
            header.addEventListener('click', () => toggleElementDetails(header)); 
        });
        document.querySelectorAll('#test-runs .step-header').forEach(header => {
            header.addEventListener('click', () => toggleElementDetails(header, '.step-details'));
        });

        const expandAllBtn = document.getElementById('expand-all-tests');
        const collapseAllBtn = document.getElementById('collapse-all-tests');

        function setAllTestRunDetailsVisibility(displayMode, ariaState) {
            document.querySelectorAll('#test-runs .test-case-content').forEach(el => el.style.display = displayMode);
            document.querySelectorAll('#test-runs .step-details').forEach(el => el.style.display = displayMode);
            document.querySelectorAll('#test-runs .test-case-header[aria-expanded]').forEach(el => el.setAttribute('aria-expanded', ariaState));
            document.querySelectorAll('#test-runs .step-header[aria-expanded]').forEach(el => el.setAttribute('aria-expanded', ariaState));
        }
        
        if (expandAllBtn) expandAllBtn.addEventListener('click', () => setAllTestRunDetailsVisibility('block', 'true'));
        if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => setAllTestRunDetailsVisibility('none', 'false'));
    }
    document.addEventListener('DOMContentLoaded', initializeReportInteractivity);
    </script>
</body>
</html>
  `;
}

async function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue(`Executing script: ${scriptPath}...`));
    const process = fork(scriptPath, [], {
      stdio: "inherit",
    });

    process.on("error", (err) => {
      console.error(chalk.red(`Failed to start script: ${scriptPath}`), err);
      reject(err);
    });

    process.on("exit", (code) => {
      if (code === 0) {
        console.log(chalk.green(`Script ${scriptPath} finished successfully.`));
        resolve();
      } else {
        const errorMessage = `Script ${scriptPath} exited with code ${code}.`;
        console.error(chalk.red(errorMessage));
        reject(new Error(errorMessage));
      }
    });
  });
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const trendExcelScriptPath = path.resolve(
    __dirname,
    "generate-trend-excel.mjs"
  );
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const reportJsonPath = path.resolve(outputDir, DEFAULT_JSON_FILE);
  const reportHtmlPath = path.resolve(outputDir, DEFAULT_HTML_FILE);
  const trendDataPath = path.resolve(outputDir, "trend.xls");

  console.log(chalk.blue(`Starting static HTML report generation...`));
  console.log(chalk.blue(`Output directory set to: ${outputDir}`));

  try {
    await runScript(trendExcelScriptPath);
    console.log(chalk.green("Excel trend generation completed."));
  } catch (error) {
    console.error(
      chalk.red(
        "Failed to generate/update Excel trend data. HTML report might use stale or no trend data."
      ),
      error
    );
  }

  let reportData;
  try {
    const jsonData = await fs.readFile(reportJsonPath, "utf-8");
    reportData = JSON.parse(jsonData);
    if (!reportData || typeof reportData !== "object" || !reportData.results) {
      throw new Error(
        "Invalid report JSON structure. 'results' field is missing or invalid."
      );
    }
    if (!Array.isArray(reportData.results)) {
      reportData.results = [];
      console.warn(
        chalk.yellow(
          "Warning: 'results' field in JSON was not an array. Treated as empty."
        )
      );
    }
  } catch (error) {
    console.error(
      chalk.red(`Error reading or parsing main report JSON: ${error.message}`)
    );
    process.exit(1);
  }

  let trendData = { overall: [], testRuns: {} };
  try {
    await fs.access(trendDataPath);
    const excelBuffer = await fs.readFile(trendDataPath);
    const workbook = XLSX.read(excelBuffer, { type: "buffer" });

    if (workbook.Sheets["overall"]) {
      trendData.overall = XLSX.utils
        .sheet_to_json(workbook.Sheets["overall"])
        .map((row) => {
          let timestamp;
          if (typeof row.TIMESTAMP === "number") {
            if (XLSX.SSF && typeof XLSX.SSF.parse_date_code === "function") {
              try {
                timestamp = XLSX.SSF.parse_date_code(row.TIMESTAMP);
              } catch (e) {
                console.warn(
                  chalk.yellow(
                    ` - Could not parse Excel date number ${row.TIMESTAMP} for RUN_ID ${row.RUN_ID}. Using current time. Error: ${e.message}`
                  )
                );
                timestamp = new Date(Date.now());
              }
            } else {
              console.warn(
                chalk.yellow(
                  ` - XLSX.SSF.parse_date_code is unavailable for RUN_ID ${row.RUN_ID}. Numeric TIMESTAMP ${row.TIMESTAMP} treated as direct JS timestamp or fallback.`
                )
              );
              timestamp = new Date(
                row.TIMESTAMP > 0 && row.TIMESTAMP < 3000000000000
                  ? row.TIMESTAMP
                  : Date.now()
              );
            }
          } else if (row.TIMESTAMP) {
            timestamp = new Date(row.TIMESTAMP);
          } else {
            timestamp = new Date(Date.now());
          }

          return {
            runId: Number(row.RUN_ID) || 0,
            duration: Number(row.DURATION) || 0,
            timestamp: timestamp,
            totalTests: Number(row.TOTAL_TESTS) || 0,
            passed: Number(row.PASSED) || 0,
            failed: Number(row.FAILED) || 0,
            skipped: Number(row.SKIPPED) || 0,
          };
        })
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    workbook.SheetNames.forEach((sheetName) => {
      if (sheetName.toLowerCase().startsWith("test run ")) {
        trendData.testRuns[sheetName] = XLSX.utils
          .sheet_to_json(workbook.Sheets[sheetName])
          .map((test) => {
            let timestamp;
            if (typeof test.TIMESTAMP === "number") {
              if (XLSX.SSF && typeof XLSX.SSF.parse_date_code === "function") {
                try {
                  timestamp = XLSX.SSF.parse_date_code(test.TIMESTAMP);
                } catch (e) {
                  timestamp = new Date(Date.now());
                }
              } else {
                timestamp = new Date(
                  test.TIMESTAMP > 0 && test.TIMESTAMP < 3000000000000
                    ? test.TIMESTAMP
                    : Date.now()
                );
              }
            } else if (test.TIMESTAMP) {
              timestamp = new Date(test.TIMESTAMP);
            } else {
              timestamp = new Date(Date.now());
            }
            return {
              testName: String(test.TEST_NAME || "Unknown Test"),
              duration: Number(test.DURATION) || 0,
              status: String(test.STATUS || "unknown").toLowerCase(),
              timestamp: timestamp,
            };
          });
      }
    });
    if (
      trendData.overall.length > 0 ||
      Object.keys(trendData.testRuns).length > 0
    ) {
      console.log(
        chalk.green(`Trend data loaded successfully from: ${trendDataPath}`)
      );
    } else {
      console.warn(
        chalk.yellow(
          `Trend data file found at ${trendDataPath}, but no data was loaded from 'overall' or 'test run' sheets.`
        )
      );
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(
        chalk.yellow(
          `Warning: Trend data file not found at ${trendDataPath}. Report will be generated without historical trends.`
        )
      );
    } else {
      console.warn(
        chalk.yellow(
          `Warning: Could not read or process trend data from ${trendDataPath}. Report will be generated without historical trends. Error: ${error.message}`
        )
      );
    }
  }

  try {
    const htmlContent = generateHTML(reportData, trendData);
    await fs.writeFile(reportHtmlPath, htmlContent, "utf-8");
    console.log(
      chalk.green.bold(
        `🎉 Enhanced report generated successfully at: ${reportHtmlPath}`
      )
    );
    console.log(chalk.gray(`(You can open this file in your browser)`));
  } catch (error) {
    console.error(chalk.red(`Error generating HTML report: ${error.message}`));
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
