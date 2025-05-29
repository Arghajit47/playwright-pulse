#!/usr/bin/env node
// Using Node.js syntax compatible with `.mjs`
import * as fs from "fs/promises";
import path from "path";
import * as d3 from "d3";
import { JSDOM } from "jsdom";
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
  // CORRECTED VERSION
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

  const { document } = new JSDOM().window;
  const body = d3.select(document.body);

  const legendHeight = 60;
  const margin = { top: 30, right: 20, bottom: 50 + legendHeight, left: 50 };
  const width = 600 - margin.left - margin.right;
  const height = 350 - margin.top - margin.bottom;

  const svg = body
    .append("svg")
    .attr(
      "viewBox",
      `0 0 ${width + margin.left + margin.right} ${
        height + margin.top + margin.bottom
      }`
    )
    .attr("preserveAspectRatio", "xMidYMid meet");

  const chart = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const runs = trendData.overall;
  const testCounts = runs.map((r) => r.totalTests);
  const passedCounts = runs.map((r) => r.passed);
  const failedCounts = runs.map((r) => r.failed);
  const skippedCounts = runs.map((r) => r.skipped || 0);

  const yMax = d3.max(
    [testCounts, passedCounts, failedCounts, skippedCounts].flat()
  );
  const x = d3
    .scalePoint()
    .domain(runs.map((_, i) => i + 1))
    .range([0, width])
    .padding(0.5);
  const y = d3
    .scaleLinear()
    .domain([0, yMax > 0 ? yMax * 1.1 : 10])
    .range([height, 0]);

  const xAxis = d3.axisBottom(x).tickFormat((d) => `Run ${d}`);
  chart
    .append("g")
    .attr("class", "chart-axis x-axis")
    .attr("transform", `translate(0,${height})`)
    .call(xAxis);
  chart.append("g").attr("class", "chart-axis y-axis").call(d3.axisLeft(y));

  const lineGenerator = d3
    .line()
    .x((_, i) => x(i + 1))
    .y((d) => y(d))
    .curve(d3.curveMonotoneX);
  const areaGenerator = d3
    .area()
    .x((_, i) => x(i + 1))
    .y0(height)
    .curve(d3.curveMonotoneX);

  // ✅ Add gradient defs
  const defs = svg.append("defs");

  const gradients = [
    { id: "totalGradient", color: "var(--primary-color)" },
    { id: "passedGradient", color: "var(--success-color)" },
    { id: "failedGradient", color: "var(--danger-color)" },
    { id: "skippedGradient", color: "var(--warning-color)" },
  ];

  gradients.forEach(({ id, color }) => {
    const gradient = defs
      .append("linearGradient")
      .attr("id", id)
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "0%")
      .attr("y2", "100%");
    gradient
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", color)
      .attr("stop-opacity", 0.4);
    gradient
      .append("stop")
      .attr("offset", "100%")
      .attr("stop-color", color)
      .attr("stop-opacity", 0);
  });

  // ✅ Render area fills
  chart
    .append("path")
    .datum(testCounts)
    .attr("fill", "url(#totalGradient)")
    .attr(
      "d",
      areaGenerator.y1((d) => y(d))
    );
  chart
    .append("path")
    .datum(passedCounts)
    .attr("fill", "url(#passedGradient)")
    .attr(
      "d",
      areaGenerator.y1((d) => y(d))
    );
  chart
    .append("path")
    .datum(failedCounts)
    .attr("fill", "url(#failedGradient)")
    .attr(
      "d",
      areaGenerator.y1((d) => y(d))
    );
  chart
    .append("path")
    .datum(skippedCounts)
    .attr("fill", "url(#skippedGradient)")
    .attr(
      "d",
      areaGenerator.y1((d) => y(d))
    );

  // ✅ Render lines
  chart
    .append("path")
    .datum(testCounts)
    .attr("class", "chart-line total-line")
    .attr("d", lineGenerator);
  chart
    .append("path")
    .datum(passedCounts)
    .attr("class", "chart-line passed-line")
    .attr("d", lineGenerator);
  chart
    .append("path")
    .datum(failedCounts)
    .attr("class", "chart-line failed-line")
    .attr("d", lineGenerator);
  chart
    .append("path")
    .datum(skippedCounts)
    .attr("class", "chart-line skipped-line")
    .attr("d", lineGenerator);

  // ✅ Tooltip
  const tooltip = body
    .append("div")
    .attr("class", "chart-tooltip")
    .style("opacity", 0)
    .style("position", "absolute");

  runs.forEach((run, i) => {
    const categories = [
      { type: "Total", count: run.totalTests, color: "var(--primary-color)" },
      { type: "Passed", count: run.passed, color: "var(--success-color)" },
      { type: "Failed", count: run.failed, color: "var(--danger-color)" },
      {
        type: "Skipped",
        count: run.skipped || 0,
        color: "var(--warning-color)",
      },
    ];

    categories.forEach((category) => {
      if (typeof category.count !== "number") return;

      chart
        .append("circle")
        .attr("class", `hover-point hover-point-${category.type.toLowerCase()}`)
        .attr("cx", x(i + 1))
        .attr("cy", y(category.count))
        .attr("r", 7)
        .style("fill", "transparent")
        .style("pointer-events", "all")
        .on("mouseover", function (event) {
          tooltip.transition().duration(150).style("opacity", 0.95);
          tooltip
            .html(
              `
            <strong>Run ${run.runId || i + 1} (${category.type})</strong><br>
            Date: ${new Date(run.timestamp).toLocaleString()}<br>
            ${category.type}: ${category.count}<br>
            ---<br>
            Total: ${run.totalTests} | Passed: ${run.passed}<br>
            Failed: ${run.failed} | Skipped: ${run.skipped || 0}<br>
            Duration: ${formatDuration(run.duration)}`
            )
            .style("left", `${event.pageX + 15}px`)
            .style("top", `${event.pageY - 28}px`);

          d3.selectAll(
            `.visible-point-${category.type.toLowerCase()}[data-run-index="${i}"]`
          )
            .transition()
            .duration(100)
            .attr("r", 5.5)
            .style("opacity", 1);
        })
        .on("mouseout", function () {
          tooltip.transition().duration(300).style("opacity", 0);
          d3.selectAll(
            `.visible-point-${category.type.toLowerCase()}[data-run-index="${i}"]`
          )
            .transition()
            .duration(100)
            .attr("r", 4)
            .style("opacity", 0.8);
        });

      chart
        .append("circle")
        .attr(
          "class",
          `visible-point visible-point-${category.type.toLowerCase()}`
        )
        .attr("data-run-index", i)
        .attr("cx", x(i + 1))
        .attr("cy", y(category.count))
        .attr("r", 4)
        .style("fill", category.color)
        .style("opacity", 0.8)
        .style("pointer-events", "none");
    });
  });

  // ✅ Legend
  const legendData = [
    {
      label: "Total",
      colorClass: "total-line",
      dotColor: "var(--primary-color)",
    },
    {
      label: "Passed",
      colorClass: "passed-line",
      dotColor: "var(--success-color)",
    },
    {
      label: "Failed",
      colorClass: "failed-line",
      dotColor: "var(--danger-color)",
    },
    {
      label: "Skipped",
      colorClass: "skipped-line",
      dotColor: "var(--warning-color)",
    },
  ];

  const legend = chart
    .append("g")
    .attr("class", "chart-legend-d3 chart-legend-bottom")
    .attr(
      "transform",
      `translate(${width / 2 - (legendData.length * 80) / 2}, ${height + 40})`
    );

  legendData.forEach((item, i) => {
    const row = legend.append("g").attr("transform", `translate(${i * 80}, 0)`);
    row
      .append("line")
      .attr("x1", 0)
      .attr("x2", 15)
      .attr("y1", 5)
      .attr("y2", 5)
      .attr("class", `chart-line ${item.colorClass}`)
      .style("stroke-width", 2.5);
    row
      .append("circle")
      .attr("cx", 7.5)
      .attr("cy", 5)
      .attr("r", 3.5)
      .style("fill", item.dotColor);
    row
      .append("text")
      .attr("x", 22)
      .attr("y", 10)
      .text(item.label)
      .style("font-size", "12px");
  });

  return `<div class="trend-chart-container">${body.html()}</div>`;
}

