#!/usr/bin/env node

import * as fs from "fs/promises";
import { readFileSync, existsSync as fsExistsSync } from "fs";
import path from "path";
import { fork } from "child_process";
import { fileURLToPath } from "url";
import { getOutputDir } from "./config-reader.mjs";

/**
 * Dynamically imports the 'chalk' library for terminal string styling.
 * This is necessary because chalk is an ESM-only module.
 * If the import fails, a fallback object with plain console log functions is used.
 */
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

/**
 * @constant {string} DEFAULT_OUTPUT_DIR
 * The default directory where the report will be generated.
 */
const DEFAULT_OUTPUT_DIR = "pulse-report";

/**
 * @constant {string} DEFAULT_JSON_FILE
 * The default name for the JSON file containing the test data.
 */
const DEFAULT_JSON_FILE = "playwright-pulse-report.json";

/**
 * @constant {string} DEFAULT_HTML_FILE
 * The default name for the generated HTML report file.
 */
const DEFAULT_HTML_FILE = "playwright-pulse-static-report.html";

// Helper functions
/**
 * Converts a string with ANSI escape codes to an HTML string with inline styles.
 * @param {string} text The text with ANSI codes.
 * @returns {string} The converted HTML string.
 */
export function ansiToHtml(text) {
  if (!text) {
    return "";
  }
  const codes = {
    0: "color:inherit;font-weight:normal;font-style:normal;text-decoration:none;opacity:1;background-color:inherit;",
    1: "font-weight:bold",
    2: "opacity:0.6",
    3: "font-style:italic",
    4: "text-decoration:underline",
    30: "color:#000", // black
    31: "color:#d00", // red
    32: "color:#0a0", // green
    33: "color:#aa0", // yellow
    34: "color:#00d", // blue
    35: "color:#a0a", // magenta
    36: "color:#0aa", // cyan
    37: "color:#aaa", // light grey
    39: "color:inherit", // default foreground color
    40: "background-color:#000", // black background
    41: "background-color:#d00", // red background
    42: "background-color:#0a0", // green background
    43: "background-color:#aa0", // yellow background
    44: "background-color:#00d", // blue background
    45: "background-color:#a0a", // magenta background
    46: "background-color:#0aa", // cyan background
    47: "background-color:#aaa", // light grey background
    49: "background-color:inherit", // default background color
    90: "color:#555", // dark grey
    91: "color:#f55", // light red
    92: "color:#5f5", // light green
    93: "color:#ff5", // light yellow
    94: "color:#55f", // light blue
    95: "color:#f5f", // light magenta
    96: "color:#5ff", // light cyan
    97: "color:#fff", // white
  };

  let currentStylesArray = [];
  let html = "";
  let openSpan = false;

  const applyStyles = () => {
    if (openSpan) {
      html += "</span>";
      openSpan = false;
    }
    if (currentStylesArray.length > 0) {
      const styleString = currentStylesArray.filter((s) => s).join(";");
      if (styleString) {
        html += `<span style="${styleString}">`;
        openSpan = true;
      }
    }
  };
  const resetAndApplyNewCodes = (newCodesStr) => {
    const newCodes = newCodesStr.split(";");
    if (newCodes.includes("0")) {
      currentStylesArray = [];
      if (codes["0"]) currentStylesArray.push(codes["0"]);
    }
    for (const code of newCodes) {
      if (code === "0") continue;
      if (codes[code]) {
        if (code === "39") {
          currentStylesArray = currentStylesArray.filter(
            (s) => !s.startsWith("color:"),
          );
          currentStylesArray.push("color:inherit");
        } else if (code === "49") {
          currentStylesArray = currentStylesArray.filter(
            (s) => !s.startsWith("background-color:"),
          );
          currentStylesArray.push("background-color:inherit");
        } else {
          currentStylesArray.push(codes[code]);
        }
      } else if (code.startsWith("38;2;") || code.startsWith("48;2;")) {
        const parts = code.split(";");
        const type = parts[0] === "38" ? "color" : "background-color";
        if (parts.length === 5) {
          currentStylesArray = currentStylesArray.filter(
            (s) => !s.startsWith(type + ":"),
          );
          currentStylesArray.push(
            `${type}:rgb(${parts[2]},${parts[3]},${parts[4]})`,
          );
        }
      }
    }
    applyStyles();
  };
  const segments = text.split(/(\x1b\[[0-9;]*m)/g);
  for (const segment of segments) {
    if (!segment) continue;
    if (segment.startsWith("\x1b[") && segment.endsWith("m")) {
      const command = segment.slice(2, -1);
      resetAndApplyNewCodes(command);
    } else {
      const escapedContent = segment
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      html += escapedContent;
    }
  }
  if (openSpan) {
    html += "</span>";
  }
  return html;
}
/**
 * Sanitizes an HTML string by replacing special characters with their corresponding HTML entities.
 * @param {string} str The HTML string to sanitize.
 * @returns {string} The sanitized HTML string.
 */
function sanitizeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(
    /[&<>"']/g,
    (match) =>
      ({ "&": "&", "<": "<", ">": ">", '"': '"', "'": "'" })[match] || match,
  );
}
/**
 * Capitalizes the first letter of a string and converts the rest to lowercase.
 * @param {string} str The string to capitalize.
 * @returns {string} The capitalized string.
 */
function capitalize(str) {
  if (!str) return "";
  return str[0].toUpperCase() + str.slice(1).toLowerCase();
}
/**
 * Formats a Playwright error object or message into an HTML string.
 * @param {Error|string} error The error object or message string.
 * @returns {string} The formatted HTML error string.
 */
function formatPlaywrightError(error) {
  const commandOutput = ansiToHtml(error || error.message);
  return convertPlaywrightErrorToHTML(commandOutput);
}
/**
 * Converts a string containing Playwright-style error formatting to HTML.
 * @param {string} str The error string.
 * @returns {string} The HTML-formatted error string.
 */
function convertPlaywrightErrorToHTML(str) {
  if (!str) return "";
  return str
    .replace(/^(\s+)/gm, (match) =>
      match.replace(/ /g, " ").replace(/\t/g, "  "),
    )
    .replace(/<red>/g, '<span style="color: red;">')
    .replace(/<green>/g, '<span style="color: green;">')
    .replace(/<dim>/g, '<span style="opacity: 0.6;">')
    .replace(/<intensity>/g, '<span style="font-weight: bold;">')
    .replace(/<\/color>/g, "</span>")
    .replace(/<\/intensity>/g, "</span>")
    .replace(/\n/g, "<br>");
}
/**
 * Formats a duration in milliseconds into a human-readable string (e.g., '1h 2m 3s', '4.5s').
 * @param {number} ms The duration in milliseconds.
 * @param {object} [options={}] Formatting options.
 * @param {number} [options.precision=1] The number of decimal places for seconds.
 * @param {string} [options.invalidInputReturn="N/A"] The string to return for invalid input.
 * @param {string|null} [options.defaultForNullUndefinedNegative=null] The value for null, undefined, or negative inputs.
 * @returns {string} The formatted duration string.
 */
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

  if (
    totalRawSeconds < SECONDS_PER_MINUTE &&
    Math.ceil(totalRawSeconds) < SECONDS_PER_MINUTE
  ) {
    return `${totalRawSeconds.toFixed(validPrecision)}s`;
  } else {
    const totalMsRoundedUpToSecond =
      Math.ceil(numMs / MS_PER_SECOND) * MS_PER_SECOND;

    let remainingMs = totalMsRoundedUpToSecond;

    const h = Math.floor(remainingMs / (MS_PER_SECOND * SECONDS_PER_HOUR));
    remainingMs %= MS_PER_SECOND * SECONDS_PER_HOUR;

    const m = Math.floor(remainingMs / (MS_PER_SECOND * SECONDS_PER_MINUTE));
    remainingMs %= MS_PER_SECOND * SECONDS_PER_MINUTE;

    const s = Math.floor(remainingMs / MS_PER_SECOND);

    const parts = [];
    if (h > 0) {
      parts.push(`${h}h`);
    }
    if (h > 0 || m > 0 || numMs >= MS_PER_SECOND * SECONDS_PER_MINUTE) {
      parts.push(`${m}m`);
    }
    parts.push(`${s}s`);

    return parts.join(" ");
  }
}
/**
 * Generates HTML and JavaScript for a Highcharts line chart to display test result trends over multiple runs.
 * @param {object} trendData The trend data.
 * @param {Array<object>} trendData.overall An array of run objects with test statistics.
 * @returns {string} The HTML string for the test trends chart.
 */
function generateTestTrendsChart(trendData) {
  if (!trendData || !trendData.overall || trendData.overall.length === 0) {
    return '<div class="no-data">No overall trend data available for test counts.</div>';
  }

  const chartId = `testTrendsChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const renderFunctionName = `renderTestTrendsChart_${chartId.replace(
    /-/g,
    "_",
  )}`;
  const runs = trendData.overall;

  const series = [
    {
      name: "Total",
      data: runs.map((r) => r.totalTests),
      color: "var(--primary-color)",
      marker: { symbol: "circle" },
    },
    {
      name: "Passed",
      data: runs.map((r) => r.passed),
      color: "var(--success-color)",
      marker: { symbol: "circle" },
    },
    {
      name: "Failed",
      data: runs.map((r) => r.failed),
      color: "var(--danger-color)",
      marker: { symbol: "circle" },
    },
    {
      name: "Skipped",
      data: runs.map((r) => r.skipped || 0),
      color: "var(--warning-color)",
      marker: { symbol: "circle" },
    },
  ];
  const runsForTooltip = runs.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    duration: r.duration,
  }));

  const categoriesString = JSON.stringify(runs.map((run, i) => `Run ${i + 1}`));
  const seriesString = JSON.stringify(series);
  const runsForTooltipString = JSON.stringify(runsForTooltip);

  return `
      <div id="${chartId}" class="trend-chart-container lazy-load-chart" data-render-function-name="${renderFunctionName}">
          <div class="no-data">Loading Test Volume Trends...</div>
      </div>
      <script>
          window.${renderFunctionName} = function() {
              const chartContainer = document.getElementById('${chartId}');
              if (!chartContainer) { console.error("Chart container ${chartId} not found for lazy loading."); return; }
              if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                  try {
                      chartContainer.innerHTML = ''; // Clear placeholder
                      const chartOptions = {
                          chart: { type: "line", height: 350, backgroundColor: "transparent" },
                          title: { text: null },
                          xAxis: { categories: ${categoriesString}, crosshair: true, labels: { style: { color: 'var(--text-color-secondary)', fontSize: '12px' }}},
                          yAxis: { title: { text: "Test Count", style: { color: 'var(--text-color)'} }, min: 0, labels: { style: { color: 'var(--text-color-secondary)', fontSize: '12px' }}},
                          legend: { layout: "horizontal", align: "center", verticalAlign: "bottom", itemStyle: { fontSize: "12px", color: 'var(--text-color)' }},
                          plotOptions: { series: { marker: { radius: 4, states: { hover: { radius: 6 }}}, states: { hover: { halo: { size: 5, opacity: 0.1 }}}}, line: { lineWidth: 2.5 }},
                          tooltip: {
                              shared: true, useHTML: true, backgroundColor: 'rgba(10,10,10,0.92)', borderColor: 'rgba(10,10,10,0.92)', style: { color: '#f5f5f5' },
                              formatter: function () {
                                  const runsData = ${runsForTooltipString};
                                  const pointIndex = this.points[0].point.x;
                                  const run = runsData[pointIndex];
                                  let tooltip = '<strong>Run ' + (run.runId || pointIndex + 1) + '</strong><br>' + 'Date: ' + new Date(run.timestamp).toLocaleString() + '<br><br>';
                                  this.points.forEach(point => { tooltip += '<span style="color:' + point.color + '">●</span> ' + point.series.name + ': <b>' + point.y + '</b><br>'; });
                                  tooltip += '<br>Duration: ' + formatDuration(run.duration);
                                  return tooltip;
                              }
                          },
                          series: ${seriesString},
                          credits: { enabled: false }
                      };
                      Highcharts.chart('${chartId}', chartOptions);
                  } catch (e) {
                      console.error("Error rendering chart ${chartId} (lazy):", e);
                      chartContainer.innerHTML = '<div class="no-data">Error rendering test trends chart.</div>';
                  }
              } else {
                  chartContainer.innerHTML = '<div class="no-data">Charting library not available for test trends.</div>';
              }
          };
      </script>
  `;
}
const accentColorAltRGB = "255, 152, 0"; // Assuming var(--accent-color-alt) is Orange #FF9800
/**
 * Generates HTML and JavaScript for a Highcharts area chart to display test duration trends.
 * @param {object} trendData Data for duration trends.
 * @param {Array<object>} trendData.overall Array of objects, each representing a test run with a duration.
 * @returns {string} The HTML string for the duration trend chart.
 */
function generateDurationTrendChart(trendData) {
  if (!trendData || !trendData.overall || trendData.overall.length === 0) {
    return '<div class="no-data">No overall trend data available for durations.</div>';
  }
  const chartId = `durationTrendChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const renderFunctionName = `renderDurationTrendChart_${chartId.replace(
    /-/g,
    "_",
  )}`;
  const runs = trendData.overall;

  const chartDataString = JSON.stringify(runs.map((run) => run.duration));
  const categoriesString = JSON.stringify(runs.map((run, i) => `Run ${i + 1}`));
  const runsForTooltip = runs.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    duration: r.duration,
    totalTests: r.totalTests,
  }));
  const runsForTooltipString = JSON.stringify(runsForTooltip);

  const seriesStringForRender = `[{
      name: 'Duration',
      data: ${chartDataString},
      color: 'var(--accent-color-alt)',
      type: 'area',
      marker: { symbol: 'circle', enabled: true, radius: 4, fillColor: '#ffffff', lineColor: 'var(--accent-color-alt)', lineWidth: 2, states: { hover: { radius: 6, lineWidthPlus: 0 } } },
      fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(${accentColorAltRGB}, 0.4)'], [1, 'rgba(${accentColorAltRGB}, 0.05)']] },
      lineWidth: 2.5
  }]`;

  return `
      <div id="${chartId}" class="trend-chart-container lazy-load-chart" data-render-function-name="${renderFunctionName}">
          <div class="no-data">Loading Duration Trends...</div>
      </div>
      <script>
          window.${renderFunctionName} = function() {
              const chartContainer = document.getElementById('${chartId}');
              if (!chartContainer) { console.error("Chart container ${chartId} not found for lazy loading."); return; }
              if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                  try {
                      chartContainer.innerHTML = ''; // Clear placeholder
                      const chartOptions = {
                          chart: { type: 'area', height: 350, backgroundColor: 'transparent' },
                          title: { text: null },
                          xAxis: { categories: ${categoriesString}, crosshair: true, labels: { style: { color: 'var(--text-color-secondary)', fontSize: '12px' }}},
                          yAxis: {
                              title: { text: 'Duration', style: { color: 'var(--text-color)' } },
                              labels: { formatter: function() { return formatDuration(this.value); }, style: { color: 'var(--text-color-secondary)', fontSize: '12px' }},
                              min: 0
                          },
                          legend: { layout: 'horizontal', align: 'center', verticalAlign: 'bottom', itemStyle: { fontSize: '12px', color: 'var(--text-color)' }},
                          plotOptions: { area: { lineWidth: 2.5, states: { hover: { lineWidthPlus: 0 } }, threshold: null }},
                          tooltip: {
                              shared: true, useHTML: true, backgroundColor: 'rgba(10,10,10,0.92)', borderColor: 'rgba(10,10,10,0.92)', style: { color: '#f5f5f5' },
                              formatter: function () {
                                  const runsData = ${runsForTooltipString};
                                  const pointIndex = this.points[0].point.x;
                                  const run = runsData[pointIndex];
                                  let tooltip = '<strong>Run ' + (run.runId || pointIndex + 1) + '</strong><br>' + 'Date: ' + new Date(run.timestamp).toLocaleString() + '<br>';
                                  this.points.forEach(point => { tooltip += '<span style="color:' + point.series.color + '">●</span> ' + point.series.name + ': <b>' + formatDuration(point.y) + '</b><br>'; });
                                  tooltip += '<br>Tests: ' + run.totalTests;
                                  return tooltip;
                              }
                          },
                          series: ${seriesStringForRender}, // This is already a string representation of an array
                          credits: { enabled: false }
                      };
                      Highcharts.chart('${chartId}', chartOptions);
                  } catch (e) {
                      console.error("Error rendering chart ${chartId} (lazy):", e);
                      chartContainer.innerHTML = '<div class="no-data">Error rendering duration trend chart.</div>';
                  }
              } else {
                  chartContainer.innerHTML = '<div class="no-data">Charting library not available for duration trends.</div>';
              }
          };
      </script>
  `;
}
/**
 * Formats a date string or Date object into a more readable format (e.g., "MM/DD/YY HH:MM").
 * @param {string|Date} dateStrOrDate The date string or Date object to format.
 * @returns {string} The formatted date string, or "N/A" for invalid dates.
 */
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
/**
 * Generates a small area chart showing the duration history of a single test across multiple runs.
 * The status of each run is indicated by the color of the marker.
 * @param {Array<object>} history An array of run objects, each with status and duration.
 * @returns {string} The HTML string for the test history chart.
 */
