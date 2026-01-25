#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
let customOutputDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--outputDir' || args[i] === '-o') {
    customOutputDir = args[i + 1];
    break;
  }
}

const OUTPUT_FILE = "playwright-pulse-report.json";

/**
 * Securely resolves the report directory.
 * Prevents Path Traversal by ensuring the output directory 
 * is contained within the current working directory.
 */
async function getReportDir() {
  if (customOutputDir) {
    // 1. Resolve the absolute path
    const resolvedPath = path.resolve(process.cwd(), customOutputDir);

    // 2. Security Check: Prevent Path Traversal
    // We ensure the resolved path starts with the project root (process.cwd())
    // This blocks inputs like "../../" that try to escape the project.
    if (!resolvedPath.startsWith(process.cwd())) {
      console.error(
        "⛔ Security Error: Custom output directory must be within the current project root.",
      );
      process.exit(1);
    }

    return resolvedPath;
  }

  try {
    const { getOutputDir } = await import("./config-reader.mjs");
    return await getOutputDir();
  } catch (error) {
    return path.resolve(process.cwd(), "pulse-report");
  }
}

function getReportFiles(dir) {
  // Security Note: 'dir' here is now guaranteed to be safe/sanitized by getReportDir
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter(
      (file) =>
        file.startsWith("playwright-pulse-report-") && file.endsWith(".json"),
    );
}

function mergeReports(files, reportDir) {
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
    // Security Note: 'file' comes from readdirSync (safe), reportDir is sanitized.
    const filePath = path.join(reportDir, file);

    try {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const json = JSON.parse(fileContent);

      const run = json.run || {};
      combinedRun.totalTests += run.totalTests || 0;
      combinedRun.passed += run.passed || 0;
      combinedRun.failed += run.failed || 0;
      combinedRun.skipped += run.skipped || 0;
      combinedRun.duration += run.duration || 0;
      combinedRun.environment = run.environment;

      if (json.results) {
        combinedResults.push(...json.results);
      }

      if (run.timestamp > latestTimestamp) latestTimestamp = run.timestamp;
      if (json.metadata?.generatedAt > latestGeneratedAt)
        latestGeneratedAt = json.metadata.generatedAt;
    } catch (e) {
      console.warn(`Warning: Failed to process ${file}: ${e.message}`);
    }
  }

  const finalJson = {
    run: {
      id: `merged-${Date.now()}-581d5ad8-ce75-4ca5-94a6-ed29c466c815`,
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
(async () => {
  const REPORT_DIR = await getReportDir();

  console.log(`Report directory set to: ${REPORT_DIR}`);
  if (customOutputDir) {
    console.log(`  (from CLI argument)`);
  } else {
    console.log(`  (auto-detected from playwright.config or using default)`);
  }

  const reportFiles = getReportFiles(REPORT_DIR);

  if (reportFiles.length === 0) {
    console.log("No matching JSON report files found.");
    process.exit(1);
  }

  const merged = mergeReports(reportFiles, REPORT_DIR);

  // Security Note: REPORT_DIR is sanitized, so writeFileSync is safe.
  fs.writeFileSync(
    path.join(REPORT_DIR, OUTPUT_FILE),
    JSON.stringify(merged, null, 2),
  );
  console.log(`✅ Merged report saved as ${OUTPUT_FILE}`);
})();