function generateDurationTrendChart(trendData) {
  if (!trendData || !trendData.overall || trendData.overall.length === 0) {
    return '<div class="no-data">No overall trend data available for durations.</div>';
  }

  const { document } = new JSDOM().window;
  const body = d3.select(document.body);

  const legendHeight = 30;
  const margin = { top: 30, right: 20, bottom: 50 + legendHeight, left: 50 };
  const width = 600 - margin.left - margin.right;
  const height = 350 - margin.top - margin.bottom;

  const svg = body
    .append("svg")
    .attr(
      "viewBox",
      `0 0 ${width + margin.left + margin.right} ${
        height + margin.top + margin.bottom
      }`
    )
    .attr("preserveAspectRatio", "xMidYMid meet");

  const chart = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const runs = trendData.overall;
  const durations = runs.map((run) => run.duration / 1000);

  const x = d3
    .scalePoint()
    .domain(runs.map((_, i) => i + 1))
    .range([0, width])
    .padding(0.5);

  const yMax = d3.max(durations);
  const y = d3
    .scaleLinear()
    .domain([0, yMax > 0 ? yMax * 1.1 : 10])
    .range([height, 0]);

  const xAxis = d3.axisBottom(x).tickFormat((d) => `Run ${d}`);
  chart
    .append("g")
    .attr("class", "chart-axis x-axis")
    .attr("transform", `translate(0,${height})`)
    .call(xAxis)
    .selectAll("text")
    .text((d) => `Run ${d}`);

  chart
    .append("g")
    .attr("class", "chart-axis y-axis")
    .call(d3.axisLeft(y).tickFormat((d) => `${d}s`));

  // ✅ Gradient fill for area under the line
  const defs = svg.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", "durationGradient")
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "0%")
    .attr("y2", "100%");
  gradient
    .append("stop")
    .attr("offset", "0%")
    .attr("stop-color", "var(--accent-color-alt)")
    .attr("stop-opacity", 0.4);
  gradient
    .append("stop")
    .attr("offset", "100%")
    .attr("stop-color", "var(--accent-color-alt)")
    .attr("stop-opacity", 0);

  // ✅ Line + area generators
  const lineGenerator = d3
    .line()
    .x((_, i) => x(i + 1))
    .y((d_val) => y(d_val))
    .curve(d3.curveMonotoneX);

  const areaGenerator = d3
    .area()
    .x((_, i) => x(i + 1))
    .y0(height)
    .y1((d_val) => y(d_val))
    .curve(d3.curveMonotoneX);

  chart
    .append("path")
    .datum(durations)
    .attr("fill", "url(#durationGradient)")
    .attr("d", areaGenerator);

  chart
    .append("path")
    .datum(durations)
    .attr("class", "chart-line duration-line")
    .attr("d", lineGenerator);

  // ✅ Tooltip handling
  const tooltip = body
    .append("div")
    .attr("class", "chart-tooltip")
    .style("opacity", 0);

  runs.forEach((run, i) => {
    chart
      .append("circle")
      .attr("class", "hover-point")
      .attr("cx", x(i + 1))
      .attr("cy", y(durations[i]))
      .attr("r", 7)
      .style("fill", "transparent")
      .style("pointer-events", "all")
      .on("mouseover", function (event) {
        tooltip.transition().duration(150).style("opacity", 0.95);
        tooltip
          .html(
            `
          <strong>Run ${run.runId || i + 1}</strong><br>
          Date: ${new Date(run.timestamp).toLocaleString()}<br>
          Duration: ${formatDuration(run.duration)}<br>
          Tests: ${run.totalTests}`
          )
          .style("left", `${event.pageX + 15}px`)
          .style("top", `${event.pageY - 28}px`);
        d3.select(`.visible-point-duration[data-run-index="${i}"]`)
          .transition()
          .duration(100)
          .attr("r", 5.5)
          .style("opacity", 1);
      })
      .on("mouseout", function () {
        tooltip.transition().duration(300).style("opacity", 0);
        d3.select(`.visible-point-duration[data-run-index="${i}"]`)
          .transition()
          .duration(100)
          .attr("r", 4)
          .style("opacity", 0.8);
      });

    chart
      .append("circle")
      .attr("class", "visible-point visible-point-duration")
      .attr("data-run-index", i)
      .attr("cx", x(i + 1))
      .attr("cy", y(durations[i]))
      .attr("r", 4)
      .style("fill", "var(--accent-color-alt)")
      .style("opacity", 0.8)
      .style("pointer-events", "none");
  });

  const legend = chart
    .append("g")
    .attr("class", "chart-legend-d3 chart-legend-bottom")
    .attr("transform", `translate(${width / 2 - 50}, ${height + 40})`);

  const legendRow = legend.append("g");
  legendRow
    .append("line")
    .attr("x1", 0)
    .attr("x2", 15)
    .attr("y1", 5)
    .attr("y2", 5)
    .attr("class", "chart-line duration-line")
    .style("stroke-width", 2.5);
  legendRow
    .append("circle")
    .attr("cx", 7.5)
    .attr("cy", 5)
    .attr("r", 3.5)
    .style("fill", "var(--accent-color-alt)");
  legendRow
    .append("text")
    .attr("x", 22)
    .attr("y", 10)
    .text("Duration")
    .style("font-size", "12px");

  chart
    .append("text")
    .attr("class", "chart-title main-chart-title")
    .attr("x", width / 2)
    .attr("y", -margin.top / 2 + 10)
    .attr("text-anchor", "middle");

  return `<div class="trend-chart-container">${body.html()}</div>`;
}