function generateTestHistoryChart(history) {
  if (!history || history.length === 0)
    return '<div class="no-data-chart">No data for chart</div>';
  const validHistory = history.filter(
    (h) => h && typeof h.duration === "number" && h.duration >= 0,
  );
  if (validHistory.length === 0)
    return '<div class="no-data-chart">No valid data for chart</div>';

  const chartId = `testHistoryChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const renderFunctionName = `renderTestHistoryChart_${chartId.replace(
    /-/g,
    "_",
  )}`;

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

  const accentColorRGB = "103, 58, 183"; // Assuming var(--accent-color) is Deep Purple #673ab7

  const categoriesString = JSON.stringify(
    validHistory.map((_, i) => `R${i + 1}`),
  );
  const seriesDataPointsString = JSON.stringify(seriesDataPoints);

  return `
      <div id="${chartId}" style="width: 320px; height: 100px;" class="lazy-load-chart" data-render-function-name="${renderFunctionName}">
          <div class="no-data-chart">Loading History...</div>
      </div>
      <script>
          window.${renderFunctionName} = function() {
              const chartContainer = document.getElementById('${chartId}');
              if (!chartContainer) { console.error("Chart container ${chartId} not found for lazy loading."); return; }
              if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                  try {
                      chartContainer.innerHTML = ''; // Clear placeholder
                      const chartOptions = {
                          chart: { type: 'area', height: 100, width: 320, backgroundColor: 'transparent', spacing: [10,10,15,35] },
                          title: { text: null },
                          xAxis: { categories: ${categoriesString}, labels: { style: { fontSize: '10px', color: 'var(--text-color-secondary)' }}},
                          yAxis: {
                              title: { text: null },
                              labels: { formatter: function() { return formatDuration(this.value); }, style: { fontSize: '10px', color: 'var(--text-color-secondary)' }, align: 'left', x: -35, y: 3 },
                              min: 0, gridLineWidth: 0, tickAmount: 4
                          },
                          legend: { enabled: false },
                          plotOptions: {
                              area: {
                                  lineWidth: 2, lineColor: 'var(--accent-color)',
                                  fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(${accentColorRGB}, 0.4)'],[1, 'rgba(${accentColorRGB}, 0)']]},
                                  marker: { enabled: true }, threshold: null
                              }
                          },
                          tooltip: {
                              useHTML: true, backgroundColor: 'rgba(10,10,10,0.92)', borderColor: 'rgba(10,10,10,0.92)', style: { color: '#f5f5f5', padding: '8px' },
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
                                  return '<strong>Run ' + (pointData.runId || (this.point.index + 1)) + '</strong><br>' + 'Status: ' + statusBadgeHtml + '<br>' + 'Duration: ' + formatDuration(pointData.y);
                              }
                          },
                          series: [{ data: ${seriesDataPointsString}, showInLegend: false }],
                          credits: { enabled: false }
                      };
                      Highcharts.chart('${chartId}', chartOptions);
                  } catch (e) {
                      console.error("Error rendering chart ${chartId} (lazy):", e);
                      chartContainer.innerHTML = '<div class="no-data-chart">Error rendering history chart.</div>';
                  }
              } else {
                  chartContainer.innerHTML = '<div class="no-data-chart">Charting library not available for history.</div>';
              }
          };
      </script>
  `;
}
/**
 * Generates a Highcharts pie chart to visualize the distribution of test statuses.
 * @param {Array<object>} data The data for the pie chart, with each object having a 'label' and 'value'.
 * @param {number} [chartWidth=300] The width of the chart.
 * @param {number} [chartHeight=300] The height of the chart.
 * @returns {string} The HTML string for the pie chart.
 */
function generatePieChart(data, chartWidth = 300, chartHeight = 300) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return '<div class="pie-chart-wrapper"><h3>Test Distribution</h3><div class="no-data">No data for Test Distribution chart.</div></div>';
  }
  const passedEntry = data.find((d) => d.label === "Passed");
  const passedPercentage = Math.round(
    ((passedEntry ? passedEntry.value : 0) / total) * 100,
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
      <div class="pie-chart-wrapper" style="align-items: center; max-height: 450px">
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
/**
 * Generates an HTML dashboard to display environment details.
 * @param {object} environment The environment information.
 * @param {number} [dashboardHeight=600] The height of the dashboard.
 * @returns {string} The HTML string for the environment dashboard.
 */
function generateEnvironmentDashboard(environment, dashboardHeight = 600) {
  // Format memory for display
  const formattedMemory = environment.memory.replace(/(\d+\.\d{2})GB/, "$1 GB");

  // Generate a unique ID for the dashboard
  const dashboardId = `envDashboard-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  const cardHeight = Math.floor(dashboardHeight * 0.44);
  const cardContentPadding = 16; // px

  // Logic for Run Context
  const runContext = process.env.CI ? "CI" : "Local Test";

  return `
    <div class="environment-dashboard-wrapper" id="${dashboardId}">
      <style>
        .environment-dashboard-wrapper *,
        .environment-dashboard-wrapper *::before,
        .environment-dashboard-wrapper *::after {
          box-sizing: border-box;
        }

        .environment-dashboard-wrapper {
          --primary-color: var(--primary-dark, #6366f1);
          --success-color: var(--success-dark, #10b981);
          --warning-color: var(--warning-dark, #f59e0b);
          
          background-color: var(--bg-tertiary);
          padding: 48px; 
          border-bottom: 1px solid var(--border-light);
          font-family: var(--font-family);
          color: var(--text-primary);
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 32px;
          font-size: 15px;
          transform: translateZ(0);
        }

        @media (max-width: 768px) {
            .environment-dashboard-wrapper {
                grid-template-columns: 1fr;
                padding: 32px 24px;
            }
        }
        @media (max-width: 480px) {
            .environment-dashboard-wrapper {
                padding: 24px;
            }
        }
        
        .env-dashboard-header {
          grid-column: 1 / -1;
          margin-bottom: 24px;
        }
        
        .env-dashboard-title {
          font-size: 2em;
          font-weight: 900;
          color: #f9fafb;
          letter-spacing: -0.02em;
          margin: 0 0 8px 0;
        }
        
        .env-dashboard-subtitle {
          font-size: 1.05em;
          color: var(--text-tertiary);
          margin: 0;
          font-weight: 400;
        }
        
        .env-card {
          background: var(--bg-card);
          border: none;
          border-left: 4px solid var(--border-medium);
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          transition: all 0.12s ease;
          transform: translateZ(0);
        }
        
        .env-card:hover {
          border-left-color: var(--primary-color);
          background: #1e293b;
        }
        
        .env-card-header {
          font-weight: 700;
          font-size: 1.05em;
          color: #f9fafb;
          display: flex;
          align-items: center;
          gap: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .env-card-header svg {
          width: 18px;
          height: 18px;
          fill: var(--primary-dark);
        }

        .env-card-content {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        
        .env-detail-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          font-size: 1em;
          padding: 8px 0;
        }
        
        .env-detail-label {
          color: #94a3b8;
          font-weight: 600;
          font-size: 0.9em;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          flex-shrink: 0;
        }
        
        .env-detail-value {
          color: #f9fafb;
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          font-size: 0.95em;
          text-align: right;
          word-break: break-word;
          margin-left: auto;
        }
        
        .env-chip {
          display: inline-flex;
          align-items: center;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 0.85em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .env-chip-primary {
          background-color: rgba(99, 102, 241, 0.2);
          color: var(--primary-light);
        }
        
        .env-chip-success {
          background-color: rgba(16, 185, 129, 0.2);
          color: var(--success-light);
        }
        
        .env-chip-warning {
          background-color: rgba(245, 158, 11, 0.2);
          color: var(--warning-light);
        }
        
        .env-cpu-cores {
          display: flex;
          align-items: center;
          gap: 6px; 
        }
        
        .env-core-indicator {
          width: 12px; 
          height: 12px;
          border-radius: 50%;
          background-color: var(--success-color);
          border: 1px solid rgba(255,255,255,0.2); 
        }
        
        .env-core-indicator.inactive {
          background-color: var(--border-medium);
          opacity: 0.7; 
          border-color: var(--border-medium);
        }
      </style>
      
      <div class="env-dashboard-header">
        <div>
          <h3 class="env-dashboard-title">System Environment</h3>
          <p class="env-dashboard-subtitle">Snapshot of the execution environment</p>
        </div>
        <span class="env-chip env-chip-primary">${environment.host}</span>
      </div>
      
      <div class="env-card">
        <div class="env-card-header">
          <svg viewBox="0 0 24 24"><path d="M4 6h16V4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8h-2v10H4V6zm18-2h-4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2H6a2 2 0 0 0-2 2v2h20V6a2 2 0 0 0-2-2zM8 12h8v2H8v-2zm0 4h8v2H8v-2z"/></svg>
          Hardware
        </div>
        <div class="env-card-content">
          <div class="env-detail-row">
            <span class="env-detail-label">CPU Model</span>
            <span class="env-detail-value">${environment.cpu.model}</span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">CPU Cores</span>
            <span class="env-detail-value">
              <div class="env-cpu-cores">
                <span>${environment.cpu.cores || "N/A"} core${environment.cpu.cores !== 1 ? "s" : ""}</span>
              </div>
            </span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">Memory</span>
            <span class="env-detail-value">${formattedMemory}</span>
          </div>
        </div>
      </div>
      
      <div class="env-card">
        <div class="env-card-header">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-0.01 18c-2.76 0-5.26-1.12-7.07-2.93A7.973 7.973 0 0 1 4 12c0-2.21.9-4.21 2.36-5.64A7.994 7.994 0 0 1 11.99 4c4.41 0 8 3.59 8 8 0 2.76-1.12 5.26-2.93 7.07A7.973 7.973 0 0 1 11.99 20zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/></svg>
          Operating System
        </div>
        <div class="env-card-content">
          <div class="env-detail-row">
            <span class="env-detail-label">OS Type</span>
            <span class="env-detail-value">${
              environment.os.split(" ")[0] === "darwin"
                ? "darwin (macOS)"
                : environment.os.split(" ")[0] || "Unknown"
            }</span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">OS Version</span>
            <span class="env-detail-value">${
              environment.os.split(" ")[1] || "N/A"
            }</span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">Hostname</span>
            <span class="env-detail-value" title="${environment.host}">${
              environment.host
            }</span>
          </div>
        </div>
      </div>
      
      <div class="env-card">
        <div class="env-card-header">
          <svg viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
          Node.js Runtime
        </div>
        <div class="env-card-content">
          <div class="env-detail-row">
            <span class="env-detail-label">Node Version</span>
            <span class="env-detail-value">${environment.node}</span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">V8 Engine</span>
            <span class="env-detail-value">${environment.v8}</span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">Working Dir</span>
            <span class="env-detail-value" title="${environment.cwd}">${
              environment.cwd.length > 25
                ? "..." + environment.cwd.slice(-22)
                : environment.cwd
            }</span>
          </div>
        </div>
      </div>
      
      <div class="env-card">
        <div class="env-card-header">
          <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h.71C7.37 8.69 9.48 7 12 7c2.76 0 5 2.24 5 5v1h2c1.66 0 3 1.34 3 3s-1.34 3-3 3z"/></svg>
          System Summary
        </div>
        <div class="env-card-content">
          <div class="env-detail-row">
            <span class="env-detail-label">Platform Arch</span>
            <span class="env-detail-value">
              <span class="env-chip ${
                environment.os.includes("darwin") &&
                environment.cpu.model.toLowerCase().includes("apple")
                  ? "env-chip-success"
                  : "env-chip-warning"
              }">
                ${
                  environment.os.includes("darwin") &&
                  environment.cpu.model.toLowerCase().includes("apple")
                    ? "Apple Silicon"
                    : environment.cpu.model.toLowerCase().includes("arm") ||
                        environment.cpu.model.toLowerCase().includes("aarch64")
                      ? "ARM-based"
                      : "x86/Other"
                }
              </span>
            </span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">Memory per Core</span>
            <span class="env-detail-value">${
              environment.cpu.cores > 0
                ? (
                    parseFloat(environment.memory) / environment.cpu.cores
                  ).toFixed(2) + " GB"
                : "N/A"
            }</span>
          </div>
          <div class="env-detail-row">
            <span class="env-detail-label">Run Context</span>
            <span class="env-detail-value">${runContext}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}
/**
 * Generates a Highcharts bar chart to visualize the distribution of test results across different workers.
 * @param {Array<object>} results The test results data.
 * @returns {string} The HTML string for the worker distribution chart and its associated modal.
 */
function generateWorkerDistributionChart(results) {
  if (!results || results.length === 0) {
    return '<div class="no-data">No test results data available to display worker distribution.</div>';
  }

  // 1. Sort results by startTime to ensure chronological order
  const sortedResults = [...results].sort((a, b) => {
    const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
    const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
    return timeA - timeB;
  });

  const workerData = sortedResults.reduce((acc, test) => {
    const workerId =
      typeof test.workerId !== "undefined" ? test.workerId : "N/A";
    if (!acc[workerId]) {
      acc[workerId] = { passed: 0, failed: 0, skipped: 0, tests: [] };
    }

    const status = String(test.status).toLowerCase();
    if (status === "passed" || status === "failed" || status === "skipped") {
      acc[workerId][status]++;
    }

    const testTitleParts = test.name.split(" > ");
    const testTitle =
      testTitleParts[testTitleParts.length - 1] || "Unnamed Test";
    // Store both name and status for each test
    acc[workerId].tests.push({ name: testTitle, status: status });

    return acc;
  }, {});

  const workerIds = Object.keys(workerData).sort((a, b) => {
    if (a === "N/A") return 1;
    if (b === "N/A") return -1;
    return parseInt(a, 10) - parseInt(b, 10);
  });

  if (workerIds.length === 0) {
    return '<div class="no-data">Could not determine worker distribution from test data.</div>';
  }

  const chartId = `workerDistChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const renderFunctionName = `renderWorkerDistChart_${chartId.replace(
    /-/g,
    "_",
  )}`;
  const modalJsNamespace = `modal_funcs_${chartId.replace(/-/g, "_")}`;

  // The categories now just need the name for the axis labels
  const categories = workerIds.map((id) => `Worker ${id}`);

  // We pass the full data separately to the script
  const fullWorkerData = workerIds.map((id) => ({
    id: id,
    name: `Worker ${id}`,
    tests: workerData[id].tests,
  }));

  const passedData = workerIds.map((id) => workerData[id].passed);
  const failedData = workerIds.map((id) => workerData[id].failed);
  const skippedData = workerIds.map((id) => workerData[id].skipped);

  const categoriesString = JSON.stringify(categories);
  const fullDataString = JSON.stringify(fullWorkerData);
  const seriesString = JSON.stringify([
    { name: "Passed", data: passedData, color: "var(--success-color)" },
    { name: "Failed", data: failedData, color: "var(--danger-color)" },
    { name: "Skipped", data: skippedData, color: "var(--warning-color)" },
  ]);

  // The HTML now includes the chart container, the modal, and styles for the modal
  return `
<style>
      .worker-modal-overlay {
        position: fixed; z-index: 1050; left: 0; top: 0; width: 100%; height: 100%;
        overflow: auto; background-color: rgba(0,0,0,0.92);
        display: none; align-items: center; justify-content: center;
      }
      .worker-modal-content {
        background-color: var(--bg-card);
        color: var(--card-background-color);
        margin: auto; padding: 20px; border: 1px solid var(--border-color, #888);
        width: 80%; max-width: 700px; border-radius: 8px;
        position: relative; box-shadow: var(--shadow-2xl);
      }
      .worker-modal-close {
        position: absolute; 
        top: 15px; 
        right: 25px;
        font-size: 32px; 
        font-weight: bold; 
        cursor: pointer;
        line-height: 1;
        z-index: 10;
        color: #fff;
        transition: color 0.2s ease;
        user-select: none;
        -webkit-user-select: none;
      }
      .worker-modal-close:hover, .worker-modal-close:focus {
        color: var(--danger-color);
        transform: scale(1.1);
      }
      #worker-modal-body-${chartId} ul {
        list-style-type: none; padding-left: 0; margin-top: 15px; max-height: 45vh; overflow-y: auto;
      }
       #worker-modal-body-${chartId} li {
         padding: 8px 5px; border-bottom: 1px solid var(--border-color, #eee);
         font-size: 0.9em;
      }
       #worker-modal-body-${chartId} li:last-child {
         border-bottom: none;
      }
       #worker-modal-body-${chartId} li > span {
         display: inline-block;
         width: 70px;
         font-weight: bold;
         text-align: right;
         margin-right: 10px;
      }
    </style>

    <div id="${chartId}" class="trend-chart-container lazy-load-chart" data-render-function-name="${renderFunctionName}" style="min-height: 350px;">
      <div class="no-data">Loading Worker Distribution Chart...</div>
    </div>

    <div id="worker-modal-${chartId}" class="worker-modal-overlay">
      <div class="worker-modal-content">
        <span class="worker-modal-close" onclick="window.${modalJsNamespace}.close()">×</span>
        <h3 id="worker-modal-title-${chartId}" style="text-align: center; margin-top: 0; margin-bottom: 25px; font-size: 1.25em; font-weight: 600; color: #fff"></h3>
        <div id="worker-modal-body-${chartId}"></div>
      </div>
    </div>

    <script>
      // Namespace for modal functions to avoid global scope pollution
      window.${modalJsNamespace} = {};

window.${renderFunctionName} = function() {
  const chartContainer = document.getElementById('${chartId}');
  if (!chartContainer) { console.error("Chart container ${chartId} not found."); return; }

  // --- Modal Setup ---
  const modal = document.getElementById('worker-modal-${chartId}');
  const modalTitle = document.getElementById('worker-modal-title-${chartId}');
  const modalBody = document.getElementById('worker-modal-body-${chartId}');
  const closeModalBtn = modal.querySelector('.worker-modal-close');

  window.${modalJsNamespace}.open = function(worker) {
    if (!worker) return;
    modalTitle.textContent = 'Test Details for ' + worker.name;

    let testListHtml = '<ul>';
    if (worker.tests && worker.tests.length > 0) {
      worker.tests.forEach(test => {
          let color = 'inherit';
          if (test.status === 'passed') color = 'var(--success-color)';
          else if (test.status === 'failed') color = 'var(--danger-color)';
          else if (test.status === 'skipped') color = 'var(--warning-color)';

          // Updated escaping logic
          const escapedName = test.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          testListHtml += \`<li style="color: \${color};"><span style="color: \${color}">[\${test.status.toUpperCase()}]</span> \${escapedName}</li>\`;
      });
    } else {
      testListHtml += '<li>No detailed test data available for this worker.</li>';
    }
    testListHtml += '</ul>';

    modalBody.innerHTML = testListHtml;
    modal.style.display = 'flex';
  };

  const closeModal = function() {
    modal.style.display = 'none';
  };

  window.${modalJsNamespace}.close = closeModal;

  if (closeModalBtn) {
    closeModalBtn.onclick = closeModal;
  }

  modal.onclick = function(event) {
    if (event.target == modal) {
      closeModal();
    }
  };


        // --- Highcharts Setup ---
        if (typeof Highcharts !== 'undefined') {
          try {
            chartContainer.innerHTML = '';
            const fullData = ${fullDataString};

            const chartOptions = {
              chart: { type: 'bar', height: 350, backgroundColor: 'transparent' },
              title: { text: null },
              xAxis: {
                categories: ${categoriesString},
                title: { text: 'Worker ID' },
                labels: { style: { color: 'var(--text-color-secondary)' }}
              },
              yAxis: {
                min: 0,
                title: { text: 'Number of Tests' },
                labels: { style: { color: 'var(--text-color-secondary)' }},
                stackLabels: { enabled: true, style: { fontWeight: 'bold', color: 'var(--text-color)' } }
              },
              legend: { reversed: true, itemStyle: { fontSize: "12px", color: 'var(--text-color)' } },
              plotOptions: {
                series: {
                  stacking: 'normal',
                  cursor: 'pointer',
                  point: {
                    events: {
                      click: function () {
                        // 'this.x' is the index of the category
                        const workerData = fullData[this.x];
                        window.${modalJsNamespace}.open(workerData);
                      }
                    }
                  }
                }
              },
              tooltip: {
                shared: true,
                headerFormat: '<b>{point.key}</b> (Click for details)<br/>',
                pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y}</b><br/>',
                footerFormat: 'Total: <b>{point.total}</b>'
              },
              series: ${seriesString},
              credits: { enabled: false }
            };
            Highcharts.chart('${chartId}', chartOptions);
          } catch (e) {
            console.error("Error rendering chart ${chartId}:", e);
            chartContainer.innerHTML = '<div class="no-data">Error rendering worker distribution chart.</div>';
          }
        } else {
          chartContainer.innerHTML = '<div class="no-data">Charting library not available for worker distribution.</div>';
        }
      };
    </script>
  `;
}
/**
 * A tooltip providing information about why worker -1 is special in Playwright.
 * @type {string}
 */
const infoTooltip = `
  <span class="info-tooltip" style="display: inline-block; margin-left: 8px;">
    <span class="info-icon" 
          style="cursor: pointer; font-size: 1.25rem;"
          onclick="window.workerInfoPrompt()">ℹ️</span>
  </span>
  <script>
    window.workerInfoPrompt = function() {
      const message = 'Why is worker -1 special?\\n\\n' +
                     'Playwright assigns skipped tests to worker -1 because:\\n' +
                     '1. They don\\'t require browser execution\\n' +
                     '2. This keeps real workers focused on actual tests\\n' +
                     '3. Maintains clean reporting\\n\\n' +
                     'This is an intentional optimization by Playwright.';
      alert(message);
    }
  </script>
`;
/**
 * Generates the HTML content for the test history section.
 * @param {object} trendData - The historical trend data.
 * @returns {string} The HTML string for the test history content.
 */
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
          (t) => t && t.testName === fullTestName,
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
      <div class="filters">
    <input type="text" id="history-filter-name" placeholder="Search by test title...">
    <select id="history-filter-status">
        <option value="">All Statuses</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
        <option value="skipped">Skipped</option>
    </select>
    <button id="clear-history-filters" class="clear-filters-btn">Clear Filters</button>
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
              test.testTitle.toLowerCase(),
            )}" data-latest-status="${latestRun.status}">
              <div class="test-history-header">
                <p title="${sanitizeHTML(test.testTitle)}">${capitalize(
                  sanitizeHTML(test.testTitle),
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
                            run.status,
                          )}">${String(run.status).toUpperCase()}</span></td>
                          <td>${formatDuration(run.duration)}</td>
                          <td>${formatDate(run.timestamp)}</td>
                        </tr>`,
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
/**
 * Gets the CSS class for a given test status.
 * @param {string} status - The test status.
 * @returns {string} The CSS class for the status.
 */
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
/**
 * Gets the icon for a given test status.
 * @param {string} status - The test status.
 * @returns {string} The icon for the status.
 */
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
/**
 * Processes test results to extract suite data.
 * @param {Array<object>} results - The test results.
 * @returns {Array<object>} An array of suite data objects.
 */
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
    if (currentStatus === "failed") suite.statusOverall = "failed";
    else if (currentStatus === "skipped" && suite.statusOverall !== "failed")
      suite.statusOverall = "skipped";
  });
  return Array.from(suitesMap.values());
}
/**
 * Returns an icon for a given content type.
 * @param {string} contentType - The content type of the file.
 * @returns {string} The icon for the content type.
 */
/**
 * Returns an icon for a given content type.
 * @param {string} contentType - The content type of the file.
 * @returns {string} The icon for the content type.
 */
function getAttachmentIcon(contentType) {
  if (!contentType) return "📎"; // Handle undefined/null

  const normalizedType = contentType.toLowerCase();

  if (normalizedType.includes("pdf")) return "📄";
  if (normalizedType.includes("json")) return "{ }";
  if (/html/.test(normalizedType)) return "🌐"; // Fixed: regex for any HTML type
  if (normalizedType.includes("xml")) return "<>";
  if (normalizedType.includes("csv")) return "📊";
  if (normalizedType.startsWith("text/")) return "📝";
  return "📎";
}
/**
 * Generates the HTML for the suites widget.
 * @param {Array} suitesData - The data for the suites.
 * @returns {string} The HTML for the suites widget.
 */
/**
 * Generates the HTML for the suites widget.
 * @param {Array} suitesData - The data for the suites.
 * @returns {string} The HTML for the suites widget.
 */
function generateSuitesWidget(suitesData) {
  if (!suitesData || suitesData.length === 0) {
    return `<div class="suites-widget"><div class="suites-header"><h2>Test Suites</h2></div><div class="no-data">No suite data available.</div></div>`;
  }
  return `
<div class="suites-widget">
  <div class="suites-header">
    <h2>Test Suites</h2>
    <span class="summary-badge">${
      suitesData.length
    } suites • ${suitesData.reduce(
      (sum, suite) => sum + suite.count,
      0,
    )} tests</span>
  </div>
  <div class="suites-grid">
    ${suitesData
      .map(
        (suite) => `
    <div class="suite-card status-${suite.statusOverall}">
      <div class="suite-card-header">
        <h3 class="suite-name" title="${sanitizeHTML(
          suite.name,
        )} (${sanitizeHTML(suite.browser)})">${sanitizeHTML(suite.name)}</h3>
      </div>
      <div style="margin-bottom: 12px;"><span class="browser-tag">🌐 ${sanitizeHTML(
        suite.browser,
      )}</span></div>
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
    </div>`,
      )
      .join("")}
  </div>
