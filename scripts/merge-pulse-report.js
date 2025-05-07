#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPORT_DIR = "./pulse-report-output"; // Or change this to your reports directory
const OUTPUT_FILE = "playwright-pulse-report.json";

function getReportFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter(
      (file) =>
        file.startsWith("playwright-pulse-report-") && file.endsWith(".json")
    );
}

function mergeReports(files) {
  let combinedRun = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
  };

  let combinedResults = [];

  let latestTimestamp = "";
  let latestGeneratedAt = "";

  for (const file of files) {
    const filePath = path.join(REPORT_DIR, file);
    const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const run = json.run || {};
    combinedRun.totalTests += run.totalTests || 0;
    combinedRun.passed += run.passed || 0;
    combinedRun.failed += run.failed || 0;
    combinedRun.skipped += run.skipped || 0;
    combinedRun.duration += run.duration || 0;

    if (json.results) {
      combinedResults.push(...json.results);
    }

    if (run.timestamp > latestTimestamp) latestTimestamp = run.timestamp;
    if (json.metadata?.generatedAt > latestGeneratedAt)
      latestGeneratedAt = json.metadata.generatedAt;
  }

  const finalJson = {
    run: {
      id: `merged-${Date.now()}`,
      timestamp: latestTimestamp,
      ...combinedRun,
    },
    results: combinedResults,
    metadata: {
      generatedAt: latestGeneratedAt,
    },
  };

  return finalJson;
}

// Main execution
const reportFiles = getReportFiles(REPORT_DIR);

if (reportFiles.length === 0) {
  console.log("No matching JSON report files found.");
  process.exit(1);
}

const merged = mergeReports(reportFiles);

fs.writeFileSync(
  path.join(REPORT_DIR, OUTPUT_FILE),
  JSON.stringify(merged, null, 2)
);
console.log(`✅ Merged report saved as ${OUTPUT_FILE}`);
