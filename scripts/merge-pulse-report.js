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
    const resolvedPath = path.resolve(process.cwd(), customOutputDir);

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

/**
 * Scans the report directory for subdirectories (shards).
 * Returns an array of absolute paths to these subdirectories.
 * Excludes the 'attachments' folder itself.
 */
function getShardDirectories(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && dirent.name !== "attachments")
    .map((dirent) => path.join(dir, dirent.name));
}

/**
 * Merges JSON reports from all shard directories.
 */
function mergeReports(shardDirs) {
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

  for (const shardDir of shardDirs) {
    const jsonPath = path.join(shardDir, OUTPUT_FILE);

    if (!fs.existsSync(jsonPath)) {
      console.warn(`  Warning: No ${OUTPUT_FILE} found in ${path.basename(shardDir)}`);
      continue;
    }

    try {
      const fileContent = fs.readFileSync(jsonPath, "utf-8");
      const json = JSON.parse(fileContent);

      const run = json.run || {};
      combinedRun.totalTests += run.totalTests || 0;
      combinedRun.passed += run.passed || 0;
      combinedRun.failed += run.failed || 0;
      combinedRun.skipped += run.skipped || 0;
      combinedRun.duration += run.duration || 0;

      if (run.environment) {
        combinedRun.environment = run.environment;
      }

      if (json.results) {
        combinedResults.push(...json.results);
      }

      if (run.timestamp > latestTimestamp) latestTimestamp = run.timestamp;
      if (json.metadata?.generatedAt > latestGeneratedAt)
        latestGeneratedAt = json.metadata.generatedAt;
    } catch (e) {
      console.warn(
        `  Warning: Failed to process JSON in ${path.basename(shardDir)}: ${e.message}`,
      );
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

/**
 * Copies attachments from all shard directories to the main attachments folder.
 */
function mergeAttachments(shardDirs, outputDir) {
  const globalAttachmentsDir = path.join(outputDir, "attachments");

  for (const shardDir of shardDirs) {
    const shardAttachmentsDir = path.join(shardDir, "attachments");

    if (!fs.existsSync(shardAttachmentsDir)) {
      continue;
    }

    try {
      if (!fs.existsSync(globalAttachmentsDir)) {
        fs.mkdirSync(globalAttachmentsDir, { recursive: true });
      }

      // Recursively copy contents from shard attachments to global attachments
      fs.cpSync(shardAttachmentsDir, globalAttachmentsDir, {
        recursive: true,
      });
    } catch (e) {
      console.warn(
        `  Warning: Failed to copy attachments from ${path.basename(shardDir)}: ${e.message}`,
      );
    }
  }
}

/**
 * Cleans up shard directories after merging.
 */
function cleanupShardDirectories(shardDirs) {
  console.log("\n🧹 Cleaning up shard directories...");
  for (const shardDir of shardDirs) {
    try {
      fs.rmSync(shardDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(
        `  Warning: Could not delete ${path.basename(shardDir)}: ${e.message}`,
      );
    }
  }
  console.log("✨ Cleanup complete.");
}

// Main execution
(async () => {
  const REPORT_DIR = await getReportDir();

  console.log(`\n🔄 Playwright Pulse - Merge Reports (Sharding Mode)\n`);
  console.log(`  Report directory: ${REPORT_DIR}`);
  if (customOutputDir) {
    console.log(`  (from CLI argument)`);
  } else {
    console.log(`  (auto-detected from playwright.config or using default)`);
  }
  console.log();

  // 1. Get Shard Directories
  const shardDirs = getShardDirectories(REPORT_DIR);

  if (shardDirs.length === 0) {
    console.log("❌ No shard directories found.");
    console.log(
      "   Expected structure: <report-dir>/<shard-folder>/playwright-pulse-report.json",
    );
    process.exit(0);
  }

  console.log(`📂 Found ${shardDirs.length} shard director${shardDirs.length === 1 ? 'y' : 'ies'}:`);
  shardDirs.forEach((dir) => {
    console.log(`  - ${path.basename(dir)}`);
  });
  console.log();

  // 2. Merge JSON Reports
  console.log(`🔀 Merging reports...`);
  const merged = mergeReports(shardDirs);
  console.log(`  ✓ Merged ${shardDirs.length} report(s)`);
  console.log();

  // 3. Copy Attachments
  console.log(`📎 Merging attachments...`);
  mergeAttachments(shardDirs, REPORT_DIR);
  console.log(`  ✓ Attachments merged`);

  // 4. Write Final Merged JSON
  const finalReportPath = path.join(REPORT_DIR, OUTPUT_FILE);
  fs.writeFileSync(finalReportPath, JSON.stringify(merged, null, 2));

  console.log(`\n✅ Merged report saved as ${OUTPUT_FILE}`);
  console.log(`   Total tests: ${merged.run.totalTests}`);
  console.log(`   Passed: ${merged.run.passed} | Failed: ${merged.run.failed} | Skipped: ${merged.run.skipped}`);

  // 5. Cleanup Shard Directories
  cleanupShardDirectories(shardDirs);

  console.log();
})();