</div>`;
}
/**
 * Generates the HTML for the AI failure analyzer tab.
 * @param {Array} results - The results of the test run.
 * @returns {string} The HTML for the AI failure analyzer tab.
 */
function generateAIFailureAnalyzerTab(results) {
  const failedTests = (results || []).filter(
    (test) => test.status === "failed",
  );

  if (failedTests.length === 0) {
    return `
      <div class="no-data">Congratulations! No failed tests in this run.</div>
    `;
  }

  // btoa is not available in Node.js environment, so we define a simple polyfill for it.
  const btoa = (str) => Buffer.from(str).toString("base64");

  return `
    <div class="ai-analyzer-stats">
        <div class="stat-item">
            <span class="stat-number">${failedTests.length}</span>
            <span class="stat-label">Failed Tests</span>
        </div>
        <div class="stat-item">
            <span class="stat-number">${
              new Set(failedTests.map((t) => t.browser)).size
            }</span>
            <span class="stat-label">Browsers</span>
        </div>
        <div class="stat-item">
            <span class="stat-number">${Math.round(
              failedTests.reduce((sum, test) => sum + (test.duration || 0), 0) /
                1000,
            )}s</span>
            <span class="stat-label">Total Duration</span>
        </div>
    </div>
    <p class="ai-analyzer-description">
        Analyze failed tests using AI to get suggestions and potential fixes. Click the AI Fix button for instant analysis or use Copy AI Prompt to analyze with your preferred AI tool.
    </p>
    
    <div class="compact-failure-list">
      ${failedTests
        .map((test) => {
          const testTitle = test.name.split(" > ").pop() || "Unnamed Test";
          const testJson = btoa(JSON.stringify(test)); // Base64 encode the test object
          const truncatedError =
            (test.errorMessage || "No error message").slice(0, 150) +
            (test.errorMessage && test.errorMessage.length > 150 ? "..." : "");

          return `
        <div class="compact-failure-item">
            <div class="failure-header">
                <div class="failure-main-info">
                    <h3 class="failure-title" title="${sanitizeHTML(
                      test.name,
                    )}">${sanitizeHTML(testTitle)}</h3>
                    <div class="failure-meta">
                        <span class="browser-indicator">${sanitizeHTML(
                          test.browser || "unknown",
                        )}</span>
                        <span class="duration-indicator">${formatDuration(
                          test.duration,
                        )}</span>
                    </div>
                </div>
                <div class="ai-buttons-group">
                    <button class="compact-ai-btn" onclick="getAIFix(this)" data-test-json="${testJson}">
                        <span class="ai-text">AI Fix</span>
                    </button>
                    <button class="copy-prompt-btn" onclick="copyAIPrompt(this)" data-test-json="${testJson}" title="Copy AI Prompt">
                        <span class="copy-prompt-text">Copy AI Prompt</span>
                    </button>
                </div>
            </div>
            <div class="failure-error-preview">
                <div class="error-snippet">${formatPlaywrightError(
                  truncatedError,
                )}</div>
                <button class="expand-error-btn" onclick="toggleErrorDetails(this)">
                    <span class="expand-text">Show Full Error</span>
                    <span class="expand-icon">▼</span>
                </button>
            </div>
            <div class="full-error-details" style="display: none;">
                <div class="full-error-content">
                    ${formatPlaywrightError(
                      test.errorMessage ||
                        "No detailed error message available",
                    )}
                </div>
            </div>
            <div class="ai-suggestion-container" style="display: none;">
                <div class="ai-suggestion-content">
                </div>
            </div>
        </div>
        `;
        })
        .join("")}
    </div>
  `;
}
/**
 * Generates a area chart showing the total duration per spec file.
 * The chart is lazy-loaded and rendered with Highcharts when scrolled into view.
 *
 * @param {Array<object>} results - Array of test result objects.
 * @returns {string} HTML string containing the chart container and lazy-loading script.
 */
function generateSpecDurationChart(results) {
  if (!results || results.length === 0)
    return '<div class="no-data">No results available.</div>';

  const specDurations = {};
  results.forEach((test) => {
    // Use the dedicated 'spec_file' key
    const fileName = test.spec_file || "Unknown File";

    if (!specDurations[fileName]) specDurations[fileName] = 0;
    specDurations[fileName] += test.duration;
  });

  const categories = Object.keys(specDurations);
  // We map 'name' here, which we will use in the tooltip later
  const data = categories.map((cat) => ({
    y: specDurations[cat],
    name: cat,
  }));

  if (categories.length === 0)
    return '<div class="no-data">No spec data found.</div>';

  const chartId = `specDurChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const renderFunctionName = `renderSpecDurChart_${chartId.replace(/-/g, "_")}`;

  const categoriesStr = JSON.stringify(categories);
  const dataStr = JSON.stringify(data);

  return `
    <div id="${chartId}" class="trend-chart-container lazy-load-chart" data-render-function-name="${renderFunctionName}">
        <div class="no-data">Loading Spec Duration Chart...</div>
    </div>
    <script>
        window.${renderFunctionName} = function() {
            const chartContainer = document.getElementById('${chartId}');
            if (!chartContainer) return;
            if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                try {
                    chartContainer.innerHTML = '';
                    Highcharts.chart('${chartId}', {
                        chart: { type: 'area', height: 350, backgroundColor: 'transparent' },
                        title: { text: null },
                        xAxis: { 
                            categories: ${categoriesStr}, 
                            visible: false, // 1. HIDE THE X-AXIS
                            title: { text: null },
                            crosshair: true
                        },
                        yAxis: { 
                            min: 0, 
                            title: { text: 'Total Duration', style: { color: 'var(--text-color)' } },
                            labels: { formatter: function() { return formatDuration(this.value); }, style: { color: 'var(--text-color-secondary)' } }
                        },
                        legend: { layout: 'horizontal', align: 'center', verticalAlign: 'bottom', itemStyle: { fontSize: '12px', color: 'var(--text-color)' }},
                          plotOptions: { area: { lineWidth: 2.5, states: { hover: { lineWidthPlus: 0 } }, threshold: null }},
                        tooltip: {
                            shared: true,
                            useHTML: true,
                            backgroundColor: 'rgba(10,10,10,0.92)',
                            borderColor: 'rgba(10,10,10,0.92)',
                            style: { color: '#f5f5f5' },
                            formatter: function() {
                                const point = this.points ? this.points[0].point : this.point;
                                const color = point.color || point.series.color;
                                
                                // 2. FIX: Use 'point.name' instead of 'this.x' to get the actual filename
                                return '<span style="color:' + color + '">●</span> <b>File: ' + point.name + '</b><br/>' + 
                                       'Duration: <b>' + formatDuration(this.y) + '</b>';
                            }
                        },
                        series: [{
                            name: 'Duration',
                            data: ${dataStr},
                            color: 'var(--accent-color-alt)',
                            type: 'area',
                            marker: { symbol: 'circle', enabled: true, radius: 4, fillColor: '#ffffff', lineColor: 'var(--accent-color-alt)', lineWidth: 2, states: { hover: { radius: 6, lineWidthPlus: 0 } } },
                            fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(${accentColorAltRGB}, 0.4)'], [1, 'rgba(${accentColorAltRGB}, 0.05)']] },
                            lineWidth: 2.5
                        }],
                        credits: { enabled: false }
                    });
                } catch (e) { console.error("Error rendering spec chart:", e); }
            }
        };
    </script>
  `;
}
/**
 * Generates a vertical bar chart showing the total duration of each test describe block.
 * Tests without a describe block or with "n/a" / empty describe names are ignored.
 * @param {Array<object>} results - Array of test result objects.
 * @returns {string} HTML string containing the chart container and lazy-loading script.
 */
function generateDescribeDurationChart(results) {
  if (!results || results.length === 0)
    return '<div class="no-data">Seems like there is test describe block available in the executed test suite.</div>';

  const describeMap = new Map();
  let foundAnyDescribe = false;

  results.forEach((test) => {
    if (test.describe) {
      const describeName = test.describe;
      // Filter out invalid describe blocks
      if (
        !describeName ||
        describeName.trim().toLowerCase() === "n/a" ||
        describeName.trim() === ""
      ) {
        return;
      }

      foundAnyDescribe = true;
      const fileName = test.spec_file || "Unknown File";
      const key = fileName + "::" + describeName;

      if (!describeMap.has(key)) {
        describeMap.set(key, {
          duration: 0,
          file: fileName,
          describe: describeName,
        });
      }
      describeMap.get(key).duration += test.duration;
    }
  });

  if (!foundAnyDescribe) {
    return '<div class="no-data">No valid test describe blocks found.</div>';
  }

  const categories = [];
  const data = [];

  for (const [key, val] of describeMap.entries()) {
    categories.push(val.describe);
    data.push({
      y: val.duration,
      name: val.describe,
      custom: {
        fileName: val.file,
        describeName: val.describe,
      },
    });
  }

  const chartId = `descDurChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const renderFunctionName = `renderDescDurChart_${chartId.replace(/-/g, "_")}`;

  const categoriesStr = JSON.stringify(categories);
  const dataStr = JSON.stringify(data);

  return `
    <div id="${chartId}" class="trend-chart-container lazy-load-chart" data-render-function-name="${renderFunctionName}">
        <div class="no-data">Loading Describe Duration Chart...</div>
    </div>
    <script>
        window.${renderFunctionName} = function() {
            const chartContainer = document.getElementById('${chartId}');
            if (!chartContainer) return;
            if (typeof Highcharts !== 'undefined' && typeof formatDuration !== 'undefined') {
                try {
                    chartContainer.innerHTML = '';
                    Highcharts.chart('${chartId}', {
                        chart: { 
                            type: 'column', // 1. CHANGED: 'bar' -> 'column' for vertical bars
                            height: 400,    // 2. CHANGED: Fixed height works better for vertical charts
                            backgroundColor: 'transparent' 
                        },
                        title: { text: null },
                        xAxis: { 
                            categories: ${categoriesStr}, 
                            visible: false, // Hidden as requested
                            title: { text: null },
                            crosshair: true
                        },
                        yAxis: { 
                            min: 0, 
                            title: { text: 'Total Duration', style: { color: 'var(--text-color)' } },
                            labels: { formatter: function() { return formatDuration(this.value); }, style: { color: 'var(--text-color-secondary)' } }
                        },
                        legend: { enabled: false },
                        plotOptions: { 
                            series: { 
                                borderRadius: 4, 
                                borderWidth: 0,
                                states: { hover: { brightness: 0.1 }} 
                            },
                            column: { pointPadding: 0.2, groupPadding: 0.1 } // Adjust spacing for columns
                        },
                        tooltip: {
                            shared: true, 
                            useHTML: true, 
                            backgroundColor: 'rgba(10,10,10,0.92)', 
                            borderColor: 'rgba(10,10,10,0.92)', 
                            style: { color: '#f5f5f5' },
                            formatter: function() {
                                const point = this.points ? this.points[0].point : this.point;
                                const file = (point.custom && point.custom.fileName) ? point.custom.fileName : 'Unknown';
                                const desc = point.name || 'Unknown'; 
                                const color = point.color || point.series.color;
                                
                                return '<span style="color:' + color + '">●</span> <b>Describe: ' + desc + '</b><br/>' +
                                  '<span style="opacity: 0.8; font-size: 0.9em; color: #ddd;">File: ' + file + '</span><br/>' +
                                  'Duration: <b>' + formatDuration(point.y) + '</b>';
                            }
                        },
                        series: [{
                            name: 'Duration',
                            data: ${dataStr},
                            colorByPoint: true,
                            colors: [
                                '#9333ea',
                                '#6366f1',
                                '#0ea5e9',
                                '#10b981',
                                '#84cc16',
                                '#eab308',
                                '#f97316',
                                '#ef4444',
                                '#ec4899',
                                '#8b5cf6',
                                '#06b6d4',
                                '#14b8a6',
                                '#a3e635',
                                '#fbbf24',
                                '#fb923c',
                                '#f87171'
                            ],
                        }],
                        credits: { enabled: false }
                    });
                } catch (e) { console.error("Error rendering describe chart:", e); }
            }
        };
    </script>
  `;
}
/**
 * Generates a stacked column chart showing test results distributed by severity.
 * Matches dimensions of the System Environment section (~600px).
 * Lazy-loaded for performance.
 */
function generateSeverityDistributionChart(results) {
  if (!results || results.length === 0) {
    return '<div class="trend-chart" style="height: 600px;"><div class="no-data">No results available for severity distribution.</div></div>';
  }

  const severityLevels = ["Critical", "High", "Medium", "Low", "Minor"];
  const data = {
    passed: [0, 0, 0, 0, 0],
    failed: [0, 0, 0, 0, 0],
    skipped: [0, 0, 0, 0, 0],
  };

  results.forEach((test) => {
    const sev = test.severity || "Medium";
    const status = String(test.status).toLowerCase();

    let index = severityLevels.indexOf(sev);
    if (index === -1) index = 2; // Default to Medium

    if (status === "passed") {
      data.passed[index]++;
    } else if (
      status === "failed" ||
      status === "timedout" ||
      status === "interrupted"
    ) {
      data.failed[index]++;
    } else {
      data.skipped[index]++;
    }
  });

  const chartId = `sevDistChart-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;
  const renderFunctionName = `renderSevDistChart_${chartId.replace(/-/g, "_")}`;

  const seriesData = [
    { name: "Passed", data: data.passed, color: "var(--success-color)" },
    { name: "Failed", data: data.failed, color: "var(--danger-color)" },
    { name: "Skipped", data: data.skipped, color: "var(--warning-color)" },
  ];

  const seriesDataStr = JSON.stringify(seriesData);
  const categoriesStr = JSON.stringify(severityLevels);

  return `
    <div class="trend-chart" style="height: 600px; padding: 28px; box-sizing: border-box;">
        <h3 class="chart-title-header">Severity Distribution</h3>
        <div id="${chartId}" class="lazy-load-chart" data-render-function-name="${renderFunctionName}" style="width: 100%; height: 100%;">
             <div class="no-data">Loading Severity Chart...</div>
        </div>
        <script>
            window.${renderFunctionName} = function() {
                const chartContainer = document.getElementById('${chartId}');
                if (!chartContainer) return;

                if (typeof Highcharts !== 'undefined') {
                    try {
                        chartContainer.innerHTML = '';
                        Highcharts.chart('${chartId}', {
                            chart: { type: 'column', backgroundColor: 'transparent' },
                            title: { text: null },
                            xAxis: {
                                categories: ${categoriesStr},
                                crosshair: true,
                                labels: { style: { color: 'var(--text-color-secondary)' } }
                            },
                            yAxis: {
                                min: 0,
                                title: { text: 'Test Count', style: { color: 'var(--text-color)' } },
                                stackLabels: { enabled: true, style: { fontWeight: 'bold', color: 'var(--text-color)' } },
                                labels: { style: { color: 'var(--text-color-secondary)' } }
                            },
                            legend: {
                                 itemStyle: { color: 'var(--text-color)' }
                            },
                            tooltip: {
                                shared: true,
                                useHTML: true,
                                backgroundColor: 'rgba(10,10,10,0.92)',
                                style: { color: '#f5f5f5' },
                                formatter: function() {
                                    // Custom formatter to HIDE 0 values
                                    let tooltip = '';
                                    let hasItems = false;
                                    
                                    this.points.forEach(point => {
                                        if (point.y > 0) { // ONLY show if count > 0
                                            tooltip += '<span style="color:' + point.series.color + '">●</span> ' + 
                                                      point.series.name + ': <b>' + point.y + '</b><br/>';
                                            hasItems = true;
                                        }
                                    });
                                    
                                    if (!hasItems) return false; // Hide tooltip entirely if no data
                                    
                                    // Calculate total from visible points to ensure accuracy or use stackTotal
                                    tooltip += 'Total: ' + this.points[0].total;
                                    return tooltip;
                                }
                            },
                            plotOptions: {
                                column: {
                                    stacking: 'normal',
                                    dataLabels: { 
                                        enabled: true, 
                                        color: '#fff', 
                                        style: { textOutline: 'none' },
                                        formatter: function() {
                                            return (this.y > 0) ? this.y : null; // Hide 0 labels on chart bars
                                        }
                                    },
                                    borderRadius: 3
                                }
                            },
                            series: ${seriesDataStr},
                            credits: { enabled: false }
                        });
                    } catch(e) {
                         console.error("Error rendering severity chart:", e);
                         chartContainer.innerHTML = '<div class="no-data">Error rendering chart.</div>';
                    }
                }
            };
        </script>
    </div>
  `;
}
/**
 * Helper to generate Lazy Media HTML using the Script Tag pattern.
 * This prevents the browser from parsing massive Base64 strings on page load.
 */