function formatDate(dateStrOrDate) {
  if (!dateStrOrDate) return "N/A";
  try {
    const date = new Date(dateStrOrDate);
    if (isNaN(date.getTime())) return "Invalid Date";
    // Using a more common and less verbose format
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

  const { document } = new JSDOM().window;
  const body = d3.select(document.body);

  const width = 320;
  const height = 100;
  const margin = { top: 10, right: 10, bottom: 30, left: 40 };

  const svg = body
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const chart = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const validHistory = history.filter(
    (h) => h && typeof h.duration === "number" && h.duration >= 0
  );
  if (validHistory.length === 0)
    return '<div class="no-data-chart">No valid data for chart</div>';

  const maxDuration = d3.max(validHistory, (d) => d.duration);

  const x = d3
    .scalePoint()
    .domain(validHistory.map((_, i) => i + 1))
    .range([0, chartWidth])
    .padding(0.5);

  const y = d3
    .scaleLinear()
    .domain([0, maxDuration > 0 ? maxDuration * 1.1 : 1])
    .range([chartHeight, 0]);

  // Axes
  const xAxis = d3.axisBottom(x).tickFormat((d) => `R${d}`);
  chart
    .append("g")
    .attr("class", "chart-axis x-axis small-axis")
    .attr("transform", `translate(0,${chartHeight})`)
    .call(xAxis)
    .selectAll("text")
    .text((d) => `R${d}`);

  chart
    .append("g")
    .attr("class", "chart-axis y-axis small-axis")
    .call(
      d3
        .axisLeft(y)
        .ticks(3)
        .tickFormat((d) => formatDuration(d))
    );

  // Gradient
  const defs = svg.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", "historyLineGradient")
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "0%")
    .attr("y2", "100%");
  gradient
    .append("stop")
    .attr("offset", "0%")
    .attr("stop-color", "var(--accent-color)")
    .attr("stop-opacity", 0.4);
  gradient
    .append("stop")
    .attr("offset", "100%")
    .attr("stop-color", "var(--accent-color)")
    .attr("stop-opacity", 0);

  // Line generator with smoothing
  const lineGenerator = d3
    .line()
    .x((_, i) => x(i + 1))
    .y((d) => y(d.duration))
    .curve(d3.curveMonotoneX);

  if (validHistory.length > 1) {
    chart
      .append("path")
      .datum(validHistory)
      .attr("class", "chart-line history-duration-line")
      .attr("d", lineGenerator)
      .style("stroke", "var(--accent-color)");

    // Gradient area fill under line
    const area = d3
      .area()
      .x((_, i) => x(i + 1))
      .y0(chartHeight)
      .y1((d) => y(d.duration))
      .curve(d3.curveMonotoneX);

    chart
      .append("path")
      .datum(validHistory)
      .attr("d", area)
      .attr("fill", "url(#historyLineGradient)");
  }

  // Tooltip
  const tooltip = body
    .append("div")
    .attr("class", "chart-tooltip")
    .style("opacity", 0);

  validHistory.forEach((run, i) => {
    chart
      .append("circle")
      .attr("cx", x(i + 1))
      .attr("cy", y(run.duration))
      .attr("r", 6)
      .style("fill", "transparent")
      .style("pointer-events", "all")
      .on("mouseover", function (event) {
        tooltip.transition().duration(150).style("opacity", 0.95);
        tooltip
          .html(
            `
          <strong>Run ${run.runId || i + 1}</strong><br>
          Status: <span class="status-badge-small-tooltip ${getStatusClass(
            run.status
          )}">${run.status.toUpperCase()}</span><br>
          Duration: ${formatDuration(run.duration)}`
          )
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY - 15}px`);
        d3.select(this.nextSibling)
          .transition()
          .duration(100)
          .attr("r", 4.5)
          .style("opacity", 1);
      })
      .on("mouseout", function () {
        tooltip.transition().duration(300).style("opacity", 0);
        d3.select(this.nextSibling)
          .transition()
          .duration(100)
          .attr("r", 3)
          .style("opacity", 0.8);
      });

    chart
      .append("circle")
      .attr("class", "visible-point")
      .attr("cx", x(i + 1))
      .attr("cy", y(run.duration))
      .attr("r", 3)
      .style(
        "fill",
        run.status === "passed"
          ? "var(--success-color)"
          : run.status === "failed"
          ? "var(--danger-color)"
          : "var(--warning-color)"
      )
      .style("stroke", "#fff")
      .style("stroke-width", "0.5px")
      .style("opacity", 0.8)
      .style("pointer-events", "none");
  });

  return body.html();
}

function generatePieChartD3(data, chartWidth = 300, chartHeight = 300) {
  const { document } = new JSDOM().window;
  const body = d3.select(document.body);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return '<div class="no-data">No data for Test Distribution chart.</div>';
  }
  const passedPercentage = Math.round(
    ((data.find((d) => d.label === "Passed")?.value || 0) / total) * 100
  );

  const legendItemHeight = 22;
  const legendAreaHeight =
    data.filter((d) => d.value > 0).length * legendItemHeight;
  const effectiveChartHeight = chartHeight - legendAreaHeight - 10; // Space for legend below

  const outerRadius = Math.min(chartWidth, effectiveChartHeight) / 2 - 10; // Adjusted radius for legend space
  const innerRadius = outerRadius * 0.55;

  const pie = d3
    .pie()
    .value((d) => d.value)
    .sort(null);
  const arcGenerator = d3
    .arc()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius);

  const colorMap = {
    Passed: "var(--success-color)",
    Failed: "var(--danger-color)",
    Skipped: "var(--warning-color)",
  };
  const color = d3
    .scaleOrdinal()
    .domain(data.map((d) => d.label))
    .range(data.map((d) => colorMap[d.label] || "#ccc"));

  const svg = body
    .append("svg")
    .attr("width", chartWidth) // SVG width is just for the chart
    .attr("height", chartHeight) // Full height including legend
    .attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const chartGroup = svg
    .append("g")
    .attr(
      "transform",
      `translate(${chartWidth / 2}, ${effectiveChartHeight / 2 + 5})`
    ); // Centered in available chart area

  const tooltip = body
    .append("div")
    .attr("class", "chart-tooltip")
    .style("opacity", 0);

  chartGroup
    .selectAll(".arc-path")
    .data(pie(data.filter((d) => d.value > 0))) // Filter out zero-value slices for cleaner chart
    .enter()
    .append("path")
    .attr("class", "arc-path")
    .attr("d", arcGenerator)
    .attr("fill", (d) => color(d.data.label))
    .style("stroke", "var(--card-background-color)")
    .style("stroke-width", 3)
    .on("mouseover", function (event, d) {
      d3.select(this)
        .transition()
        .duration(150)
        .attr(
          "d",
          d3
            .arc()
            .innerRadius(innerRadius)
            .outerRadius(outerRadius + 6)
        );
      tooltip.transition().duration(150).style("opacity", 0.95);
      tooltip
        .html(
          `${d.data.label}: ${d.data.value} (${Math.round(
            (d.data.value / total) * 100
          )}%)`
        )
        .style("left", event.pageX + 15 + "px")
        .style("top", event.pageY - 28 + "px");
    })
    .on("mouseout", function (event, d) {
      d3.select(this).transition().duration(150).attr("d", arcGenerator);
      tooltip.transition().duration(300).style("opacity", 0);
    });

  chartGroup
    .append("text")
    .attr("class", "pie-center-percentage")
    .attr("text-anchor", "middle")
    .attr("dy", "0.05em")
    .text(`${passedPercentage}%`);

  chartGroup
    .append("text")
    .attr("class", "pie-center-label")
    .attr("text-anchor", "middle")
    .attr("dy", "1.3em")
    .text("Passed");

  const legend = svg
    .append("g")
    .attr("class", "pie-chart-legend-d3 chart-legend-bottom")
    .attr(
      "transform",
      `translate(${chartWidth / 2}, ${effectiveChartHeight + 20})`
    ); // Position legend below chart

  const legendItems = legend
    .selectAll(".legend-item")
    .data(data.filter((d) => d.value > 0))
    .enter()
    .append("g")
    .attr("class", "legend-item")
    // Position items horizontally, centering the block
    .attr("transform", (d, i, nodes) => {
      const numItems = nodes.length;
      const totalLegendWidth = numItems * 90 - 10; // Approx width of all legend items
      const startX = -totalLegendWidth / 2;
      return `translate(${startX + i * 90}, 0)`; // 90 is approx width per item
    });

  legendItems
    .append("rect")
    .attr("width", 12)
    .attr("height", 12)
    .style("fill", (d) => color(d.label))
    .attr("rx", 3)
    .attr("ry", 3)
    .attr("y", -6); // Align with text

  legendItems
    .append("text")
    .attr("x", 18)
    .attr("y", 0)
    .text((d) => `${d.label} (${d.value})`)
    .style("font-size", "12px")
    .attr("dominant-baseline", "middle");

  return `
    <div class="pie-chart-wrapper">
      <h3>Test Distribution</h3>
      ${body.html()}
    </div>`;
}

function generateTestHistoryContent(trendData) {
  if (
    !trendData ||
    !trendData.testRuns ||
    Object.keys(trendData.testRuns).length === 0
  ) {
    return '<div class="no-data">No historical test data available.</div>';
  }

  const allTestNamesAndPaths = new Map(); // Store {path: name, title: title}
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
            // For data-test-name, use the title for filtering as per input placeholder
            return `
            <div class="test-history-card" data-test-name="${sanitizeHTML(
              test.testTitle.toLowerCase()
            )}" data-latest-status="${latestRun.status}">
              <div class="test-history-header">
                <p title="${sanitizeHTML(test.testTitle)}">${capitalize(
              sanitizeHTML(test.testTitle)
            )}</p>
                <span class="status-badge ${getStatusClass(latestRun.status)}">
                  ${latestRun.status.toUpperCase()}
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
                          )}">${run.status.toUpperCase()}</span></td>
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
    // More robust suite name extraction: use file name if no clear suite, or parent dir if too generic
    let suiteNameCandidate = "Default Suite";
    if (suiteParts.length > 2) {
      // e.g. file > suite > test
      suiteNameCandidate = suiteParts[1];
    } else if (suiteParts.length > 1) {
      // e.g. file > test
      suiteNameCandidate = suiteParts[0]
        .split(path.sep)
        .pop()
        .replace(/\.(spec|test)\.(ts|js|mjs|cjs)$/, "");
    } else {
      // Just file name or malformed
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

  const totalTestsOr1 = runSummary.totalTests || 1;
  const passPercentage = Math.round((runSummary.passed / totalTestsOr1) * 100);
  const failPercentage = Math.round((runSummary.failed / totalTestsOr1) * 100);
  const skipPercentage = Math.round(
    ((runSummary.skipped || 0) / totalTestsOr1) * 100
  );
  const avgTestDuration =
    runSummary.totalTests > 0
      ? formatDuration(runSummary.duration / runSummary.totalTests)
      : "0.0s";

  // Inside generate-static-report.mjs

  function generateTestCasesHTML() {
    // Make sure this is within the scope where 'results' is defined
    if (!results || results.length === 0) {
      // Assuming 'results' is accessible here
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
            test.error // This is for the overall test error, not step error
              ? `<div class="test-error-summary"><h4>Test Error:</h4><pre>${sanitizeHTML(
                  test.error // Assuming test.error is the message; if it has a stack, that's separate
                )}</pre></div>`
              : ""
          }

          <h4>Steps</h4>
          <div class="steps-list">${generateStepsHTML(test.steps)}</div>

          ${/* NEW: stdout and stderr sections START */ ""}
          ${
            test.stdout && test.stdout.length > 0
              ? `
            <div class="console-output-section">
              <h4>Console Output (stdout)</h4>
              <pre class="console-log stdout-log">${test.stdout
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
              <pre class="console-log stderr-log">${test.stderr
                .map((line) => sanitizeHTML(line))
                .join("\n")}</pre>
            </div>`
              : ""
          }
          ${/* NEW: stdout and stderr sections END */ ""}
          
          ${
            test.screenshots && test.screenshots.length > 0
              ? `
            <div class="attachments-section">
              <h4>Screenshots</h4>
              <div class="attachments-grid">
                ${test.screenshots
                  .map((screenshot) => {
                    // Ensure screenshot.path and screenshot.name are accessed correctly
                    const imgSrc = sanitizeHTML(screenshot.path || "");
                    const screenshotName = sanitizeHTML(
                      screenshot.name || "Screenshot"
                    );
                    return imgSrc
                      ? `
                  <div class="attachment-item screenshot-item">
                    <a href="${imgSrc}" target="_blank" title="Click to view ${screenshotName} (full size)">
                      <img src="${imgSrc}" alt="${screenshotName}" loading="lazy">
                    </a>
                    <div class="attachment-caption">${screenshotName}</div>
                  </div>`
                      : "";
                  })
                  .join("")}
              </div>
            </div>`
              : ""
          }
            
          ${
            test.videos && test.videos.length > 0
              ? `
            <div class="attachments-section">
              <h4>Videos</h4>
              ${test.videos
                .map(
                  (video) => `
                <div class="video-item">
                  <a href="${sanitizeHTML(
                    video.path
                  )}" target="_blank">View Video: ${sanitizeHTML(
                    video.name || path.basename(video.path) // path.basename might not be available if path module not passed/scoped
                  )}</a>
                </div>`
                )
                .join("")}
            </div>`
              : ""
          }

          ${
            test.traces && test.traces.length > 0
              ? `
            <div class="attachments-section">
                <h4>Traces</h4>
                ${test.traces
                  .map(
                    (trace) => `
                  <div class="trace-item">
                    <a href="${sanitizeHTML(
                      trace.path
                    )}" target="_blank" download>Download Trace: ${sanitizeHTML(
                      trace.name || path.basename(trace.path) // path.basename might not be available if path module not passed/scoped
                    )}</a>
                    (Open with Playwright Trace Viewer)
                  </div>`
                  )
                  .join("")}
            </div>`
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
          --background-color: #f8f9fa; /* Even lighter gray */
          --card-background-color: #fff;
          --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          --border-radius: 8px;
          --box-shadow: 0 5px 15px rgba(0,0,0,0.08); /* Softer shadow */
          --box-shadow-light: 0 3px 8px rgba(0,0,0,0.05);
          --box-shadow-inset: inset 0 1px 3px rgba(0,0,0,0.07);
        }
        
        body {
          font-family: var(--font-family);
          margin: 0;
          background-color: var(--background-color);
          color: var(--text-color);
          line-height: 1.65; /* Increased line height */
          font-size: 16px;
        }
        
        .container {
          max-width: 1600px; 
          padding: 30px; /* Increased padding */
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
            display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); /* Increased minmax */
            gap: 28px; align-items: stretch; /* Stretch for same height cards */
        }
        .pie-chart-wrapper, .suites-widget, .trend-chart {
            background-color: var(--card-background-color); padding: 28px; /* Increased padding */
            border-radius: var(--border-radius); box-shadow: var(--box-shadow-light);
            display: flex; flex-direction: column; /* For internal alignment */
        }
        .pie-chart-wrapper h3, .suites-header h2, .trend-chart h3, .main-chart-title { 
            text-align: center; margin-top: 0; margin-bottom: 25px; 
            font-size: 1.25em; font-weight: 600; color: var(--text-color);
        }
        .pie-chart-wrapper svg, .trend-chart-container svg { display: block; margin: 0 auto; max-width: 100%; height: auto; flex-grow: 1;}
        
        .chart-tooltip {
          position: absolute; padding: 10px 15px; background: rgba(10,10,10,0.92); color: #f5f5f5; /* Slightly lighter text on dark */
          border: none; border-radius: 6px; pointer-events: none;
          font-size: 13px; line-height: 1.5; white-space: nowrap; z-index: 10000;
          box-shadow: 0 4px 12px rgba(0,0,0,0.35); opacity: 0; transition: opacity 0.15s ease-in-out;
        }
        .chart-tooltip strong { color: #fff; font-weight: 600;}
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
        .test-case-header:hover { background-color: #f4f6f8; } /* Lighter hover */
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
        .trend-chart-container svg .chart-axis path, .trend-chart-container svg .chart-axis line { stroke: var(--border-color); shape-rendering: crispEdges;}
        .trend-chart-container svg .chart-axis text { fill: var(--text-color-secondary); font-size: 12px; }
        .trend-chart-container svg .main-chart-title { font-size: 1.1em; font-weight: 600; fill: var(--text-color); }
        .chart-line { fill: none; stroke-width: 2.5px; }
        .chart-line.total-line { stroke: var(--primary-color); }
        .chart-line.passed-line { stroke: var(--success-color); }
        .chart-line.failed-line { stroke: var(--danger-color); }
        .chart-line.skipped-line { stroke: var(--warning-color); }
        .chart-line.duration-line { stroke: var(--accent-color-alt); }
        .chart-line.history-duration-line { stroke: var(--accent-color); stroke-width: 2px;}
        
        .pie-center-percentage { font-size: calc(var(--outer-radius, 100px) / 3.5); font-weight: bold; fill: var(--primary-color); } /* Use CSS var if possible */
        .pie-center-label { font-size: calc(var(--outer-radius, 100px) / 7); fill: var(--text-color-secondary); }
        .pie-chart-legend-d3 text, .chart-legend-d3 text { fill: var(--text-color); font-size: 12px;}
        .chart-legend-bottom {font-size: 12px;}


        .test-history-container h2 { font-size: 1.6em; margin-bottom: 18px; color: var(--primary-color); border-bottom: 1px solid var(--border-color); padding-bottom: 12px;}
        .test-history-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 22px; margin-top: 22px; }
        .test-history-card {
            background: var(--card-background-color); border: 1px solid var(--border-color); border-radius: var(--border-radius);
            padding: 22px; box-shadow: var(--box-shadow-light); display: flex; flex-direction: column;
        }
        .test-history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--light-gray-color); }
        .test-history-header h3 { margin: 0; font-size: 1.15em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .test-history-header p { font-weight: 500 }
        .test-history-trend { margin-bottom: 20px; min-height: 110px; }
        .test-history-trend svg { display: block; margin: 0 auto; max-width:100%; height: auto;}
        .test-history-trend .small-axis text {font-size: 11px;}
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
        /* Responsive Enhancements */
        @media (max-width: 1200px) {
            .trend-charts-row { grid-template-columns: 1fr; } /* Stack trend charts earlier */
        }
        @media (max-width: 992px) { 
            .dashboard-bottom-row { grid-template-columns: 1fr; }
            .pie-chart-wrapper svg { max-width: 350px; }
            .filters input { min-width: 180px; }
            .filters select { min-width: 150px; }
        }
        @media (max-width: 768px) { 
          body { font-size: 15px; }
          .container { margin: 10px; padding: 20px; } /* Adjusted padding */
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
          .pie-chart-wrapper {min-height: auto;} /* Allow pie chart to shrink */
          .pie-chart-legend-d3 { transform: translate(calc(50% - 50px), calc(100% - 50px));} /* Adjust legend for mobile for pie */

        }
        @media (max-width: 480px) { 
            body {font-size: 14px;}
            .container {padding: 15px;}
            .header h1 {font-size: 1.4em;}
            #report-logo { height: 35px; width: 35px; }
            .tab-button {padding: 10px 15px; font-size: 1em;}
            .summary-card .value {font-size: 1.8em;}
            .attachments-grid {grid-template-columns: 1fr;}
            .step-item {padding-left: calc(var(--depth, 0) * 18px);} /* Reduced indent */
            .test-case-content, .step-details {padding: 15px;}
            .trend-charts-row {gap: 20px;}
            .trend-chart {padding: 20px;}
            .chart-legend-bottom { transform: translate(10px, calc(100% - 50px));} /* Adjust general bottom legend for small screens */
            .chart-legend-bottom g { transform: translate(0,0) !important;} /* Stack legend items vertically */
            .chart-legend-bottom g text {font-size: 11px;}
            .chart-legend-bottom g line, .chart-legend-bottom g circle {transform: scale(0.9);}
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
                ${generatePieChartD3(
                  [
                    { label: "Passed", value: runSummary.passed },
                    { label: "Failed", value: runSummary.failed },
                    { label: "Skipped", value: runSummary.skipped || 0 },
                  ],
                  400,
                  350
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
  // border-top: 1px solid rgba(0, 0, 0, 0.1);
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
                // Use the 'title' attribute of .test-case-title for full path filtering
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
                // data-test-name now holds the test title (last part of full name)
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
            // For test cases, content is a child of the header's parent.
            // For steps, content is the direct next sibling.
            if (headerElement.classList.contains('test-case-header')) {
                contentElement = headerElement.parentElement.querySelector('.test-case-content');
            } else if (headerElement.classList.contains('step-header')) {
                contentElement = headerElement.nextElementSibling;
                // Verify it's the correct details div
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

// Add this helper function somewhere in generate-static-report.mjs,
// possibly before your main() function.

async function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue(`Executing script: ${scriptPath}...`));
    const process = fork(scriptPath, [], {
      stdio: "inherit", // This will pipe the child process's stdio to the parent
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
  const __filename = fileURLToPath(import.meta.url); // Get current file path
  const __dirname = path.dirname(__filename); // Get current directory
  const trendExcelScriptPath = path.resolve(
    __dirname,
    "generate-trend-excel.mjs"
  ); // generate-trend-excel.mjs is in the SAME directory as generate-static-report.mjs
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const reportJsonPath = path.resolve(outputDir, DEFAULT_JSON_FILE);
  const reportHtmlPath = path.resolve(outputDir, DEFAULT_HTML_FILE);
  const trendDataPath = path.resolve(outputDir, "trend.xls");

  console.log(chalk.blue(`Starting static HTML report generation...`));
  console.log(chalk.blue(`Output directory set to: ${outputDir}`));

  // --- Step 1: Ensure Excel trend data is generated/updated FIRST ---
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
              ); // Heuristic for JS timestamp
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
            skipped: Number(row.SKIPPED) || 0, // Ensure skipped is always a number
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
              } // Heuristic
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
    console.log(chalk.gray(`   (You can open this file in your browser)`));
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