function createLazyMedia(base64Data, mimeType, type, index, filename) {
  const uniqueId = `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const dataUri = `data:${mimeType};base64,${base64Data}`;
  // Store heavy data in a non-rendering script tag
  const storage = `<script type="text/plain" id="data-${uniqueId}">${dataUri}</script>`;

  let mediaTag = "";
  let btnText = "";
  let icon = "";

  if (type === "video") {
    mediaTag = `<video id="${uniqueId}" controls style="display:none; width: 100%; aspect-ratio: 16/9; margin-bottom: 10px;"></video>`;
    btnText = "▶ Load Video";
  } else {
    mediaTag = `<img id="${uniqueId}" alt="Screenshot ${index}" style="display:none; width: 100%; aspect-ratio: 4/3; object-fit: cover; border-bottom: 1px solid var(--border-color);" />`;
    btnText = "📷 Load Image";
  }

  return `
  <div class="attachment-item ${type === "video" ? "video-item" : ""}">
      ${storage}
      <div class="lazy-placeholder" style="padding: 2rem; text-align: center; background: var(--light-gray-color); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 180px;">
          <button class="ai-fix-btn" onclick="loadMedia('${uniqueId}', '${type}')" style="margin: 0 auto; font-size: 0.9rem;">${btnText}</button>
          <span style="font-size: 0.8rem; color: var(--text-color-secondary); margin-top: 8px;">(Click to view)</span>
      </div>
      ${mediaTag}
      <div class="attachment-info">
          <div class="trace-actions">
              <a href="#" onclick="event.preventDefault(); downloadMedia('${uniqueId}', '${filename}')" class="download-trace" style="width:100%; text-align:center;">Download</a>
          </div>
      </div>
  </div>`;
}
/**
 * Generates the HTML report.
 * @param {object} reportData - The data for the report.
 * @param {object} trendData - The data for the trend chart.
 * @returns {string} The HTML report.
 */
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
  const totalTestsOr1 = runSummary.totalTests || 1;
  const passPercentage = Math.round((runSummary.passed / totalTestsOr1) * 100);
  const failPercentage = Math.round((runSummary.failed / totalTestsOr1) * 100);
  const skipPercentage = Math.round(
    ((runSummary.skipped || 0) / totalTestsOr1) * 100,
  );
  const avgTestDuration =
    runSummary.totalTests > 0
      ? formatDuration(runSummary.duration / runSummary.totalTests)
      : "0.0s";

  // Calculate retry statistics
  const totalRetried = (results || []).reduce((acc, test) => {
    if (test.retries && test.retries > 0) {
      return acc + 1;
    }
    return acc;
  }, 0);

  // Calculate browser distribution
  const browserStats = (results || []).reduce((acc, test) => {
    let browserName = "unknown";
    if (test.browser) {
      // Extract browser name from strings like "Chrome v143 on Windows 10"
      const match = test.browser.match(/^(\w+)/);
      browserName = match ? match[1] : test.browser;
    }
    acc[browserName] = (acc[browserName] || 0) + 1;
    return acc;
  }, {});

  const totalTests = runSummary.totalTests || 1;
  const browserBreakdown = Object.entries(browserStats)
    .map(([browser, count]) => ({
      browser,
      count,
      percentage: Math.round((count / totalTests) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  /**
   * Generates the HTML for the test cases.
   * @returns {string} The HTML for the test cases.
   */
  // MODIFIED: Accepts 'subset' (chunk of tests) and 'offset' (start index)
  function generateTestCasesHTML(subset, offset = 0) {
    // Use the subset if provided, otherwise fallback to all results (legacy compatibility)
    const data = subset || results;

    if (!data || data.length === 0)
      return '<div class="no-tests">No test results found in this run.</div>';

    return data
      .map((test, i) => {
        // Calculate the global index (essential for unique IDs across chunks)
        const testIndex = offset + i;

        const browser = test.browser || "unknown";
        const testFileParts = test.name.split(" > ");
        const testTitle =
          testFileParts[testFileParts.length - 1] || "Unnamed Test";

        // --- Severity Logic ---
        const severity = test.severity || "Medium";
        const getSeverityColor = (level) => {
          switch (level) {
            case "Minor":
              return "#006064";
            case "Low":
              return "#FFA07A";
            case "Medium":
              return "#577A11";
            case "High":
              return "#B71C1C";
            case "Critical":
              return "#64158A";
            default:
              return "#577A11";
          }
        };
        const severityColor = getSeverityColor(severity);
        const severityBadge = `<span class="status-badge" style="background-color: ${severityColor}; margin-right: 8px;">${severity}</span>`;

        // --- Step Generation ---
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
                step.title,
              )}${hookIndicator}</span>
              <span class="step-duration">${formatDuration(
                step.duration,
              )}</span>
            </div>
            <div class="step-details" style="display: none;">
              ${
                step.codeLocation
                  ? `<div class="step-info code-section"><strong>Location:</strong> ${sanitizeHTML(
                      step.codeLocation,
                    )}</div>`
                  : ""
              }
              ${
                step.errorMessage
                  ? `<div class="test-error-summary">
                      ${
                        step.stackTrace
                          ? `<div class="stack-trace">${formatPlaywrightError(
                              step.stackTrace,
                            )}</div>`
                          : ""
                      }
                      <button class="copy-error-btn" onclick="copyErrorToClipboard(this)" style="margin-top: 8px; padding: 6px 12px; background: rgba(248, 113, 113, 0.15); border: 2px solid var(--danger-color); border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--danger-color); font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='rgba(248, 113, 113, 0.25)'" onmouseout="this.style.background='rgba(248, 113, 113, 0.15)'">Copy Error Prompt</button>
                    </div>`
                  : ""
              }
              ${
                hasNestedSteps
                  ? `<div class="nested-steps">${generateStepsHTML(
                      step.steps,
                      depth + 1,
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
            <span class="test-case-title" title="${sanitizeHTML(
              test.name,
            )}">${sanitizeHTML(testTitle)}</span>
            <span class="test-case-browser">(${sanitizeHTML(browser)})</span>
          </div>
          <div class="test-case-meta">
            ${severityBadge}
            ${
              test.tags && test.tags.length > 0
                ? test.tags
                    .map((t) => `<span class="tag">${sanitizeHTML(t)}</span>`)
                    .join(" ")
                : ""
            }
          </div>
          <div class="test-case-status-duration">
            <span class="status-badge ${getStatusClass(test.status)}">${String(
              test.status,
            ).toUpperCase()}</span>
            <span class="test-duration">${formatDuration(test.duration)}</span>
          </div>
        </div>
        <div class="test-case-content" style="display: none;">
          <p><strong>Full Path:</strong> ${sanitizeHTML(test.name)}</p>
          ${
            test.annotations && test.annotations.length > 0
              ? `<div class="annotations-section">
                  <h4 style="margin-top: 0; margin-bottom: 10px; font-size: 1.1em;">📌 Annotations</h4>
                  ${test.annotations
                    .map((annotation, idx) => {
                      const isIssueOrBug =
                        annotation.type === "issue" ||
                        annotation.type === "bug";
                      const descriptionText = annotation.description || "";
                      const typeLabel = sanitizeHTML(annotation.type);
                      const descriptionHtml =
                        isIssueOrBug && descriptionText.match(/^[A-Z]+-\d+$/)
                          ? `<a href="#" class="annotation-link" data-annotation="${sanitizeHTML(
                              descriptionText,
                            )}" style="color: var(--info-color); text-decoration: underline; cursor: pointer; font-weight: 600;">${sanitizeHTML(
                              descriptionText,
                            )}</a>`
                          : sanitizeHTML(descriptionText);
                      const locationText = annotation.location
                        ? `<div style="font-size: 0.85em; color: var(--text-tertiary); margin-top: 4px;">Location: ${sanitizeHTML(
                            annotation.location.file,
                          )}:${annotation.location.line}:${
                            annotation.location.column
                          }</div>`
                        : "";
                      return `<div style="margin-bottom: ${
                        idx < test.annotations.length - 1 ? "10px" : "0"
                      };"><strong>Type:</strong> <span style="background-color: rgba(139, 92, 246, 0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.9em;">${typeLabel}</span>${
                        descriptionText
                          ? `<br><strong>Description:</strong> ${descriptionHtml}`
                          : ""
                      }${locationText}</div>`;
                    })
                    .join("")}
                </div>`
              : ""
          }
          <p><strong>Test run Worker ID:</strong> ${sanitizeHTML(
            test.workerId,
          )} [<strong>Total No. of Workers:</strong> ${sanitizeHTML(
            test.totalWorkers,
          )}]</p>
          ${
            test.errorMessage
              ? `<div class="test-error-summary">${formatPlaywrightError(
                  test.errorMessage,
                )}<button class="copy-error-btn" onclick="copyErrorToClipboard(this)" style="margin-top: 8px; padding: 4px 8px; background: #f0f0f0; border: 2px solid #ccc; border-radius: 4px; cursor: pointer; font-size: 12px; border-color: #8B0000; color: #8B0000;" onmouseover="this.style.background='#e0e0e0'" onmouseout="this.style.background='#f0f0f0'">Copy Error Prompt</button></div>`
              : ""
          }
          ${
            test.snippet
              ? `<div class="code-section"><h4>Error Snippet</h4><pre><code>${formatPlaywrightError(
                  test.snippet,
                )}</code></pre></div>`
              : ""
          }
          <h4>Steps</h4>
          <div class="steps-list">${generateStepsHTML(test.steps)}</div>
          
          ${(() => {
            if (!test.stdout || test.stdout.length === 0) return "";
            // FIXED: Now using 'testIndex' which is guaranteed to be defined
            const logId = `stdout-log-${test.id || testIndex}`;
            return `<div class="console-output-section"><h4>Console Output (stdout) <button class="copy-btn" onclick="copyLogContent('${logId}', this)">Copy</button></h4><div class="log-wrapper"><pre id="${logId}" class="console-log stdout-log" style="background-color: var(--bg-tertiary); color: #f3e8c3; padding: 1.25em; border-radius: 0.85em; line-height: 1.2; border: 1px solid var(--border-light);">${formatPlaywrightError(
              test.stdout.map((line) => sanitizeHTML(line)).join("\n"),
            )}</pre></div></div>`;
          })()}
          
          ${(() => {
            if (!test.stderr || test.stderr.length === 0) return "";
            // FIXED: Using 'testIndex'
            const logId = `stderr-log-${test.id || testIndex}`;
            return `<div class="console-output-section"><h4>Console Output (stderr)</h4><pre class="console-log stderr-log" style="background-color: var(--bg-tertiary); color: #f87171; padding: 1.25em; border-radius: 0.85em; line-height: 1.2; border: 1px solid var(--border-light);">${formatPlaywrightError(
              test.stderr.map((line) => sanitizeHTML(line)).join("\n"),
            )}</pre></div>`;
          })()}

          ${(() => {
            if (!test.screenshots || test.screenshots.length === 0) return "";
            const screenshotsHTML = test.screenshots
              .map((screenshotPath, sIndex) => {
                try {
                  const imagePath = path.resolve(
                    DEFAULT_OUTPUT_DIR,
                    screenshotPath,
                  );
                  if (!fsExistsSync(imagePath))
                    return `<div class="attachment-item error">Screenshot not found</div>`;
                  const base64ImageData =
                    readFileSync(imagePath).toString("base64");
                  // LAZY LOAD: Using helper with unique ID
                  return createLazyMedia(
                    base64ImageData,
                    "image/png",
                    "image",
                    sIndex + 1,
                    `screenshot-${testIndex}-${sIndex}.png`,
                  );
                } catch (e) {
                  return `<div class="attachment-item error">Error loading screenshot</div>`;
                }
              })
              .join("");
            return `<div class="attachments-section"><h4>Screenshots</h4><div class="attachments-grid">${screenshotsHTML}</div></div>`;
          })()}

          ${(() => {
            if (!test.videoPath || test.videoPath.length === 0) return "";
            const videosHTML = test.videoPath
              .map((videoPath, vIndex) => {
                try {
                  const videoFilePath = path.resolve(
                    DEFAULT_OUTPUT_DIR,
                    videoPath,
                  );
                  if (!fsExistsSync(videoFilePath))
                    return `<div class="attachment-item error">Video not found</div>`;
                  const videoBase64 =
                    readFileSync(videoFilePath).toString("base64");
                  const ext = path.extname(videoPath).slice(1).toLowerCase();
                  const mime =
                    { mp4: "video/mp4", webm: "video/webm" }[ext] ||
                    "video/mp4";
                  // LAZY LOAD: Using helper with unique ID
                  return createLazyMedia(
                    videoBase64,
                    mime,
                    "video",
                    vIndex + 1,
                    `video-${testIndex}-${vIndex}.${ext}`,
                  );
                } catch (e) {
                  return `<div class="attachment-item error">Error loading video</div>`;
                }
              })
              .join("");
            return `<div class="attachments-section"><h4>Videos</h4><div class="attachments-grid">${videosHTML}</div></div>`;
          })()}

          ${
            test.tracePath
              ? `<div class="attachments-section"><h4>Trace Files</h4><div class="attachments-grid"><div class="attachment-item trace-item"><div class="trace-preview"><span class="trace-icon">📄</span><span class="trace-name">${sanitizeHTML(
                  path.basename(test.tracePath),
                )}</span></div><div class="attachment-info"><div class="trace-actions"><a href="${sanitizeHTML(
                  test.tracePath,
                )}" target="_blank" download="${sanitizeHTML(
                  path.basename(test.tracePath),
                )}" class="download-trace">Download Trace</a></div></div></div></div></div>`
              : ""
          }
          ${
            test.attachments && test.attachments.length > 0
              ? `<div class="attachments-section"><h4>Other Attachments</h4><div class="attachments-grid">${test.attachments
                  .map(
                    (attachment) =>
                      `<div class="attachment-item generic-attachment"><div class="attachment-icon">${getAttachmentIcon(
                        attachment.contentType,
                      )}</div><div class="attachment-caption"><span class="attachment-name" title="${sanitizeHTML(
                        attachment.name,
                      )}">${sanitizeHTML(
                        attachment.name,
                      )}</span><span class="attachment-type">${sanitizeHTML(
                        attachment.contentType,
                      )}</span></div><div class="attachment-info"><div class="trace-actions"><a href="${sanitizeHTML(
                        attachment.path,
                      )}" target="_blank" class="view-full">View</a><a href="${sanitizeHTML(
                        attachment.path,
                      )}" target="_blank" download="${sanitizeHTML(
                        attachment.name,
                      )}" class="download-trace">Download</a></div></div></div>`,
                  )
                  .join("")}</div></div>`
              : ""
          }
          ${
            test.codeSnippet
              ? `<div class="code-section"><h4>Code Snippet</h4><pre><code>${formatPlaywrightError(
                  sanitizeHTML(test.codeSnippet),
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
    <link rel="icon" type="image/png" href="https://ocpaxmghzmfbuhxzxzae.supabase.co/storage/v1/object/public/images/pulse-report/playwright_pulse_icon.png">
    <link rel="apple-touch-icon" href="https://ocpaxmghzmfbuhxzxzae.supabase.co/storage/v1/object/public/images/pulse-report/playwright_pulse_icon.png">
    <!-- Preconnect to external domains -->
    <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://code.highcharts.com">
    
    <!-- Preload critical font -->
    <link rel="preload" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
    <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap"></noscript>
    
    <script src="https://code.highcharts.com/highcharts.js" defer></script>
    <title>Pulse Static Report</title>
    
<style>
        :root { 
  --primary-color: #f9fafb; --primary-dark: #e5e7eb; --primary-light: #ffffff;
  --secondary-color: #d1d5db; --secondary-dark: #9ca3af; --secondary-light: #f3f4f6;
  --accent-color: #ffffff; --accent-alt: #a3a3a3;
  --success-color: #34d399; --success-dark: #10b981; --success-light: #6ee7b7;
  --danger-color: #f87171; --danger-dark: #ef4444; --danger-light: #fca5a5;
  --warning-color: #fbbf24; --warning-dark: #f59e0b; --warning-light: #fcd34d;
  --info-color: #9ca3af; 
  --text-primary: #f9fafb; --text-secondary: #e5e7eb; --text-tertiary: #d1d5db;
  --bg-primary: #000000; --bg-secondary: #0a0a0a; --bg-tertiary: #050505;
  --bg-card: #0d0d0d; --bg-card-hover: #121212;
  --border-light: #1a1a1a; --border-medium: #262626; --border-dark: #333333;
  --light-gray-color: #262626; --medium-gray-color: #333333; --dark-gray-color: #a3a3a3;
  --text-color: #f9fafb; --text-color-secondary: #e5e7eb; --border-color: #262626;
  --card-background-color: #0d0d0d;
  --font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px; --radius-2xl: 24px;
  --shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.8);
  --shadow-sm: 0 2px 4px 0 rgba(0, 0, 0, 0.9);
  --shadow-md: 0 4px 8px -1px rgba(0, 0, 0, 0.9);
  --shadow-lg: 0 8px 16px -2px rgba(0, 0, 0, 0.95);
  --shadow-xl: 0 12px 24px -4px rgba(0, 0, 0, 0.95);
  --shadow-2xl: 0 20px 40px -8px rgba(0, 0, 0, 1);
  --box-shadow: 0 8px 20px rgba(0,0,0,0.8);
  --box-shadow-light: 0 4px 12px rgba(0,0,0,0.7);
  --box-shadow-inset: inset 0 1px 3px rgba(0,0,0,0.9);
  --glow-primary: 0 0 20px rgba(255, 255, 255, 0.1);
  --glow-success: 0 0 20px rgba(52, 211, 153, 0.2);
  --glow-danger: 0 0 20px rgba(248, 113, 113, 0.2);
  --gradient-primary: linear-gradient(135deg, #ffffff 0%, #a3a3a3 100%);
  --gradient-card: linear-gradient(145deg, #0d0d0d 0%, #0a0a0a 100%);
  --gradient-border: linear-gradient(145deg, #1a1a1a 0%, #262626 100%);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
        ::selection { background: var(--primary-color); color: #000000; }
        ::-webkit-scrollbar { width: 0; height: 0; display: none; }
        ::-webkit-scrollbar-track { display: none; }
        ::-webkit-scrollbar-thumb { display: none; }
        ::-webkit-scrollbar-thumb:hover { display: none; }
        * { scrollbar-width: none; -ms-overflow-style: none; }
        .trend-chart-container, .test-history-trend div[id^="testHistoryChart-"] { min-height: 100px; }
        .lazy-load-chart .no-data, .lazy-load-chart .no-data-chart { display: flex; align-items: center; justify-content: center; height: 100%; font-style: italic; color: var(--dark-gray-color); }
        .highcharts-background { fill: transparent; }
        .highcharts-title, .highcharts-subtitle { font-family: var(--font-family); }
        .highcharts-axis-labels text, .highcharts-legend-item text { fill: var(--text-color-secondary) !important; font-size: 12px !important; }
        .highcharts-axis-title { fill: var(--text-color) !important; }
        .highcharts-tooltip > span { background-color: rgba(0,0,0,0.95) !important; border: 1px solid var(--border-light) !important; color: var(--text-primary) !important; padding: 12px !important; border-radius: 8px !important; box-shadow: var(--shadow-xl) !important; }
        body { 
          font-family: var(--font-family); 
          margin: 0; 
          background: radial-gradient(ellipse at top, #0a0a0a 0%, #000000 50%, #000000 100%);
          background-attachment: fixed;
          color: var(--text-primary); 
          line-height: 1.6; 
          font-size: 15px;
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
        * {
          transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        }
        *:not(input):not(select):not(textarea):not(button) {
          transition-duration: 0.2s;
        }
        .container { 
          padding: 0; 
          margin: 0;
          max-width: 100%;
        }
.header { 
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 32px 48px 28px 48px;
          border-bottom: 1px solid var(--border-light);
          background: var(--gradient-card);
          backdrop-filter: blur(10px);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8), inset 0 -1px 0 rgba(255, 255, 255, 0.05);
        }
        .header-title { 
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .header h1 { 
          margin: 0; 
          font-size: 2.5em; 
          font-weight: 900; 
          color: #f9fafb;
          line-height: 1;
          letter-spacing: -0.03em;
        }
        #report-logo { 
          height: 60px; 
        }
        .run-info { 
          display: flex;
          gap: 0;
          align-items: stretch;
          background: var(--gradient-card);
          border-radius: 14px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--border-light);
          overflow: hidden;
        }
        .run-info-item {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 20px 32px;
          position: relative;
          flex: 1;
          min-width: fit-content;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .run-info-item:hover {
          transform: translateY(-2px);
        }
        .run-info-item:not(:last-child)::after {
          content: '';
          position: absolute;
          right: 0;
          top: 20%;
          bottom: 20%;
          width: 1px;
          background: linear-gradient(to bottom, transparent, var(--border-medium) 20%, var(--border-medium) 80%, transparent);
        }
        .run-info-item:first-child {
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            padding: 10px;
            border-radius: 5px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        .run-info-item:last-child {
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          padding: 10px;
          border-radius: 5px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        .run-info strong { 
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.7em;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-tertiary);
          margin: 0;
          font-weight: 700;
        }
        .run-info strong::before {
          content: '';
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          opacity: 0.6;
        }
        .run-info-item:first-child strong {
          color: var(--warning-light);
        }
        .run-info-item:last-child strong {
          color: var(--secondary-light);
        }
        .run-info span {
          font-size: 1.35em;
          font-weight: 800;
          color: #f9fafb;
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          letter-spacing: -0.02em;
          line-height: 1.2;
          white-space: nowrap;
        }
        .tabs { 
          display: flex;
          background: #000000;
          padding: 0;
          margin: 0;
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid var(--border-light);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
        }
        .tab-button { 
          flex: 1;
          padding: 24px 32px; 
          background: transparent; 
          border: none; 
          cursor: pointer; 
          font-size: 0.85em; 
          font-weight: 700; 
          color: var(--dark-gray-color); 
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
          white-space: nowrap;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          border-right: 1px solid var(--border-light);
          position: relative;
        }
        .tab-button::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--gradient-primary);
          transform: scaleX(0);
          transition: transform 0.3s ease;
        }
        .tab-button:last-child { border-right: none; }
        .tab-button:hover { 
          background: var(--bg-card);
          color: var(--text-primary); 
        }
        .tab-button:hover::after {
          transform: scaleX(0.5);
        }
        .tab-button.active { 
          background: var(--gradient-card);
          color: var(--primary-color);
          box-shadow: inset 0 -2px 0 var(--primary-color);
          color: var(--text-primary);
        }
        .tab-content { display: none; animation: fadeIn 0.4s ease-out; }
        .tab-content.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.dashboard-grid { 
          display: grid; 
          grid-template-columns: repeat(4, 1fr); 
          gap: 0;
          margin: 0 0 40px 0;
        }
        .browser-breakdown {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 6px;
        }
        .browser-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.95em;
        }
        .browser-name {
          font-weight: 700;
          color: #f9fafb;
          text-transform: capitalize;
          font-size: 1.05em;
        }
        .browser-stats {
          color: #9ca3af;
          font-weight: 700;
          font-size: 0.95em;
        }
        .trend-chart-container, .test-history-trend div[id^="testHistoryChart-"] { 
          min-height: 100px; 
        }
        .lazy-load-chart .no-data, .lazy-load-chart .no-data-chart { 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          height: 100%; 
          font-style: italic; 
          color: #9ca3af; 
        }
        .highcharts-background { 
          fill: transparent; 
        }
        .highcharts-title, .highcharts-subtitle { 
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
        }
        .highcharts-axis-labels text, .highcharts-legend-item text { 
          fill: var(--text-secondary) !important; 
          font-size: 12px !important; 
        }
        .highcharts-axis-title { 
          fill: var(--text-primary) !important; 
        }
        .highcharts-tooltip > span { 
          background-color: rgba(10,10,10,0.92) !important; 
          border-color: rgba(10,10,10,0.92) !important; 
          color: var(--text-primary) !important; 
          padding: 10px !important; 
          border-radius: 6px !important; 
        }
        .env-dashboard {
          background: var(--gradient-card);
          border: 1px solid var(--border-light);
          border-radius: 12px;
          padding: 24px;
          margin-top: 20px;
          box-shadow: var(--shadow-md);
        }
        .env-dashboard-title {
          font-size: 1.2em;
          font-weight: 700;
          color: #f9fafb;
          margin-bottom: 8px;
        }
        .env-dashboard-subtitle {
          font-size: 0.9em;
          color: #9ca3af;
          margin-bottom: 16px;
        }
        .env-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 12px;
        }
        .env-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: 8px;
          padding: 14px;
          transition: all 0.3s ease;
        }
        .env-card:hover {
          transform: translateY(-3px);
          border-color: var(--primary-color);
          box-shadow: var(--shadow-lg), var(--glow-primary);
          background: var(--bg-card);
        }
        .env-card-header {
          font-size: 0.85em;
          color: #9ca3af;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .env-card-value {
          font-size: 1.1em;
          color: #f9fafb;
          font-weight: 700;
          word-break: break-word;
        }
        .suites-widget {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 32px 48px;
          border-radius: 8px;
        }
        .suites-header h2 {
          font-size: 1.4em;
          margin-bottom: 20px;
          color: #f9fafb;
          font-weight: 700;
        }
        .suites-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }
        .suite-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: 8px;
          padding: 20px;
          transition: all 0.2s ease;
        }
        .suite-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          border-color: var(--primary-color);
        }
        .suite-name {
          font-size: 1.1em;
          font-weight: 700;
          margin-bottom: 12px;
          color: #f9fafb;
        }
        .suite-stats {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .suite-stat {
          font-size: 0.9em;
          padding: 4px 10px;
          border-radius: 4px;
          font-weight: 600;
        }
        .suite-stat.passed {
          background: rgba(52, 211, 153, 0.15);
          color: var(--success-color);
        }
        .suite-stat.failed {
          background: rgba(248, 113, 113, 0.15);
          color: var(--danger-color);
        }
        .suite-stat.skipped {
          background: rgba(251, 191, 36, 0.15);
          color: var(--warning-color);
        }
        .annotations-section {
          margin: 12px 0;
          padding: 12px;
          background-color: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-left: 4px solid var(--secondary-color);
          border-radius: 4px;
        }
        .annotations-section h4 {
          margin-top: 0;
          margin-bottom: 10px;
          color: var(--secondary-color);
          font-size: 1.1em;
        }
        .annotation-link {
          color: var(--info-color);
          text-decoration: underline;
          cursor: pointer;
        }
        .annotation-link:hover {
          color: var(--info-color);
        }
        .generic-attachment {
          text-align: center;
          padding: 1rem;
          justify-content: center;
        }
        .attachment-icon {
          font-size: 2.5rem;
          display: block;
          margin-bottom: 0.75rem;
        }
        .attachment-name {
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #f9fafb;
        }
        .attachment-type {
          font-size: 0.8rem;
          color: #9ca3af;
        }
.status-passed .value, .stat-passed svg { 
          color: #10b981; 
        }
        .status-failed .value, .stat-failed svg { 
          color: var(--danger-color); 
        }
        .status-skipped .value, .stat-skipped svg { 
          color: #f59e0b; 
        }
        .summary-card.status-passed { 
          background: rgba(16, 185, 129, 0.08); 
        }
        .summary-card.status-passed:hover { 
          background: rgba(16, 185, 129, 0.15); 
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
        }
        .summary-card.status-passed .value { 
          color: #10b981; 
        }
        .summary-card.status-failed { 
          background: rgba(239, 68, 68, 0.08); 
        }
        .summary-card.status-failed:hover { 
          background: rgba(239, 68, 68, 0.15); 
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
        }
        .summary-card.status-failed .value { 
          color: var(--danger-color); 
        }
        .summary-card.status-skipped { 
          background: rgba(245, 158, 11, 0.08); 
        }
        .summary-card.status-skipped:hover { 
          background: rgba(245, 158, 11, 0.15); 
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
        }
        .summary-card.status-skipped .value { 
          color: #f59e0b; 
        }
        .summary-card:not([class*='status-']) .value { 
          color: #f9fafb; 
        }
.dashboard-bottom-row { 
          display: grid; 
          grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); 
          gap: 28px; 
          align-items: start; 
        }
        .dashboard-column { 
          display: flex; 
          flex-direction: column; 
          gap: 28px; 
        }
        .pie-chart-wrapper, .suites-widget, .trend-chart { 
          background: rgba(31, 41, 55, 0.95);
          padding: 48px; 
          border: 1px solid var(--border-light);
          border-radius: 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          display: flex; 
          flex-direction: column;
          overflow: visible;
          margin-bottom: 24px;
        }
        .pie-chart-wrapper {
          position: relative;
        }
        .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3, .chart-title-header { 
          text-align: left; 
          margin: 0 0 40px 0; 
          font-size: 1.8em; 
          font-weight: 900; 
          color: #f9fafb;
          letter-spacing: -0.02em;
        }
        .trend-chart-container, .pie-chart-wrapper div[id^="pieChart-"] { 
          flex-grow: 1; 
          min-height: 250px; 
          width: 100%;
          overflow: visible;
        }
.status-badge-small-tooltip { 
          padding: 2px 5px; 
          border-radius: 3px; 
          font-size: 0.9em; 
          font-weight: 600; 
          color: white; 
          text-transform: uppercase; 
        }
        .status-badge-small-tooltip.status-passed { 
          background-color: var(--success-dark); 
        }
        .status-badge-small-tooltip.status-failed { 
          background-color: var(--danger-dark); 
        }
        .status-badge-small-tooltip.status-skipped { 
          background-color: var(--warning-dark); 
        }
        .status-badge-small-tooltip.status-unknown { 
          background-color: #9ca3af; 
        }
        .suites-header { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          margin-bottom: 20px; 
        }
        .summary-badge { 
          background-color: var(--border-light); 
          color: var(--text-secondary); 
          padding: 7px 14px; 
          border-radius: 16px; 
          font-size: 0.9em; 
        }
        .suites-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); 
          gap: 20px; 
        }
        .suite-card { 
          border: none; 
          border-left: 4px solid var(--border-light); 
          padding: 24px; 
          background-color: var(--bg-card); 
          transition: all 0.15s ease; 
        }
        .suite-card:hover { 
          background: rgba(255, 255, 255, 0.03); 
          border-left-color: var(--border-medium); 
        }
        .suite-card.status-passed { 
          border-left-color: #10b981; 
        }
        .suite-card.status-passed:hover { 
          background: rgba(16, 185, 129, 0.05); 
        }
        .suite-card.status-failed { 
          border-left-color: #ef4444; 
        }
        .suite-card.status-failed:hover { 
          background: rgba(239, 68, 68, 0.05); 
        }
        .suite-card.status-skipped { 
          border-left-color: #f59e0b; 
        }
        .suite-card.status-skipped:hover { 
          background: rgba(245, 158, 11, 0.05); 
        }
        .suite-card-header { 
          display: flex; 
          justify-content: space-between; 
          align-items: flex-start; 
          margin-bottom: 12px; 
        }
        .suite-name { 
          font-weight: 600; 
          font-size: 1.05em; 
          color: #f9fafb; 
          margin-right: 10px; 
          word-break: break-word;
        }
        .browser-tag { 
          font-size: 0.85em; 
          font-weight: 600;
          background: linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(59, 130, 246, 0.15) 100%); 
          color: #93c5fd; 
          padding: 6px 12px; 
          border-radius: var(--radius-sm); 
          border: 1px solid rgba(96, 165, 250, 0.3);
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          box-shadow: 0 2px 8px rgba(96, 165, 250, 0.15), inset 0 1px 0 rgba(96, 165, 250, 0.2);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
          letter-spacing: 0.3px;
        }
        .suite-card-body .test-count { 
          font-size: 0.95em; 
          color: #d1d5db; 
          display: block; 
          margin-bottom: 10px; 
        }
        .suite-stats { 
          display: flex; 
          gap: 14px; 
          font-size: 0.95em; 
          align-items: center; 
        }
        .suite-stats span { 
          display: flex; 
          align-items: center; 
          gap: 6px; 
        }
        .suite-stats svg { 
          vertical-align: middle; 
          font-size: 1.15em; 
        }
.test-case { 
          margin: 0 0 20px 0;
          padding: 0;
          border: 1px solid var(--border-light);
          border-radius: 14px;
          background: var(--gradient-card);
          box-shadow: var(--shadow-sm);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          content-visibility: auto;
          contain-intrinsic-size: auto 100px;
          position: relative;
        }
        .test-case::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 14px;
          padding: 1px;
          background: var(--gradient-border);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .test-case:hover {
          box-shadow: var(--shadow-lg), var(--glow-primary);
          transform: translateY(-3px);
          background: var(--bg-card-hover);
        }
        .test-case:hover::before {
          opacity: 1;
        }
        .test-case:last-child {
          margin-bottom: 0;
        }
        .test-case-header {  
          padding: 22px 28px; 
          background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%);
          cursor: pointer; 
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          gap: 14px 20px; 
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border-bottom: 1px solid var(--border-light);
          position: relative;
          will-change: transform;
          transform: translateZ(0);
          }
        .test-case-header::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: transparent;
          transition: all 0.3s ease;
          box-shadow: 0 0 0 rgba(129, 140, 248, 0);
        }
        .test-case-header:hover::before {
          background: var(--gradient-primary);
          width: 4px;
          box-shadow: 0 0 8px rgba(129, 140, 248, 0.4), 0 0 16px rgba(129, 140, 248, 0.2);
        }
        .test-case-header[aria-expanded="true"] { 
          background: linear-gradient(135deg, var(--bg-tertiary) 0%, #000000 100%);
          border-bottom-color: var(--border-medium);
        }
        .test-case-header[aria-expanded="true"]::before {
          background: var(--gradient-primary);
          width: 4px;
          box-shadow: 0 0 12px rgba(129, 140, 248, 0.5), 0 0 24px rgba(129, 140, 248, 0.3);
        }
        .test-case-summary { 
          display: flex; 
          align-items: center;
          gap: 14px; 
          flex-wrap: wrap;
          min-width: 0;
          grid-column: 1;
          grid-row: 1;
        }
        .test-case-title { 
          font-weight: 600; 
          color: #f9fafb; 
          font-size: 1em;
          word-break: break-word;
          overflow-wrap: break-word;
          flex: 1 1 100%;
          min-width: 0;
        }
        .test-case-browser { 
          font-size: 0.9em; 
          color: #d1d5db; 
        }
.test-case-meta { 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          font-size: 0.9em; 
          color: #d1d5db; 
          flex-wrap: wrap;
          min-width: 0;
          grid-column: 1;
          grid-row: 2;
        }
        .test-case-status-duration {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          grid-column: 2;
          grid-row: 1 / 3;
          align-self: center;
        }
        .test-duration { 
          background-color: var(--border-light); 
          padding: 6px 12px; 
          border-radius: 8px; 
          font-size: 0.9em;
          white-space: nowrap;
          flex-shrink: 0;
          font-weight: 700;
          color: #f9fafb;
        }
        .status-badge { 
          padding: 8px 20px; 
          border-radius: 0; 
          font-size: 0.7em; 
          font-weight: 800; 
          color: white; 
          text-transform: uppercase; 
          min-width: 100px; 
          text-align: center;
          letter-spacing: 1px;
        }
        .status-badge.status-passed { 
          background: var(--success-color); 
        }
        .status-badge.status-failed { 
          background: var(--danger-color); 
        }
        .status-badge.status-skipped { 
          background: var(--warning-color); 
        }
        .status-badge.status-unknown { 
          background: var(--dark-gray-color); 
        }
.tag { 
          display: inline-flex;
          align-items: center;
          background: var(--gradient-primary);
          color: #000000;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 0.8em;
          margin-right: 8px;
          margin-bottom: 4px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          box-shadow: var(--shadow-sm), 0 0 8px rgba(129, 140, 248, 0.3);
          transition: all 0.2s ease;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .tag:hover {
          box-shadow: var(--shadow-md), var(--glow-primary);
          transform: translateY(-1px);
        }
.test-case-content { 
          display: none; 
          padding: 28px; 
          background: linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(13, 13, 13, 0.98) 100%); 
          border-top: 2px solid rgba(99, 102, 241, 0.2); 
          border-left: 1px solid var(--border-medium);
          border-right: 1px solid var(--border-medium);
          border-bottom: 1px solid var(--border-medium);
          border-radius: 0 0 var(--radius-md) var(--radius-md);
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.4);
        }
        .test-case-content h4 { 
          margin-top: 22px; 
          margin-bottom: 14px; 
          font-size: 1.15em; 
          color: var(--primary-dark); 
        }
        .test-case-content p { 
          margin-bottom: 10px; 
          font-size: 1em; 
        }
        .test-error-summary { 
          margin-bottom: 20px; 
          padding: 14px; 
          background-color: rgba(248,113,113,0.08); 
          border: 1px solid rgba(248,113,113,0.25); 
          border-left: 4px solid var(--danger-color); 
          border-radius: 4px; 
        }
        .test-error-summary h4 { 
          color: #ef4444; 
          margin-top: 0;
        }
        .test-error-summary pre { 
          white-space: pre-wrap; 
          word-break: break-all; 
          color: #ef4444; 
          font-size: 0.95em;
        }
.steps-list { 
          margin: 18px 0; 
        }
        @supports (content-visibility: auto) {
          .tab-content,
          #test-runs .test-case,
          .attachments-section,
          .test-history-card,
          .trend-chart,
          .suite-card {
            content-visibility: auto;
            contain-intrinsic-size: 1px 600px;
          }
        }
        .test-case,
        .test-history-card,
        .suite-card,
        .attachments-section {
          contain: content;
        }
        .attachments-grid .attachment-item img.lazy-load-image {
          width: 100%;
          aspect-ratio: 4 / 3;
          object-fit: cover;
        }
        .attachments-grid .attachment-item.video-item {
          aspect-ratio: 16 / 9;
        }

.step-item { 
          margin-bottom: 8px; 
          padding-left: calc(var(--depth, 0) * 28px); 
        }
        .step-header { 
          display: flex; 
          align-items: center; 
          cursor: pointer; 
          padding: 10px 14px; 
          border-radius: 6px; 
          background-color: #1f2937; 
          border: 1px solid #374151; 
          transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; 
        }
        .step-header:hover { 
          background-color: #374151; 
          border-color: var(--border-medium); 
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); 
        }
        .step-icon { 
          margin-right: 12px; 
          width: 20px; 
          text-align: center; 
          font-size: 1.1em; 
        }
        .step-title { 
          flex: 1; 
          font-size: 1em; 
        }
        .step-duration { 
          color: #9ca3af; 
          font-size: 0.9em; 
        }
        .step-details { 
          display: none; 
          padding: 14px; 
          margin-top: 8px; 
          background: var(--bg-secondary); 
          border-radius: 6px; 
          font-size: 0.95em; 
          border: 1px solid #374151; 
        }
        .step-info { 
          margin-bottom: 8px; 
        }
        .test-error-summary { 
          color: #ef4444; 
          margin-top: 12px; 
          padding: 14px; 
          background: rgba(248,113,113,0.08); 
          border-radius: 4px; 
          font-size: 0.95em; 
          border-left: 3px solid var(--danger-color); 
        }
        .test-error-summary pre.stack-trace { 
          margin-top: 10px; 
          padding: 12px; 
          background-color: rgba(0,0,0,0.2); 
          border-radius: 4px; 
          font-size: 0.9em; 
          max-height: 280px; 
          overflow-y: auto; 
          white-space: pre-wrap; 
          word-break: break-all; 
        }
        .step-hook { 
          background-color: rgba(96, 165, 250, 0.08); 
          border-left: 3px solid var(--info-color) !important; 
        }
        .step-hook .step-title { 
          font-style: italic; 
          color: var(--info-color);
        }
        .ai-modal-overlay { 
          position: fixed; 
          top: 0; 
          left: 0; 
          width: 100%; 
          height: 100%; 
          background-color: rgba(0,0,0,0.95); 
          display: none; 
          align-items: center; 
          justify-content: center; 
          z-index: 1050; 
          animation: fadeIn 0.3s;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .ai-modal-content { 
          background-color: #1f2937; 
          color: #f9fafb; 
          border-radius: 8px; 
          width: 90%; 
          max-width: 800px; 
          max-height: 90vh;
          box-shadow: var(--shadow-2xl); 
          display: flex; 
          flex-direction: column; 
          overflow: hidden;
        }
        .ai-modal-header { 
          padding: 18px 25px; 
          border-bottom: 1px solid var(--border-medium); 
          display: flex; 
          justify-content: space-between; 
          align-items: center;
        }
        .ai-modal-header h3 { 
          margin: 0; 
          font-size: 1.25em;
        }
        .ai-modal-close { 
          font-size: 2rem; 
          font-weight: 300; 
          cursor: pointer; 
          color: #9ca3af; 
          line-height: 1; 
          transition: color 0.2s;
          background: none;
          border: none;
          padding: 0;
        }
        .ai-modal-close:hover { 
          color: #ef4444;
        }
        .ai-modal-body { 
          padding: 25px; 
          overflow-y: auto;
        }
        .ai-modal-body h4 { 
          margin-top: 18px; 
          margin-bottom: 10px; 
          font-size: 1.1em; 
          color: var(--primary-color); 
        }
        .ai-modal-body p { 
          margin-bottom: 15px; 
        }
        .ai-loader { 
          margin: 40px auto; 
          border: 5px solid var(--border-light); 
          border-top: 5px solid var(--primary-color); 
          border-radius: 50%; 
          width: 50px; 
          height: 50px; 
          animation: spin 1s linear infinite; 
        }
        @keyframes spin { 
          0% { transform: rotate(0deg); } 
          100% { transform: rotate(360deg); } 
        }
        .ai-suggestion-container {
            margin-top: 15px;
            border-top: 2px solid var(--border-light);
            background: var(--gradient-card);
            animation: slideDown 0.3s ease-out;
        }
        @keyframes slideDown {
            from {
                opacity: 0;
                max-height: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                max-height: 1000px;
                transform: translateY(0);
            }
        }
        .ai-suggestion-content {
            padding: 20px;
        }
        .ai-suggestion-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--primary-color);
        }
        .ai-suggestion-header h4 {
            margin: 0;
            color: var(--primary-color);
            font-size: 1.1em;
            font-weight: 700;
        }
        .ai-suggestion-body {
            color: #f9fafb;
            line-height: 1.6;
        }
        .ai-suggestion-body h4 {
            color: #6366f1;
            margin-top: 15px;
            margin-bottom: 8px;
            font-size: 1em;
        }
        .ai-suggestion-body p {
            margin-bottom: 10px;
        }
        .ai-suggestion-body pre {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            padding: 14px;
            border-radius: 8px;
            overflow-x: auto;
            font-size: 0.9em;
            border: 1px solid var(--border-light);
        }
        .nested-steps { 
          margin-top: 12px; 
        }
        .attachments-section { 
          margin-top: 32px; 
          padding-top: 24px; 
          border-top: 1px solid var(--border-light); 
        }
        .attachments-section h4 { 
          margin-top: 0; 
          margin-bottom: 20px; 
          font-size: 1.1em; 
          color: #f9fafb; 
        }
        .attachments-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); 
          gap: 22px; 
        }
.attachment-item { 
          border: 1px solid var(--border-light); 
          border-radius: 10px; 
          background: var(--gradient-card); 
          box-shadow: var(--shadow-sm); 
          display: flex; 
          flex-direction: column; 
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
          overflow: hidden;
        }
        .attachment-item:hover { 
          transform: translateY(-5px); 
          box-shadow: var(--shadow-lg), var(--glow-primary);
          border-color: var(--primary-color); 
        }
        .attachment-item img, .attachment-item video { 
          width: 100%; 
          height: 180px; 
          object-fit: cover; 
          display: block; 
          background-color: #6b7280; 
          border-bottom: 1px solid var(--border-light); 
          transition: opacity 0.3s ease; 
        }
        .attachment-info { 
          padding: 12px; 
          margin-top: auto; 
          background-color: #374151;
        }
        .attachment-item a:hover img { 
          opacity: 0.85; 
        }
        .attachment-caption { 
          padding: 12px 15px; 
          font-size: 0.9em; 
          text-align: center; 
          color: #d1d5db; 
          word-break: break-word; 
          background-color: #374151; 
        }
        .video-item a, .trace-item a { 
          display: block; 
          margin-bottom: 8px; 
          color: #6366f1; 
          text-decoration: none; 
          font-weight: 500; 
        }
        .video-item a:hover, .trace-item a:hover { 
          text-decoration: underline; 
        }
        .code-section pre { 
          background-color: #111827; 
          color: #f9fafb; 
          padding: 20px; 
          border-radius: 6px; 
          overflow-x: auto; 
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; 
          font-size: 0.95em; 
          line-height: 1.6;
        }
.trend-charts-row { 
          display: grid; 
          grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); 
          gap: 28px; 
          margin-bottom: 35px; 
        }
        .test-history-container h2.tab-main-title, .ai-analyzer-container h2.tab-main-title { 
          font-size: 1.6em; 
          margin-bottom: 18px; 
          color: #6366f1; 
          border-bottom: 1px solid #4b5563; 
          padding-bottom: 12px;
        }
        .test-history-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); 
          gap: 22px; 
          margin-top: 22px; 
        }
        .test-history-card { 
          background: var(--bg-card); 
          border: 1px solid var(--border-medium); 
          border-radius: 8px; 
          padding: 22px; 
          box-shadow: 0 3px 8px rgba(0,0,0,0.3); 
          display: flex; 
          flex-direction: column; 
        }
        .test-history-header { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          margin-bottom: 20px; 
          padding-bottom: 14px; 
          border-bottom: 1px solid #374151; 
        }
        .test-history-header h3 { 
          margin: 0; 
          font-size: 1.15em; 
          white-space: nowrap; 
          overflow: hidden; 
          text-overflow: ellipsis; 
        }
        .test-history-header p { 
          font-weight: 500; 
        }
        .test-history-trend { 
          margin-bottom: 20px; 
          min-height: 110px; 
        }
        .test-history-trend-section {
          padding: 0px 48px !important;
        }
        .test-history-trend-section .chart-title-header {
          margin: 0 0 20px 0 !important;
        }
        .test-history-trend div[id^="testHistoryChart-"] { 
          display: block; 
          margin: 0 auto; 
          max-width: 100%; 
          height: 100px; 
          width: 320px; 
        }
        .test-history-details-collapsible summary { 
          cursor: pointer; 
          font-size: 1em; 
          color: #6366f1; 
          margin-bottom: 10px; 
          font-weight: 500; 
        }
        .test-history-details-collapsible summary:hover {
          text-decoration: underline;
        }
        .test-history-details table { 
          width: 100%; 
          border-collapse: collapse; 
          font-size: 0.95em; 
        }
        .test-history-details th, .test-history-details td { 
          padding: 9px 12px; 
          text-align: left; 
          border-bottom: 1px solid #374151; 
        }
        .test-history-details th { 
          background-color: #374151; 
          font-weight: 600; 
        }
        .status-badge-small { 
          padding: 3px 7px; 
          border-radius: 4px; 
          font-size: 0.8em; 
          font-weight: 600; 
          color: white; 
          text-transform: uppercase; 
          display: inline-block; 
        }
        .status-badge-small.status-passed { 
          background-color: #10b981; 
        }
        .status-badge-small.status-failed { 
          background-color: #ef4444; 
        }
        .status-badge-small.status-skipped { 
          background-color: #f59e0b; 
        }
        .status-badge-small.status-unknown { 
          background-color: var(--dark-gray-color); 
        }
.badge-severity { 
          display: inline-block; 
          padding: 4px 8px; 
          border-radius: 4px; 
          font-size: 11px; 
          font-weight: 700; 
          color: white; 
          text-transform: uppercase; 
          margin-right: 8px; 
          vertical-align: middle; 
        }
.badge-severity.critical {
          background: var(--danger-dark);
        }
        .badge-severity.high {
          background: var(--danger-color);
        }
        .badge-severity.medium {
          background: var(--warning-color);
        }
        .badge-severity.low {
          background: var(--success-color);
        }
.badge-severity.info {
          background: var(--info-color);
        }
        #clear-run-summary-filters {
          background: var(--bg-tertiary);
          color: white;
          border: none;
          padding: 14px 32px;
          border-radius: 0;
          cursor: pointer;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-size: 0.8em;
          transition: all 0.15s ease;
        }
        .code-section pre {
          background-color: var(--bg-tertiary);
          color: #e2e8f0;
          padding: 20px;
          border-radius: 6px;
          overflow-x: auto;
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
          font-size: 0.95em;
          line-height: 1.6;
          border: 1px solid #374151;
        }
        .trace-actions {
          display: flex;
          justify-content: center;
          gap: 8px;
        }
        .trace-actions a {
          text-decoration: none;
          color: var(--info-color);
          font-weight: 500;
          font-size: 0.9em;
          transition: color 0.2s ease;
        }
.trace-actions a:hover {
          color: #3b82f6;
          text-decoration: underline;
        }
        .attachment-caption {
          display: flex;
          flex-direction: column;
          padding: 12px 15px;
          background-color: #374151;
          color: #d1d5db;
        }
        .attachment-name {
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #f9fafb;
        }
        .attachment-type {
          font-size: 0.8rem;
          color: #9ca3af;
          margin-top: 4px;
        }
        .container { 
          padding: 0; 
          margin: 0;
          max-width: 100%;
        }
        .tab-content { 
          display: none; 
          animation: fadeIn 0.4s ease-out; 
        }
        .tab-content.active { 
          display: block; 
        }
        @keyframes fadeIn {
          from { 
            opacity: 0; 
            transform: translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }
        .test-cases-list {
          padding: 48px;
        }
        .header { 
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 32px 40px 28px 40px;
          border-bottom: 1px solid var(--border-light);
          background: var(--gradient-card);
        }
        .header-title { 
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .header h1 { 
          margin: 0; 
          font-size: 2.5em; 
          font-weight: 900; 
          color: #f9fafb;
          line-height: 1;
          letter-spacing: -0.03em;
        }
        #report-logo { 
          height: 60px; 
        }
        .run-info { 
          display: flex;
          gap: 16px;
          align-items: stretch;
          background: transparent;
          border-radius: 12px;
          padding: 0;
        }
        .run-info-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px 28px;
          position: relative;
          flex: 1;
          min-width: fit-content;
        }

        .run-info-item:first-child {
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(245, 158, 11, 0.15) 50%, rgba(217, 119, 6, 0.1) 100%);
          border: 1px solid rgba(251, 191, 36, 0.3);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 16px rgba(251, 191, 36, 0.2), inset 0 1px 0 rgba(251, 191, 36, 0.25), 0 0 40px rgba(251, 191, 36, 0.08);
        }
        .run-info-item:first-child:hover {
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.28) 0%, rgba(245, 158, 11, 0.22) 50%, rgba(217, 119, 6, 0.15) 100%);
          border-color: rgba(251, 191, 36, 0.4);
          box-shadow: 0 8px 24px rgba(251, 191, 36, 0.3), inset 0 1px 0 rgba(251, 191, 36, 0.35), 0 0 50px rgba(251, 191, 36, 0.15);
        }
        .run-info-item:last-child {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.18) 0%, rgba(124, 58, 237, 0.12) 50%, rgba(109, 40, 217, 0.08) 100%);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 16px rgba(139, 92, 246, 0.2), inset 0 1px 0 rgba(139, 92, 246, 0.25), 0 0 40px rgba(139, 92, 246, 0.08);
        }
        .run-info-item:last-child:hover {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(124, 58, 237, 0.18) 50%, rgba(109, 40, 217, 0.12) 100%);
          border-color: rgba(139, 92, 246, 0.4);
          box-shadow: 0 8px 24px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(139, 92, 246, 0.35), 0 0 50px rgba(139, 92, 246, 0.15);
        }
        .run-info strong { 
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.7em;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          color: #9ca3af;
          margin: 0;
          font-weight: 700;
        }
        .run-info strong::before {
          content: '';
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: currentColor;
          opacity: 0.7;
          box-shadow: 0 0 8px currentColor;
        }
        .run-info-item:first-child strong {
          color: var(--warning-light);
        }
        .run-info-item:last-child strong {
          color: var(--secondary-light);
        }
        .run-info span {
          font-size: 1.5em;
          font-weight: 800;
          color: #f9fafb;
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
          letter-spacing: -0.02em;
          line-height: 1.2;
          white-space: nowrap;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        .tabs { 
          display: flex;
          background: #000000;
          padding: 0;
          margin: 0;
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid var(--border-light);
        }
        .tab-button { 
          flex: 1;
          padding: 24px 32px; 
          background: transparent; 
          border: none; 
          color: #6b7280; 
          cursor: pointer; 
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          font-size: 0.85em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          position: relative;
        }
        .tab-button::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 3px;
          background: transparent;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          transform: scaleX(0);
          transform-origin: center;
        }
        .tab-button[data-tab="dashboard"]:hover {
          background: rgba(52, 211, 153, 0.08);
          color: #34d399;
        }
        .tab-button[data-tab="dashboard"].active {
          background: linear-gradient(180deg, rgba(52, 211, 153, 0.12) 0%, rgba(52, 211, 153, 0.05) 100%);
          color: #34d399;
          box-shadow: inset 0 -3px 0 0 #34d399;
        }
        .tab-button[data-tab="dashboard"].active::after {
          background: linear-gradient(90deg, transparent, #34d399, transparent);
          transform: scaleX(1);
          box-shadow: 0 0 10px #34d399;
        }
        .tab-button[data-tab="test-runs"]:hover {
          background: rgba(96, 165, 250, 0.08);
          color: #60a5fa;
        }
        .tab-button[data-tab="test-runs"].active {
          background: linear-gradient(180deg, rgba(96, 165, 250, 0.12) 0%, rgba(96, 165, 250, 0.05) 100%);
          color: #60a5fa;
          box-shadow: inset 0 -3px 0 0 #60a5fa;
        }
        .tab-button[data-tab="test-runs"].active::after {
          background: linear-gradient(90deg, transparent, #60a5fa, transparent);
          transform: scaleX(1);
          box-shadow: 0 0 10px #60a5fa;
        }
        .tab-button[data-tab="test-history"]:hover {
          background: rgba(251, 191, 36, 0.08);
          color: #fbbf24;
        }
        .tab-button[data-tab="test-history"].active {
          background: linear-gradient(180deg, rgba(251, 191, 36, 0.12) 0%, rgba(251, 191, 36, 0.05) 100%);
          color: #fbbf24;
          box-shadow: inset 0 -3px 0 0 #fbbf24;
        }
        .tab-button[data-tab="test-history"].active::after {
          background: linear-gradient(90deg, transparent, #fbbf24, transparent);
          transform: scaleX(1);
          box-shadow: 0 0 10px #fbbf24;
        }
        .tab-button[data-tab="ai-failure-analyzer"]:hover {
          background: rgba(167, 139, 250, 0.08);
          color: #a78bfa;
        }
        .tab-button[data-tab="ai-failure-analyzer"].active {
          background: linear-gradient(180deg, rgba(167, 139, 250, 0.12) 0%, rgba(167, 139, 250, 0.05) 100%);
          color: #a78bfa;
          box-shadow: inset 0 -3px 0 0 #a78bfa;
        }
        .tab-button[data-tab="ai-failure-analyzer"].active::after {
          background: linear-gradient(90deg, transparent, #a78bfa, transparent);
          transform: scaleX(1);
          box-shadow: 0 0 10px #a78bfa;
        }
        .dashboard-grid { 
          display: grid; 
          grid-template-columns: repeat(4, 1fr); 
          gap: 0;
          margin: 0 0 40px 0;
        }
        .summary-card { 
          padding: 36px 32px; 
          text-align: left;
          background: rgba(31, 41, 55, 0.95);
          border: 1px solid #374151;
          transition: background 0.2s ease;
          border-right: 1px solid #374151;
          border-bottom: 1px solid #374151;
        }
        .summary-card:nth-child(4n) { 
          border-right: none; 
        }
        .summary-card h3 { 
          margin: 0 0 12px; 
          font-size: 0.7em; 
          font-weight: 700; 
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 1.2px;
        }
        .summary-card .value { 
          font-size: 2.8em; 
          font-weight: 900; 
          margin: 0;
          line-height: 1;
          letter-spacing: -0.03em;
        }
        .summary-card .trend-percentage {
          font-size: 0.9em;
          color: #9ca3af;
          margin-top: 8px;
          font-weight: 600;
        }
* {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        * {
          transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform, opacity;
        }
        *:not(input):not(select):not(textarea):not(button) {
          transition-duration: 0.15s;
        }
        ::selection { 
          background: #52525b; 
          color: white; 
        }
        ::-webkit-scrollbar { 
          width: 10px; 
          height: 10px; 
        }
        ::-webkit-scrollbar-track { 
          background: #1f2937; 
          border-radius: 10px; 
        }
        ::-webkit-scrollbar-thumb { 
          background: linear-gradient(180deg, #52525b, #71717a); 
          border-radius: 10px; 
        }
        ::-webkit-scrollbar-thumb:hover { 
          background: linear-gradient(180deg, #71717a, #a1a1aa); 
        }
        body { 
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
          margin: 0; 
          background: #111827;
          color: #f9fafb; 
          line-height: 1.6; 
          font-size: 15px;
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
        footer {
          padding: 0.5rem;
          box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.3);
          text-align: center;
          font-family: 'Segoe UI', system-ui, sans-serif;
          background: #0f172a;
          border-top: 1px solid var(--border-light);
        }
.no-data, .no-tests, .no-steps, .no-data-chart { 
          padding: 28px; 
          text-align: center; 
          color: #9ca3af; 
          font-style: italic; 
          font-size: 1.1em; 
          background-color: #374151; 
          border-radius: 8px; 
          margin: 18px 0; 
          border: 1px dashed #6b7280; 
        }
        .no-data-chart {
          font-size: 0.95em; 
          padding: 18px;
        }
        .ai-failure-cards-grid { 
          display: grid; 
          grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); 
          gap: 22px; 
        }
        .ai-failure-card { 
          background: #1f2937; 
          border: 1px solid var(--border-medium); 
          border-left: 5px solid #ef4444; 
          border-radius: 8px; 
          box-shadow: 0 3px 8px rgba(0,0,0,0.3); 
          display: flex; 
          flex-direction: column; 
        }
        .ai-failure-card-header { 
          padding: 15px 20px; 
          border-bottom: 1px solid #374151; 
          display: flex; 
          align-items: center; 
          justify-content: space-between; 
          gap: 15px; 
        }
        .ai-failure-card-header h3 { 
          margin: 0; 
          font-size: 1.1em; 
          color: #f9fafb; 
          white-space: nowrap; 
          overflow: hidden; 
          text-overflow: ellipsis; 
        }
        .ai-failure-card-body { 
          padding: 20px; 
        }
        .ai-fix-btn { 
          background-color: #374151; 
          color: white; 
          border: 1px solid var(--border-medium); 
          padding: 10px 18px; 
          font-size: 1em; 
          font-weight: 600; 
          border-radius: 6px; 
          cursor: pointer; 
          transition: all 0.2s ease; 
          display: inline-flex; 
          align-items: center; 
          gap: 8px; 
        }
        .ai-fix-btn:hover { 
          background-color: #4b5563; 
          transform: translateY(-2px); 
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
.trace-preview { 
          padding: 1rem; 
          text-align: center; 
          background: var(--border-light); 
          border-bottom: 1px solid #4b5563; 
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
          background: #374151; 
          color: white; 
          border: 1px solid var(--border-medium);
        }
        .view-trace { 
          background: #374151; 
          color: white; 
        }
        .view-trace:hover { 
          background: #4b5563; 
        }
        .download-trace { 
          background: #6b7280; 
          color: #f9fafb; 
        }
        .download-trace:hover { 
          background: #9ca3af; 
        }
        .filters button.clear-filters-btn { 
          background-color: var(--medium-gray-color); 
          color: var(--text-color); 
          pointer-events: auto;
          cursor: pointer;
        }
        .filters button.clear-filters-btn:active,
        .filters button.clear-filters-btn:focus {
          background-color: var(--medium-gray-color);
          color: var(--text-color);
          transform: none;
          box-shadow: none;
          outline: none;
        }
        .copy-btn {
          color: #6366f1; 
          background: #1f2937; 
          border-radius: 8px; 
          cursor: pointer; 
          border-color: #6366f1; 
          font-size: 1em; 
          margin-left: 93%; 
          font-weight: 600;
        }
        .ai-analyzer-stats { 
          display: flex; 
          gap: 20px; 
          margin-bottom: 25px; 
          padding: 20px; 
          background: linear-gradient(135deg, var(--border-light) 0%, var(--bg-card) 100%); 
          border-radius: 8px; 
          justify-content: center; 
        }
        .stat-item { 
          text-align: center; 
          color: white; 
        }
        .stat-number { 
          display: block; 
          font-size: 2em; 
          font-weight: 700; 
          line-height: 1;
        }
        .stat-label { 
          font-size: 0.9em; 
          opacity: 0.9; 
          font-weight: 500;
        }
        .ai-analyzer-description { 
          margin-bottom: 25px; 
          font-size: 1em; 
          color: #d1d5db; 
          text-align: center; 
          max-width: 600px; 
          margin-left: auto; 
          margin-right: auto;
        }
        .compact-failure-list { 
          display: flex; 
          flex-direction: column; 
          gap: 15px; 
        }
.compact-failure-item { 
          background: #1f2937; 
          border: 1px solid #4b5563; 
          border-left: 4px solid #ef4444; 
          border-radius: 8px; 
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px -1px rgba(0, 0, 0, 0.4); 
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .compact-failure-item:hover { 
          transform: translateY(-2px); 
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.4); 
        }
        .failure-header { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          padding: 18px 20px; 
          gap: 15px;
        }
        .failure-main-info { 
          flex: 1; 
          min-width: 0; 
        }
        .failure-title { 
          margin: 0 0 8px 0; 
          font-size: 1.1em; 
          font-weight: 600; 
          color: #f9fafb; 
          white-space: nowrap; 
          overflow: hidden; 
          text-overflow: ellipsis;
        }
        .failure-meta { 
          display: flex; 
          gap: 12px; 
          align-items: center;
        }
        .browser-indicator, .duration-indicator { 
          font-size: 0.85em; 
          padding: 3px 8px; 
          border-radius: 12px; 
          font-weight: 500;
        }
        .browser-indicator { 
          background: #3b82f6; 
          color: white; 
        }
        #load-more-tests { 
          font-size: 16px; 
          padding: 4px; 
          background-color: #374151; 
          border-radius: 4px; 
          color: #f9fafb; 
        }
        .duration-indicator { 
          background: #6b7280; 
          color: #f9fafb; 
        }
        .ai-buttons-group { 
          display: flex; 
          gap: 10px; 
          flex-wrap: wrap; 
        }
        .compact-ai-btn { 
          background: linear-gradient(135deg, #374151 0%, #1f2937 100%); 
          color: white; 
          border: none; 
          padding: 12px 18px; 
          border-radius: 6px; 
          cursor: pointer; 
          font-weight: 600; 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          transition: all 0.3s ease; 
          white-space: nowrap;
        }
        .compact-ai-btn:hover { 
          transform: translateY(-2px); 
          box-shadow: 0 6px 20px rgba(55, 65, 81, 0.4); 
        }
        .ai-text { 
          font-size: 0.95em; 
        }
        .copy-prompt-btn { 
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); 
          color: white; 
          border: none; 
          padding: 12px 18px; 
          border-radius: 6px; 
          cursor: pointer; 
          font-weight: 600; 
          display: flex; 
          align-items: center; 
          gap: 8px; 
          transition: all 0.3s ease; 
          white-space: nowrap;
        }
        .copy-prompt-btn:hover { 
          transform: translateY(-2px); 
          box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4); 
        }
        .copy-prompt-btn.copied { 
          background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
        }
        .copy-prompt-text { 
          font-size: 0.95em; 
        }
        .failure-error-preview { 
          padding: 0 20px 18px 20px; 
          border-top: 1px solid #374151;
        }
        .error-snippet { 
          background: rgba(248, 113, 113, 0.1); 
          border: 1px solid rgba(248, 113, 113, 0.3); 
          border-radius: 6px; 
          padding: 12px; 
          margin-bottom: 12px; 
          font-family: monospace; 
          font-size: 0.9em; 
          color: #ef4444; 
          line-height: 1.4;
        }
        .expand-error-btn { 
          background: none; 
          border: 1px solid #4b5563; 
          color: #d1d5db; 
          padding: 6px 12px; 
          border-radius: 4px; 
          cursor: pointer; 
          font-size: 0.85em; 
          display: flex; 
          align-items: center; 
          gap: 6px; 
          transition: all 0.2s ease;
        }
        .expand-error-btn:hover { 
          background: #374151; 
          border-color: #6b7280; 
        }
        .expand-icon { 
          transition: transform 0.2s ease; 
          font-size: 0.8em;
        }
        .expand-error-btn.expanded .expand-icon { 
          transform: rotate(180deg); 
        }
        .full-error-details { 
          padding: 0 20px 20px 20px; 
          border-top: 1px solid #374151; 
          margin-top: 0;
        }
        .full-error-content { 
          background: rgba(248, 113, 113, 0.1); 
          border: 1px solid rgba(248, 113, 113, 0.3); 
          border-radius: 6px; 
          padding: 15px; 
          font-family: monospace; 
          font-size: 0.9em; 
          color: #ef4444; 
          line-height: 1.4; 
          max-height: 300px; 
          overflow-y: auto;
        }
/* Responsive media queries for mobile compatibility */
        @media (max-width: 1200px) {
          .trend-charts-row { 
            grid-template-columns: 1fr; 
          }
          .dashboard-bottom-row { 
            grid-template-columns: 1fr; 
          }
        }
        
        @media (max-width: 1024px) {
          .header { 
            padding: 32px 24px;
            flex-direction: column;
            gap: 24px;
            align-items: flex-start;
          }
          .run-info { 
            width: 100%;
            justify-content: flex-start;
            gap: 24px;
          }
          .dashboard-grid { 
            grid-template-columns: repeat(2, 1fr);
          }
          .summary-card:nth-child(2n) { 
            border-right: none; 
          }
          .summary-card:nth-child(n+7) { 
            border-bottom: none; 
          }
          
          .copy-btn {
            font-size: 0.75em;
            padding: 8px 16px;
            margin-left: 0;
          }
          .console-output-section h4 {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
          .log-wrapper {
            max-height: 300px;
          }
          .tag {
            font-size: 0.65em;
            padding: 4px 10px;
            margin-right: 4px;
            margin-bottom: 4px;
            letter-spacing: 0.3px;
          }
          .filters { padding: 16px; gap: 8px; }  
          .test-case-meta {
            width: 100%;
            gap: 6px;
          }
          .test-case { 
            margin: 0 0 12px 0; 
            border-radius: 8px;
          }
          .test-case-content {
            padding: 20px;
          }
          .pie-chart-wrapper, .suites-widget, .trend-chart { 
            padding: 32px 24px; 
          }
          .test-history-grid { 
            grid-template-columns: 1fr; 
          }
          .ai-failure-cards-grid { 
            grid-template-columns: 1fr; 
          }
        }
          .summary-card:nth-child(2n) { border-right: none; }
          .summary-card:nth-child(n+7) { border-bottom: none; }
          .filters { 
            padding: 24px;
          }
          .filters input { min-width: 100%; }
          .filters select { min-width: 100%; }
          
          .copy-btn {
            font-size: 0.75em;
            padding: 8px 16px;
            margin-left: 0;
          }
          .console-output-section h4 {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
          .log-wrapper {
            max-height: 300px;
          }
          .tag {
            font-size: 0.65em;
            padding: 4px 10px;
            margin-right: 4px;
            margin-bottom: 4px;
            letter-spacing: 0.3px;
          }
          .test-case-header {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto auto;
            gap: 10px;
          }
          .test-case-summary {
            grid-column: 1;
            grid-row: 1;
          }
          .test-case-meta {
            grid-column: 1;
            grid-row: 2;
          }
          .test-case-meta {
            width: 100%;
            gap: 6px;
          }
          .test-case { 
            margin: 0 0 12px 0; 
            border-radius: 8px;
          }
          .test-case-header {
            padding: 16px 20px;
          }
          .test-case-content {
            padding: 20px;
          }
          .pie-chart-wrapper, .suites-widget, .trend-chart { padding: 32px 24px; }
        }
        @media (max-width: 768px) {
          .header h1 { 
            font-size: 1.8em; 
          }
          #report-logo { 
            height: 48px; 
          }
          .tabs { 
            flex-wrap: wrap;
            gap: 0;
          }
          .tab-button { 
            padding: 16px 20px;
            font-size: 0.7em;
            flex: 1 1 auto;
            min-width: 120px;
          }
          .dashboard-grid { 
            grid-template-columns: 1fr;
          }
          .summary-card { 
            padding: 32px 24px !important;
            border-right: none !important;
          }
          .summary-card .value { 
            font-size: 2.5em !important; 
          }
          .dashboard-bottom-row { 
            grid-template-columns: 1fr;
            gap: 0;
          }
          .dashboard-column { 
            gap: 0; 
          }
          .pie-chart-wrapper, .suites-widget, .trend-chart { 
            padding: 28px 20px;
          }
          .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3, .chart-title-header { 
            font-size: 1.2em;
            margin-bottom: 20px;
          }
          .pie-chart-wrapper div[id^="pieChart-"] { 
            width: 100% !important;
            max-width: 100% !important;
            min-height: 280px;
            overflow: visible !important;
          }
          .pie-chart-wrapper {
            overflow: visible !important;
          }
          .trend-chart-container { 
            min-height: 280px;
          }
          .suites-grid { 
            grid-template-columns: 1fr;
          }
          .test-case-summary { 
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
          .test-case-meta { 
            flex-wrap: wrap;
            gap: 6px;
            width: 100%;
          }
          .ai-failure-cards-grid { 
            grid-template-columns: 1fr; 
          }
          .ai-analyzer-stats { 
            flex-direction: column; 
            gap: 15px; 
            text-align: center; 
          }
          .failure-header { 
            flex-direction: column; 
            align-items: stretch; 
            gap: 15px; 
          }
          .failure-main-info { 
            text-align: center; 
          }
          .failure-meta { 
            justify-content: center; 
          }
          .ai-buttons-group { 
            flex-direction: column; 
            width: 100%; 
          }
          .compact-ai-btn, .copy-prompt-btn { 
            justify-content: center; 
            padding: 12px 20px; 
            width: 100%; 
          }
        }
        @media (max-width: 480px) {
          .header { 
            padding: 24px 16px; 
          }
          .header h1 { 
            font-size: 1.5em; 
          }
          #report-logo { 
            height: 42px; 
          }
          .run-info { 
            flex-direction: column;
            gap: 12px;
            width: 100%;
          }
          .run-info-item {
            padding: 14px 20px;
          }
          .run-info-item:not(:last-child)::after {
            display: none;
          }
          .run-info-item:not(:last-child) {
            border-bottom: 1px solid var(--border-medium);
          }
          .run-info strong { 
            font-size: 0.65em; 
          }
          .run-info span { 
            font-size: 1.1em; 
          }
          .tabs { 
            flex-wrap: wrap;
            gap: 4px;
            padding: 8px;
          }
          .tab-button { 
            padding: 14px 10px;
            font-size: 0.6em;
            letter-spacing: 0.3px;
            flex: 1 1 calc(50% - 4px);
            min-width: 0;
            text-align: center;
          }
          .dashboard-grid { 
            gap: 0; 
          }
          .summary-card { 
            padding: 28px 16px !important; 
          }
          .summary-card h3 { 
            font-size: 0.65em; 
          }
          .summary-card .value { 
            font-size: 2em !important; 
          }
          .dashboard-bottom-row { 
            gap: 0; 
          }
          .dashboard-column { 
            gap: 0; 
          }
          .pie-chart-wrapper, .suites-widget, .trend-chart { 
            padding: 20px 16px;
          }
          .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3, .chart-title-header { 
            font-size: 1em;
            margin-bottom: 16px;
            font-weight: 800;
          }
          .pie-chart-wrapper div[id^="pieChart-"] { 
            width: 100% !important;
            max-width: 100% !important;
            min-height: 250px;
            overflow: visible !important;
          }
          .pie-chart-wrapper {
            overflow: visible !important;
            padding: 20px 12px;
          }
          .trend-chart-container { 
            min-height: 250px;
          }
          .suites-grid { 
            grid-template-columns: 1fr;
            gap: 16px;
          }
          .suite-card { 
            padding: 16px;
          }
          .filters { 
            padding: 16px; 
            gap: 8px; 
          }
          .test-case { 
            margin: 0 0 10px 0;
            border-radius: 6px;
          }
          .test-case-header { 
            padding: 14px 16px; 
          }
          .test-case-content {
            padding: 16px;
          }
          .stat-item .stat-number { 
            font-size: 1.5em; 
          }
          .failure-header { 
            padding: 15px; 
          }
          .failure-error-preview, .full-error-details { 
            padding-left: 15px; 
            padding-right: 15px; 
          }
        }
.copy-btn {
          color: #ffffff;
          background: linear-gradient(135deg, #52525b 0%, #71717a 100%);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85em;
          font-weight: 600;
          padding: 10px 20px;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(82, 82, 91, 0.3);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .copy-btn:hover {
          background: linear-gradient(135deg, #71717a 0%, #a1a1aa 100%);
          box-shadow: 0 4px 12px rgba(82, 82, 91, 0.4);
          transform: translateY(-1px);
        }
        .copy-btn:active {
          transform: translateY(0);
          box-shadow: 0 2px 6px rgba(82, 82, 91, 0.3);
        }
        .log-wrapper {
          max-width: 100%;
          overflow-x: auto;
          overflow-y: auto;
          max-height: 400px;
          background: #0f172a;
          border: 1px solid #374151;
          border-radius: 8px;
          padding: 0;
        }
        .log-wrapper pre {
          margin: 0;
          padding: 16px;
          white-space: pre;
          word-wrap: normal;
          overflow-wrap: normal;
        }
        .console-output-section {
          margin-top: 24px;
        }
        .console-output-section h4 {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          color: #f9fafb;
        }
        .log-content {
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
          font-size: 0.9em;
          line-height: 1.6;
          color: #e2e8f0;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .filters { 
          display: flex; 
          flex-wrap: nowrap; /* Forces content to stay on one line */
          align-items: center; /* Vertically aligns inputs and buttons */
          gap: 12px; 
          margin: 0;
          padding: 24px 32px;
          background: #070808ff;
          border-bottom: 1px solid #e2e8f0;
          overflow-x: auto; /* Adds scroll if content is too wide on tiny screens */
        }
        .filters input, .filters select, .filters button { 
          padding: 14px 18px; 
          border: 2px solid #e2e8f0; 
          font-size: 0.9em;
          font-family: var(--font-family);
          font-weight: 600;
          transition: all 0.15s ease;
        }
        .filters input { 
          flex: 1; /* Ensure this is flex: 1 or flex: 1 1 auto to take available space */
          min-width: 200px;
          background: white;
        }
        .filters input:focus { 
          outline: none;
          border-color: #6366f1;
        }
        .filters select { 
          flex: 0 0 auto;
          min-width: 180px;
          background: white;
          cursor: pointer;
          height: 45px;
        }
        .filters select:focus { 
          outline: none;
          border-color: #6366f1;
        }
        .filters button { 
          white-space: nowrap;
          background: #0f172a; 
          color: white; 
          cursor: pointer; 
          border: none;
          font-weight: 700;
          padding: 14px 32px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-size: 0.8em;
          flex: 0 0 auto;
        }
        .filters button:hover { 
          background: var(--gradient-primary);
          color: #000000;
          box-shadow: var(--glow-primary);
          transform: translateY(-2px);
        }
        .browser-breakdown {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 6px;
        }
        .browser-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.95em;
        }
        .browser-name {
          font-weight: 700;
          color: #f9fafb;
          text-transform: capitalize;
          font-size: 1.05em;
        }
        .browser-stats {
          color: #9ca3af;
          font-weight: 700;
          font-size: 0.95em;
        }
          border-radius: 8px;
          background: #2d2d2d;
        }
        .log-wrapper pre {
          margin: 0;
          white-space: pre;
          word-wrap: normal;
          overflow-wrap: normal;
        }
        .console-output-section h4 {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 12px;
        }
        .trace-actions a { text-decoration: none; font-weight: 500; font-size: 0.9em; }
.generic-attachment { text-align: center; padding: 1rem; justify-content: center; }
        .ai-analyzer-stats { 
            display: flex; 
            gap: 20px; 
            margin-bottom: 25px; 
            padding: 20px; 
            background: var(--bg-card); 
            border: 1px solid var(--border-medium);
            border-radius: 8px; 
            justify-content: center;
        }
        .stat-item { 
            text-align: center; 
            color: white; 
        }
        .stat-number { 
            display: block; 
            font-size: 2em; 
            font-weight: 700; 
            line-height: 1;
        }
        .stat-label { 
            font-size: 0.9em; 
            opacity: 0.9; 
            font-weight: 500;
        }
        .ai-analyzer-description { 
            margin-bottom: 25px; 
            font-size: 1em; 
            color: #d1d5db; 
            text-align: center; 
            max-width: 600px; 
            margin-left: auto; 
            margin-right: auto;
        }
        .compact-failure-list { 
            display: flex; 
            flex-direction: column; 
            gap: 15px; 
        }
        .compact-failure-item { 
            background: var(--bg-card); 
            border: 1px solid var(--border-medium); 
            border-left: 4px solid #ef4444; 
            border-radius: 8px; 
            box-shadow: 0 3px 8px rgba(0,0,0,0.3); 
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .compact-failure-item:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 5px 15px rgba(0,0,0,0.4); 
        }
        .failure-header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 18px 20px; 
            gap: 15px;
        }
        .failure-main-info { 
            flex: 1; 
            min-width: 0; 
        }
        .failure-title { 
            margin: 0 0 8px 0; 
            font-size: 1.1em; 
            font-weight: 600; 
            color: #f9fafb; 
            white-space: nowrap; 
            overflow: hidden; 
            text-overflow: ellipsis;
        }
        .failure-meta { 
            display: flex; 
            gap: 12px; 
            align-items: center;
        }
        .browser-indicator, .duration-indicator { 
            font-size: 0.85em; 
            padding: 3px 8px; 
            border-radius: 12px; 
            font-weight: 500;
        }
        .browser-indicator { 
            background: #3b82f6; 
            color: white; 
        }
        .duration-indicator { 
            background: var(--border-medium); 
            color: #f9fafb; 
        }
        .compact-ai-btn { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            border: none; 
            padding: 12px 18px; 
            border-radius: 6px; 
            cursor: pointer; 
            font-weight: 600; 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            transition: all 0.3s ease; 
            white-space: nowrap;
        }
        .compact-ai-btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4); 
        }
        .ai-icon { 
            font-size: 1.2em; 
        }
        .ai-text { 
            font-size: 0.95em; 
        }
        .ai-buttons-group { 
            display: flex; 
            gap: 10px; 
            flex-wrap: wrap; 
        }
        .copy-prompt-btn { 
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); 
            color: white; 
            border: none; 
            padding: 12px 18px; 
            border-radius: 6px; 
            cursor: pointer; 
            font-weight: 600; 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            transition: all 0.3s ease; 
            white-space: nowrap;
        }
        .copy-prompt-btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4); 
        }
        .copy-prompt-btn.copied { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
        }
        .copy-prompt-text { 
            font-size: 0.95em; 
        }
        .failure-error-preview { 
            padding: 0 20px 18px 20px; 
            border-top: 1px solid var(--border-light);
        }
        .error-snippet { 
            background: rgba(239, 68, 68, 0.1); 
            border: 1px solid rgba(239, 68, 68, 0.3); 
            border-radius: 6px; 
            padding: 12px; 
            margin-bottom: 12px; 
            font-family: monospace; 
            font-size: 0.9em; 
            color: #ef4444; 
            line-height: 1.4;
        }
        .expand-error-btn { 
            background: none; 
            border: 1px solid var(--border-medium); 
            color: #d1d5db; 
            padding: 6px 12px; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 0.85em; 
            display: flex; 
            align-items: center; 
            gap: 6px; 
            transition: all 0.2s ease;
        }
        .expand-error-btn:hover { 
            background: var(--border-light); 
            border-color: #6b7280; 
        }
        .expand-icon { 
            transition: transform 0.2s ease; 
            font-size: 0.8em;
        }
        .expand-error-btn.expanded .expand-icon { 
            transform: rotate(180deg); 
        }
        .full-error-details { 
            padding: 0 20px 20px 20px; 
            border-top: 1px solid var(--border-light); 
            margin-top: 0;
        }
        .full-error-content { 
            background: rgba(239, 68, 68, 0.1); 
            border: 1px solid rgba(239, 68, 68, 0.3); 
            border-radius: 6px; 
            padding: 15px; 
            font-family: monospace; 
            font-size: 0.9em; 
            color: #ef4444; 
            line-height: 1.4; 
            max-height: 300px; 
            overflow-y: auto;
        }
        .ai-analyzer-stats { 
            display: flex; 
            gap: 20px; 
            margin-bottom: 25px; 
            padding: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            border-radius: 8px; 
            justify-content: center;
        }
        .stat-item { 
            text-align: center; 
            color: white; 
        }
        .stat-number { 
            display: block; 
            font-size: 2em; 
            font-weight: 700; 
            line-height: 1;
        }
        .stat-label { 
            font-size: 0.9em; 
            opacity: 0.9; 
            font-weight: 500;
        }
        .ai-analyzer-description { 
            margin-bottom: 25px; 
            font-size: 1em; 
            color: #d1d5db; 
            text-align: center; 
            max-width: 600px; 
            margin-left: auto; 
            margin-right: auto;
        }
        .compact-failure-list { 
            display: flex; 
            flex-direction: column; 
            gap: 15px; 
        }
        .compact-failure-item { 
            background: #1f2937; 
            border: 1px solid #4b5563; 
            border-left: 4px solid #ef4444; 
            border-radius: 8px; 
            box-shadow: 0 3px 8px rgba(0,0,0,0.3); 
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .compact-failure-item:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 5px 15px rgba(0,0,0,0.4); 
        }
        .failure-header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 18px 20px; 
            gap: 15px;
        }
        .failure-main-info { 
            flex: 1; 
            min-width: 0; 
        }
        .failure-title { 
            margin: 0 0 8px 0; 
            font-size: 1.1em; 
            font-weight: 600; 
            color: #f9fafb; 
            white-space: nowrap; 
            overflow: hidden; 
            text-overflow: ellipsis;
        }
        .failure-meta { 
            display: flex; 
            gap: 12px; 
            align-items: center;
        }
        .browser-indicator, .duration-indicator { 
            font-size: 0.85em; 
            padding: 3px 8px; 
            border-radius: 12px; 
            font-weight: 500;
        }
        .browser-indicator { 
            background: #3b82f6; 
            color: white; 
        }
        .duration-indicator { 
            background: #4b5563; 
            color: #f9fafb; 
        }
        .compact-ai-btn { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            border: none; 
            padding: 12px 18px; 
            border-radius: 6px; 
            cursor: pointer; 
            font-weight: 600; 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            transition: all 0.3s ease; 
            white-space: nowrap;
        }
        .compact-ai-btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4); 
        }
        .ai-icon { 
            font-size: 1.2em; 
        }
        .ai-text { 
            font-size: 0.95em; 
        }
        .ai-buttons-group { 
            display: flex; 
            gap: 10px; 
            flex-wrap: wrap; 
        }
        .copy-prompt-btn { 
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); 
            color: white; 
            border: none; 
            padding: 12px 18px; 
            border-radius: 6px; 
            cursor: pointer; 
            font-weight: 600; 
            display: flex; 
            align-items: center; 
            gap: 8px; 
            transition: all 0.3s ease; 
            white-space: nowrap;
        }
        .copy-prompt-btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4); 
        }
        .copy-prompt-btn.copied { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
        }
        .copy-prompt-text { 
            font-size: 0.95em; 
        }
        .failure-error-preview { 
            padding: 0 20px 18px 20px; 
            border-top: 1px solid #374151;
        }
        .error-snippet { 
            background: rgba(239, 68, 68, 0.1); 
            border: 1px solid rgba(239, 68, 68, 0.3); 
            border-radius: 6px; 
            padding: 12px; 
            margin-bottom: 12px; 
            font-family: monospace; 
            font-size: 0.9em; 
            color: #ef4444; 
            line-height: 1.4;
        }
        .expand-error-btn { 
            background: none; 
            border: 1px solid #4b5563; 
            color: #d1d5db; 
            padding: 6px 12px; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 0.85em; 
            display: flex; 
            align-items: center; 
            gap: 6px; 
            transition: all 0.2s ease;
        }
        .expand-error-btn:hover { 
            background: #374151; 
            border-color: #6b7280; 
        }
        .expand-icon { 
            transition: transform 0.2s ease; 
            font-size: 0.8em;
        }
        .expand-error-btn.expanded .expand-icon { 
            transform: rotate(180deg); 
        }
        .full-error-details { 
            padding: 0 20px 20px 20px; 
            border-top: 1px solid #374151; 
            margin-top: 0;
        }
        .full-error-content { 
            background: rgba(239, 68, 68, 0.1); 
            border: 1px solid rgba(239, 68, 68, 0.3); 
            border-radius: 6px; 
            padding: 15px; 
            font-family: monospace; 
            font-size: 0.9em; 
            color: #ef4444; 
            line-height: 1.4; 
            max-height: 300px; 
            overflow-y: auto;
        }
.attachment-icon { font-size: 2.5rem; display: block; margin-bottom: 0.75rem; }
.attachment-caption { display: flex; flex-direction: column; align-items: center; justify-content: center; flex-grow: 1; }
.attachment-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.attachment-type { font-size: 0.8rem; color: var(--text-color-secondary); }
.footer-text { color: white }
</style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-title">
                <img id="report-logo" src="https://ocpaxmghzmfbuhxzxzae.supabase.co/storage/v1/object/public/images/pulse-report/playwright_pulse_icon.png" alt="Report Logo">
                <h1>Pulse Static Report</h1>
            </div>
            <div class="run-info">
                <div class="run-info-item">
                    <strong>Run Date</strong>
                    <span>${formatDate(runSummary.timestamp)}</span>
                </div>
                <div class="run-info-item">
                    <strong>Total Duration</strong>
                    <span>${formatDuration(runSummary.duration)}</span>
                </div>
            </div>
        </header>
        <div class="tabs">
            <button class="tab-button active" data-tab="dashboard">Dashboard</button>
            <button class="tab-button" data-tab="test-runs">Test Run Summary</button>
            <button class="tab-button" data-tab="test-history">Test History</button>
            <button class="tab-button" data-tab="ai-failure-analyzer">AI Failure Analyzer</button>
        </div>
        <div id="dashboard" class="tab-content active">
            <div class="dashboard-grid">
                <div class="summary-card"><h3>Total Tests</h3><div class="value">${
                  runSummary.totalTests
                }</div></div>
                <div class="summary-card status-passed"><h3>Passed</h3><div class="value">${
                  runSummary.passed
                }</div><div class="trend-percentage">${passPercentage}%</div></div>
                <div class="summary-card status-failed"><h3>Failed</h3><div class="value">${
                  runSummary.failed
                }</div><div class="trend-percentage">${failPercentage}%</div></div>
                <div class="summary-card status-skipped"><h3>Skipped</h3><div class="value">${
                  runSummary.skipped || 0
                }</div><div class="trend-percentage">${skipPercentage}%</div></div>
                <div class="summary-card"><h3>Avg. Test Time</h3><div class="value">${avgTestDuration}</div></div>
                <div class="summary-card"><h3>Run Duration</h3><div class="value">${formatDuration(
                  runSummary.duration,
                )}</div></div>
                <div class="summary-card">
                  <h3>🔄 Retry Count</h3>
                  <div class="value">${totalRetried}</div>
                </div>
                <div class="summary-card">
                  <h3>🌐 Browser Distribution <span style="font-size: 0.7em; color: var(--text-color-secondary); font-weight: 400;">(${browserBreakdown.length} total)</span></h3>
                  <div class="browser-breakdown" style="max-height: 200px; overflow-y: auto; padding-right: 4px;">
                    ${browserBreakdown
                      .slice(0, 5)
                      .map(
                        (b) =>
                          `<div class="browser-item">
                        <span class="browser-name">${sanitizeHTML(b.browser)}</span>
                        <span class="browser-stats">${b.percentage}% (${b.count})</span>
                      </div>`,
                      )
                      .join("")}
                    ${
                      browserBreakdown.length > 5
                        ? `<div class="browser-item" style="opacity: 0.6; font-style: italic; justify-content: center; border-top: 1px solid var(--border-light); margin-top: 8px; padding-top: 8px;">
                      <span>+${browserBreakdown.length - 5} more browsers</span>
                    </div>`
                        : ""
                    }
                  </div>
                </div>
            </div>
            <div class="dashboard-bottom-row">
              <div style="display: grid; gap: 20px">
                ${generatePieChart(
                  [
                    { label: "Passed", value: runSummary.passed },
                    { label: "Failed", value: runSummary.failed },
                    { label: "Skipped", value: runSummary.skipped || 0 },
                  ],
                  400,
                  390,
                )} 
                ${
                  runSummary.environment &&
                  Object.keys(runSummary.environment).length > 0
                    ? generateEnvironmentDashboard(runSummary.environment)
                    : '<div class="no-data">Environment data not available.</div>'
                }
              </div> 
                <div style="display: flex; flex-direction: column; gap: 28px;">
                  ${generateSuitesWidget(suitesData)}
                  ${generateSeverityDistributionChart(results)}
              </div>
            </div>
        </div>
        <div id="test-runs" class="tab-content">
            <div class="filters" style="border-color: black; border-style: groove;">
                <input type="text" id="filter-name" placeholder="Filter by test name/path..." style="border-color: black; border-style: outset;">
                <select id="filter-status"><option value="">All Statuses</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="skipped">Skipped</option></select>
                <select id="filter-browser"><option value="">All Browsers</option>${Array.from(
                  new Set(
                    (results || []).map((test) => test.browser || "unknown"),
                  ),
                )
                  .map(
                    (browser) =>
                      `<option value="${sanitizeHTML(browser)}">${sanitizeHTML(
                        browser,
                      )}</option>`,
                  )
                  .join("")}</select>
                <button id="clear-run-summary-filters" class="clear-filters-btn">Clear Filters</button>
            </div>
            <div class="test-cases-list">${generateTestCasesHTML(
              results.slice(0, 50),
              0,
            )}</div>
            ${
              results.length > 50
                ? `<div class="load-more-wrapper"><button id="load-more-tests">Load more</button></div><script type="application/json" id="remaining-tests-b64">${Buffer.from(
                    generateTestCasesHTML(results.slice(50), 50),
                    "utf8",
                  ).toString("base64")}</script>`
                : ``
            }
        </div>
        <div id="test-history" class="tab-content">
          <div class="trend-charts-row">
            <div class="trend-chart"><h3 class="chart-title-header">Test Volume & Outcome Trends</h3>
              ${
                trendData && trendData.overall && trendData.overall.length > 0
                  ? generateTestTrendsChart(trendData)
                  : '<div class="no-data">Overall trend data not available for test counts.</div>'
              }
            </div>
            <div class="trend-chart"><h3 class="chart-title-header">Execution Duration Trends</h3>
              ${
                trendData && trendData.overall && trendData.overall.length > 0
                  ? generateDurationTrendChart(trendData)
                  : '<div class="no-data">Overall trend data not available for durations.</div>'
              }
              </div>
          </div>
          <div class="trend-charts-row">
            <div class="trend-chart">
                <h3 class="chart-title-header">Duration by Spec files</h3>
                ${generateSpecDurationChart(results)}
            </div>
            <div class="trend-chart">
                <h3 class="chart-title-header">Duration by Test Describe</h3>
                ${generateDescribeDurationChart(results)}
            </div>
          </div>
          <div class="trend-charts-row">
             <div class="trend-chart">
                <h3 class="chart-title-header">Test Distribution by Worker ${infoTooltip}</h3>
                ${generateWorkerDistributionChart(results)}
             </div>
          </div>
          <div class="trend-chart test-history-trend-section" style="border-bottom: none;">
             <h3 class="chart-title-header">Individual Test History</h3>
          </div>
          ${
            trendData &&
            trendData.testRuns &&
            Object.keys(trendData.testRuns).length > 0
              ? generateTestHistoryContent(trendData)
              : '<div class="no-data">Individual test history data not available.</div>'
          }
        </div>
        <div id="ai-failure-analyzer" class="tab-content">
            ${generateAIFailureAnalyzerTab(results)}
        </div>
        <footer style="padding: 0.5rem; box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05); text-align: center; font-family: 'Segoe UI', system-ui, sans-serif;">
            <div style="display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; font-weight: 600; letter-spacing: 0.5px;">
                <span>Created by</span>
                <a href="https://www.npmjs.com/package/@arghajit/playwright-pulse-report" target="_blank" rel="noopener noreferrer" style="color: #7737BF; font-weight: 700; font-style: italic; text-decoration: none; transition: all 0.2s ease;" onmouseover="this.style.color='#BF5C37'" onmouseout="this.style.color='#7737BF'">Pulse Report</a>
            </div>
            <div style="margin-top: 0.5rem; font-size: 0.75rem; color: #666;">Crafted with precision</div>
        </footer>
    </div>
    <script>
    // Ensure formatDuration is globally available
    if (typeof formatDuration === 'undefined') { 
        function formatDuration(ms) { 
            if (ms === undefined || ms === null || ms < 0) return "0.0s"; 
            return (ms / 1000).toFixed(1) + "s"; 
        }
    }
    function copyLogContent(elementId, button) {
        const logElement = document.getElementById(elementId);
        if (!logElement) {
            console.error('Could not find log element with ID:', elementId);
            return;
        }
        navigator.clipboard.writeText(logElement.innerText).then(() => {
            button.textContent = 'Copied!';
            setTimeout(() => { button.textContent = 'Copy'; }, 2000);
        }).catch(err => {
            console.error('Failed to copy log content:', err);
            button.textContent = 'Failed';
             setTimeout(() => { button.textContent = 'Copy'; }, 2000);
        });
    }

    function getAIFix(button) {
        const failureItem = button.closest('.compact-failure-item');
        const aiContainer = failureItem.querySelector('.ai-suggestion-container');
        const aiContent = failureItem.querySelector('.ai-suggestion-content');
        
        if (aiContainer.style.display === 'block') {
            aiContainer.style.display = 'none';
            button.querySelector('.ai-text').textContent = 'AI Fix';
            return;
        }
        
        aiContainer.style.display = 'block';
        aiContent.innerHTML = '<div class="ai-loader" style="margin: 40px auto;"></div>';
        button.querySelector('.ai-text').textContent = 'Loading...';
        button.disabled = true;

        try {
            const testJson = button.dataset.testJson;
            const test = JSON.parse(atob(testJson));

            const testName = test.name || 'Unknown Test';
            const failureLogsAndErrors = [
                'Error Message:',
                test.errorMessage || 'Not available.',
                '\\n\\n--- stdout ---',
                (test.stdout && test.stdout.length > 0) ? test.stdout.join('\\n') : 'Not available.',
                '\\n\\n--- stderr ---',
                (test.stderr && test.stderr.length > 0) ? test.stderr.join('\\n') : 'Not available.'
            ].join('\\n');
            const codeSnippet = test.snippet || '';

            const shortTestName = testName.split(' > ').pop();
            
            const apiUrl = 'https://ai-test-analyser.netlify.app/api/analyze';
            fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testName: testName,
                    failureLogsAndErrors: failureLogsAndErrors,
                    codeSnippet: codeSnippet,
                }),
            })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => { 
                        throw new Error(\`API request failed with status \${response.status}: \${text || response.statusText}\`);
                    });
                }
                return response.text();
            })
            .then(text => {
                if (!text) {
                    throw new Error("The AI analyzer returned an empty response. This might happen during high load or if the request was blocked. Please try again in a moment.");
                }
                try {
                    return JSON.parse(text);
                } catch (e) {
                    console.error("Failed to parse JSON:", text);
                    throw new Error(\`The AI analyzer returned an invalid response. \${e.message}\`);
                }
            })
            .then(data => {
                const escapeHtml = (unsafe) => {
                    if (typeof unsafe !== 'string') return '';
                    return unsafe
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "&#039;");
                };

                const analysisHtml = \`<h4>Analysis</h4><p>\${escapeHtml(data.rootCause) || 'No analysis provided.'}</p>\`;
                
                let suggestionsHtml = '<h4>Suggestions</h4>';
                if (data.suggestedFixes && data.suggestedFixes.length > 0) {
                    suggestionsHtml += '<div class="suggestions-list" style="margin-top: 15px;">';
                    data.suggestedFixes.forEach(fix => {
                        suggestionsHtml += \`
                            <div class="suggestion-item" style="margin-bottom: 22px; border-left: 3px solid var(--accent-color-alt); padding-left: 15px;">
                                <p style="margin: 0 0 8px 0; font-weight: 500;">\${escapeHtml(fix.description)}</p>
                                \${fix.codeSnippet ? \`<div class="code-section"><pre><code>\${escapeHtml(fix.codeSnippet)}</code></pre></div>\` : ''}
                            </div>
                        \`;
                    });
                    suggestionsHtml += '</div>';
                } else {
                    suggestionsHtml += \`<div class="code-section"><pre><code>No suggestion provided.</code></pre></div>\`;
                }
                
                button.querySelector('.ai-text').textContent = 'Hide AI Fix';
                button.disabled = false;
                aiContent.innerHTML = \`
                    <div class="ai-suggestion-header">
                        <h4>🤖 AI Analysis Result</h4>
                    </div>
                    <div class="ai-suggestion-body">
                        \${analysisHtml}
                        \${suggestionsHtml}
                    </div>
                \`;
            })
            .catch(err => {
                console.error('AI Fix Error:', err);
                button.disabled = false;
                button.querySelector('.ai-text').textContent = 'AI Fix';
                aiContent.innerHTML = \`<div class="test-error-summary"><strong>Error:</strong> Failed to get AI analysis. Please check the console for details. <br><br> \${err.message}</div>\`;
            });

        } catch (e) {
            console.error('Error processing test data for AI Fix:', e);
            button.disabled = false;
            button.querySelector('.ai-text').textContent = 'AI Fix';
            aiContent.innerHTML = \`<div class="test-error-summary">Could not process test data. Is it formatted correctly?</div>\`;
        }
    }

    function copyAIPrompt(button) {
        try {
            const testJson = button.dataset.testJson;
            const test = JSON.parse(atob(testJson));

            const testName = test.name || 'Unknown Test';
            const failureLogsAndErrors = [
                'Error Message:',
                test.errorMessage || 'Not available.',
                '\\n\\n--- stdout ---',
                (test.stdout && test.stdout.length > 0) ? test.stdout.join('\\n') : 'Not available.',
                '\\n\\n--- stderr ---',
                (test.stderr && test.stderr.length > 0) ? test.stderr.join('\\n') : 'Not available.'
            ].join('\\n');
            const codeSnippet = test.snippet || '';

            const aiPrompt = \`You are an expert Playwright test automation engineer specializing in debugging test failures.

INSTRUCTIONS:
1. Analyze the test failure carefully
2. Provide a brief root cause analysis
3. Provide EXACTLY 5 specific, actionable fixes
4. Each fix MUST include a code snippet (codeSnippet field)
5. Return ONLY valid JSON, no markdown or extra text

REQUIRED JSON FORMAT:
{
  "rootCause": "Brief explanation of why the test failed",
  "suggestedFixes": [
    {
      "description": "Clear explanation of the fix",
      "codeSnippet": "await page.waitForSelector('.button', { timeout: 5000 });"
    }
  ],
  "affectedTests": ["test1", "test2"]
}

IMPORTANT:
- Always return valid JSON only
- Always provide exactly 5 fixes in suggestedFixes array
- Each fix must have both description and codeSnippet fields
- Make code snippets practical and Playwright-specific

---

Test Name: \${testName}

Failure Logs and Errors:
\${failureLogsAndErrors}

Code Snippet:
\${codeSnippet}\`;

            navigator.clipboard.writeText(aiPrompt).then(() => {
                const originalText = button.querySelector('.copy-prompt-text').textContent;
                button.querySelector('.copy-prompt-text').textContent = 'Copied!';
                button.classList.add('copied');
                
                const shortTestName = testName.split(' > ').pop() || testName;
                alert(\`AI prompt to generate a suggested fix for "\${shortTestName}" has been copied to your clipboard.\`);
                
                setTimeout(() => {
                    button.querySelector('.copy-prompt-text').textContent = originalText;
                    button.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy AI prompt:', err);
                alert('Failed to copy AI prompt to clipboard. Please try again.');
            });
        } catch (e) {
            console.error('Error processing test data for AI Prompt copy:', e);
            alert('Could not process test data. Please try again.');
        }
    }

    function closeAiModal() {
        const modal = document.getElementById('ai-fix-modal');
        if(modal) modal.style.display = 'none';
        document.body.style.setProperty('overflow', '', 'important');
    }

    function toggleErrorDetails(button) {
        const errorDetails = button.closest('.compact-failure-item').querySelector('.full-error-details');
        const expandText = button.querySelector('.expand-text');
        
        if (errorDetails.style.display === 'none' || !errorDetails.style.display) {
            errorDetails.style.display = 'block';
            expandText.textContent = 'Hide Full Error';
            button.classList.add('expanded');
        } else {
            errorDetails.style.display = 'none';
            expandText.textContent = 'Show Full Error';
            button.classList.remove('expanded');
        }
    }

    // --- LAZY MEDIA HANDLERS ---
    window.loadMedia = function(id, type) {
        const storage = document.getElementById('data-' + id);
        const element = document.getElementById(id);
        const placeholder = element.previousElementSibling; 
        
        if (storage && element) {
            const data = storage.textContent;
            element.src = data;
            element.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
            
            if (type === 'video') {
                element.play().catch(e => console.log('Autoplay prevented', e));
            }
        }
    };

    window.downloadMedia = function(id, filename) {
        const storage = document.getElementById('data-' + id);
        if (storage) {
            const data = storage.textContent;
            const link = document.createElement('a');
            link.href = data;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            alert("Media data not found.");
        }
    };

    // Ensure formatDuration is globally available... (existing code follows)
     
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
                if (activeContent) {
                    activeContent.classList.add('active');
                }
            });
        });
        // --- Test Run Summary Filters ---
        const nameFilter = document.getElementById('filter-name');
        function ensureAllTestsAppended() {
            const node = document.getElementById('remaining-tests-b64');
            const loadMoreBtn = document.getElementById('load-more-tests');
            if (!node) return;
            const b64 = (node.textContent || '').trim();
            function b64ToUtf8(b64Str) {
                try { return decodeURIComponent(escape(window.atob(b64Str))); }
                catch (e) { return window.atob(b64Str); }
            }
            const html = b64ToUtf8(b64);
            const container = document.querySelector('#test-runs .test-cases-list');
            if (container) container.insertAdjacentHTML('beforeend', html);
            if (loadMoreBtn) loadMoreBtn.remove();
            node.remove();
        }
        const loadMoreBtn = document.getElementById('load-more-tests');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                const node = document.getElementById('remaining-tests-b64');
                if (!node) return;
                const b64 = (node.textContent || '').trim();
                function b64ToUtf8(b64Str) {
                    try { return decodeURIComponent(escape(window.atob(b64Str))); }
                    catch (e) { return window.atob(b64Str); }
                }
                const html = b64ToUtf8(b64);
                const container = document.querySelector('#test-runs .test-cases-list');
                if (container) container.insertAdjacentHTML('beforeend', html);
                loadMoreBtn.remove();
                node.remove();
            });
        }



        const statusFilter = document.getElementById('filter-status');
        const browserFilter = document.getElementById('filter-browser');
        const clearRunSummaryFiltersBtn = document.getElementById('clear-run-summary-filters'); 
        function filterTestCases() { 
            ensureAllTestsAppended();
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
        if(clearRunSummaryFiltersBtn) clearRunSummaryFiltersBtn.addEventListener('click', () => {
            ensureAllTestsAppended();
            if(nameFilter) nameFilter.value = '';
            if(statusFilter) statusFilter.value = '';
            if(browserFilter) browserFilter.value = '';
            filterTestCases();
        });
        // --- Test History Filters ---
        const historyNameFilter = document.getElementById('history-filter-name');
        const historyStatusFilter = document.getElementById('history-filter-status');
        const clearHistoryFiltersBtn = document.getElementById('clear-history-filters'); 
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
        if(clearHistoryFiltersBtn) clearHistoryFiltersBtn.addEventListener('click', () => {
            if(historyNameFilter) historyNameFilter.value = ''; if(historyStatusFilter) historyStatusFilter.value = '';
            filterTestHistoryCards();
        });
        // --- Expand/Collapse and Toggle Details Logic ---
        // --- Expand/Collapse and Toggle Details Logic ---
        function toggleElementDetails(headerElement, contentSelector) { 
            let contentElement;
            if (headerElement.classList.contains('test-case-header')) {
                // Find the content sibling
                contentElement = headerElement.parentElement.querySelector('.test-case-content');
                
                // --- ALLURE-STYLE LAZY RENDERING ---
                // If content is empty/not loaded, load it from the template script
                if (contentElement && !contentElement.getAttribute('data-loaded')) {
                    const testCaseId = contentElement.id.replace('details-', '');
                    const template = document.getElementById('tmpl-' + testCaseId);
                    if (template) {
                        contentElement.innerHTML = template.textContent; // Hydrate HTML
                        contentElement.setAttribute('data-loaded', 'true');
                    }
                }
                // -----------------------------------

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

        document.addEventListener('click', (e) => {
            const inHighcharts = e.target && e.target.closest && e.target.closest('.highcharts-container');
            if (inHighcharts) {
                return;
            }
            const header = e.target.closest('#test-runs .test-case-header');
            if (header) {
                let contentElement = header.parentElement.querySelector('.test-case-content');
                if (contentElement) {
                    requestAnimationFrame(() => {
                        const isExpanded = contentElement.style.display === 'block';
                        contentElement.style.display = isExpanded ? 'none' : 'block';
                        header.setAttribute('aria-expanded', String(!isExpanded));
                    });
                }
                return;
            }
            const stepHeader = e.target.closest('#test-runs .step-header');
            if (stepHeader) {
                let details = stepHeader.nextElementSibling;
                if (details && details.matches('.step-details')) {
                    const isExpanded = details.style.display === 'block';
                    details.style.display = isExpanded ? 'none' : 'block';
                    stepHeader.setAttribute('aria-expanded', String(!isExpanded));
                }
                return;
            }
            const annotationLink = e.target.closest('a.annotation-link');
            if (annotationLink) {
                e.preventDefault();
                const annotationId = annotationLink.dataset.annotation;
                if (annotationId) {
                    const jiraUrl = prompt('Enter your JIRA/Ticket system base URL (e.g., https://your-company.atlassian.net/browse/):', 'https://your-company.atlassian.net/browse/');
                    if (jiraUrl) {
                        window.open(jiraUrl + annotationId, '_blank');
                    }
                }
                return;
            }
            const img = e.target.closest('img.lazy-load-image');
            if (img && img.dataset && img.dataset.src) {
                if (e.preventDefault) e.preventDefault();
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                const parentLink = img.closest('a.lazy-load-attachment');
                if (parentLink && parentLink.dataset && parentLink.dataset.href) {
                    parentLink.href = parentLink.dataset.href;
                    parentLink.removeAttribute('data-href');
                }
                return;
            }
            const video = e.target.closest('video.lazy-load-video');
            if (video) {
                if (e.preventDefault) e.preventDefault();
                const s = video.querySelector('source');
                if (s && s.dataset && s.dataset.src && !s.src) {
                    s.src = s.dataset.src;
                    s.removeAttribute('data-src');
                    video.load();
                } else if (video.dataset && video.dataset.src && !video.src) {
                    video.src = video.dataset.src;
                    video.removeAttribute('data-src');
                    video.load();
                }
                return;
            }
            const a = e.target.closest('a.lazy-load-attachment');
            if (a && a.dataset && a.dataset.href) {
                e.preventDefault();
                
                // Special handling for view-full links to avoid about:blank issue
                if (a.classList.contains('view-full')) {
                    // Extract the data from the data URI
                    const dataUri = a.dataset.href;
                    const [header, base64Data] = dataUri.split(',');
                    const mimeType = header.match(/data:([^;]+)/)[1];
                    
                    try {
                        // Convert base64 to blob
                        const byteCharacters = atob(base64Data);
                        const byteNumbers = new Array(byteCharacters.length);
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);
                        const blob = new Blob([byteArray], { type: mimeType });
                        
                        // Create a URL and open it
                        const blobUrl = URL.createObjectURL(blob);
                        const newWindow = window.open(blobUrl, '_blank');
                        
                        // Clean up the URL after a delay
                        setTimeout(() => {
                            URL.revokeObjectURL(blobUrl);
                        }, 1000);
                    } catch (error) {
                        console.error('Failed to open attachment:', error);
                        // Fallback to original method
                        a.href = a.dataset.href;
                        a.removeAttribute('data-href');
                        a.click();
                    }
                } else {
                    // For download links, use the original method
                    a.href = a.dataset.href;
                    a.removeAttribute('data-href');
                    a.click();
                }
                return;
            }
        });
        document.addEventListener('play', (e) => {
            const video = e.target && e.target.closest ? e.target.closest('video.lazy-load-video') : null;
            if (video) {
                const s = video.querySelector('source');
                if (s && s.dataset && s.dataset.src && !s.src) {
                    s.src = s.dataset.src;
                    s.removeAttribute('data-src');
                    video.load();
                } else if (video.dataset && video.dataset.src && !video.src) {
                    video.src = video.dataset.src;
                    video.removeAttribute('data-src');
                    video.load();
                }
            }
        }, true);
        const lazyLoadElements = document.querySelectorAll('.lazy-load-chart, .lazy-load-iframe');
        if ('IntersectionObserver' in window) {
            const observerOptions = {
                root: null,
                rootMargin: '300px 0px 300px 0px',
                threshold: 0.01
            };
            
            let lazyObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const element = entry.target;
                        
                        requestIdleCallback(() => {
                            if (element.classList.contains('lazy-load-iframe')) {
                                if (element.dataset.src) {
                                    element.src = element.dataset.src;
                                    element.removeAttribute('data-src');
                                }
                            } else if (element.classList.contains('lazy-load-chart')) {
                                const renderFunctionName = element.dataset.renderFunctionName;
                                if (renderFunctionName && typeof window[renderFunctionName] === 'function') {
                                    window[renderFunctionName]();
                                }
                            }
                            observer.unobserve(element);
                        }, { timeout: 2000 });
                    }
                });
            }, observerOptions);
            
            lazyLoadElements.forEach(el => lazyObserver.observe(el));
        } else {
            lazyLoadElements.forEach(element => {
                if (element.classList.contains('lazy-load-iframe') && element.dataset.src) element.src = element.dataset.src;
                else if (element.classList.contains('lazy-load-chart')) { const renderFn = element.dataset.renderFunctionName; if (renderFn && window[renderFn]) window[renderFn](); }
            });
        }
        
        if (!window.requestIdleCallback) {
            window.requestIdleCallback = function(cb, options) {
                const start = Date.now();
                return setTimeout(() => {
                    cb({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (Date.now() - start)) });
                }, 1);
            };
        }
    }
    document.addEventListener('DOMContentLoaded', initializeReportInteractivity);

    function copyErrorToClipboard(button) {
      const errorContainer = button.closest('.test-error-summary');
      if (!errorContainer) {
        console.error("Could not find '.test-error-summary' container.");
        return;
      }
      let errorText;
      const stackTraceElement = errorContainer.querySelector('.stack-trace');
      if (stackTraceElement) {
        errorText = stackTraceElement.textContent;
      } else {
        const clonedContainer = errorContainer.cloneNode(true);
        const buttonInClone = clonedContainer.querySelector('button');
        if (buttonInClone) buttonInClone.remove();
        errorText = clonedContainer.textContent;
      }

      if (!errorText) {
        button.textContent = 'Nothing to copy';
        setTimeout(() => { button.textContent = 'Copy Error'; }, 2000);
        return;
      }
      navigator.clipboard.writeText(errorText.trim()).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = originalText; }, 2000);
      }).catch(err => {
        console.error('Failed to copy: ', err);
        button.textContent = 'Failed';
      });
    }
</script>

<!-- AI Fix Modal -->
<div id="ai-fix-modal" class="ai-modal-overlay" onclick="closeAiModal()">
  <div class="ai-modal-content" onclick="event.stopPropagation()">
    <div class="ai-modal-header">
        <h3 id="ai-fix-modal-title">AI Analysis</h3>
        <span class="ai-modal-close" onclick="closeAiModal()">×</span>
    </div>
    <div class="ai-modal-body" id="ai-fix-modal-content">
        <!-- Content will be injected by JavaScript -->
    </div>
  </div>
</div>

</body>
</html>
  `;
}
async function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue(`Executing script: ${scriptPath}...`));
    const process = fork(scriptPath, args, {
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
/**
 * The main function that orchestrates the generation of the static HTML report.
 * It reads the latest test run data, loads historical data for trend analysis,
 * prepares the data, and then generates and writes the final HTML report file.
 */
async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const args = process.argv.slice(2);
  let customOutputDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--outputDir" || args[i] === "-o") {
      customOutputDir = args[i + 1];
      break;
    }
  }

  // Script to archive current run to JSON history (this is your modified "generate-trend.mjs")
  const archiveRunScriptPath = path.resolve(
    __dirname,
    "generate-trend.mjs", // Keeping the filename as per your request
  );

  const outputDir = await getOutputDir(customOutputDir);
  const reportJsonPath = path.resolve(outputDir, DEFAULT_JSON_FILE); // Current run's main JSON
  const reportHtmlPath = path.resolve(outputDir, DEFAULT_HTML_FILE);

  const historyDir = path.join(outputDir, "history"); // Directory for historical JSON files
  const HISTORY_FILE_PREFIX = "trend-"; // Match prefix used in archiving script
  const MAX_HISTORY_FILES_TO_LOAD_FOR_REPORT = 15; // How many historical runs to show in the report

  console.log(chalk.blue(`Starting static HTML report generation...`));
  console.log(chalk.blue(`Output directory set to: ${outputDir}`));
  if (customOutputDir) {
    console.log(chalk.gray(`  (from CLI argument)`));
  } else {
    const { exists } = await import("./config-reader.mjs").then((m) => ({
      exists: true,
    }));
    console.log(
      chalk.gray(`  (auto-detected from playwright.config or using default)`),
    );
  }

  // Step 1: Ensure current run data is archived to the history folder
  try {
    const archiveArgs = customOutputDir ? ["--outputDir", customOutputDir] : [];
    await runScript(archiveRunScriptPath, archiveArgs);
    console.log(
      chalk.green("Current run data archiving to history completed."),
    );
  } catch (error) {
    console.error(
      chalk.red(
        "Failed to archive current run data. Report might use stale or incomplete historical trends.",
      ),
      error,
    );
  }

  // Step 2: Load current run's data (for non-trend sections of the report)
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
        "Invalid report JSON structure. 'results' field is missing or invalid.",
      );
    }
    if (!Array.isArray(currentRunReportData.results)) {
      currentRunReportData.results = [];
      console.warn(
        chalk.yellow(
          "Warning: 'results' field in current run JSON was not an array. Treated as empty.",
        ),
      );
    }
  } catch (error) {
    console.error(
      chalk.red(
        `Critical Error: Could not read or parse main report JSON at ${reportJsonPath}: ${error.message}`,
      ),
    );
    process.exit(1);
  }

  // Step 3: Load historical data for trends
  let historicalRuns = [];
  try {
    await fs.access(historyDir);
    const allHistoryFiles = await fs.readdir(historyDir);

    const jsonHistoryFiles = allHistoryFiles
      .filter(
        (file) =>
          file.startsWith(HISTORY_FILE_PREFIX) && file.endsWith(".json"),
      )
      .map((file) => {
        const timestampPart = file
          .replace(HISTORY_FILE_PREFIX, "")
          .replace(".json", "");
        return {
          name: file,
          path: path.join(historyDir, file),
          timestamp: parseInt(timestampPart, 10),
        };
      })
      .filter((file) => !isNaN(file.timestamp))
      .sort((a, b) => b.timestamp - a.timestamp);

    const filesToLoadForTrend = jsonHistoryFiles.slice(
      0,
      MAX_HISTORY_FILES_TO_LOAD_FOR_REPORT,
    );

    for (const fileMeta of filesToLoadForTrend) {
      try {
        const fileContent = await fs.readFile(fileMeta.path, "utf-8");
        const runJsonData = JSON.parse(fileContent);
        historicalRuns.push(runJsonData);
      } catch (fileReadError) {
        console.warn(
          chalk.yellow(
            `Could not read/parse history file ${fileMeta.name}: ${fileReadError.message}`,
          ),
        );
      }
    }
    historicalRuns.reverse(); // Oldest first for charts
    console.log(
      chalk.green(
        `Loaded ${historicalRuns.length} historical run(s) for trend analysis.`,
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(
        chalk.yellow(
          `History directory '${historyDir}' not found. No historical trends will be displayed.`,
        ),
      );
    } else {
      console.warn(
        chalk.yellow(
          `Error loading historical data from '${historyDir}': ${error.message}`,
        ),
      );
    }
  }

  // Step 4: Prepare trendData object
  const trendData = {
    overall: [],
    testRuns: {},
  };

  if (historicalRuns.length > 0) {
    historicalRuns.forEach((histRunReport) => {
      if (histRunReport.run) {
        const runTimestamp = new Date(histRunReport.run.timestamp);
        trendData.overall.push({
          runId: runTimestamp.getTime(),
          timestamp: runTimestamp,
          duration: histRunReport.run.duration,
          totalTests: histRunReport.run.totalTests,
          passed: histRunReport.run.passed,
          failed: histRunReport.run.failed,
          skipped: histRunReport.run.skipped || 0,
        });

        if (histRunReport.results && Array.isArray(histRunReport.results)) {
          const runKeyForTestHistory = `test run ${runTimestamp.getTime()}`;
          trendData.testRuns[runKeyForTestHistory] = histRunReport.results.map(
            (test) => ({
              testName: test.name,
              duration: test.duration,
              status: test.status,
              timestamp: new Date(test.startTime),
            }),
          );
        }
      }
    });
    trendData.overall.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }

  // Step 5: Generate and write HTML
  try {
    const htmlContent = generateHTML(currentRunReportData, trendData);
    await fs.writeFile(reportHtmlPath, htmlContent, "utf-8");
    console.log(
      chalk.green.bold(
        `🎉 Pulse report generated successfully at: ${reportHtmlPath}`,
      ),
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
    chalk.red.bold(`Unhandled error during script execution: ${err.message}`),
  );
  console.error(err.stack);
  process.exit(1);
});
