#!/usr/bin/env node

import * as fs from "fs";
import path from "path";
import { getReporterConfig } from "./config-reader.mjs";
import { animate } from "./terminal-logo.mjs";
import { mergeSequentialReportsIfNeeded } from "./merge-sequential-reports.mjs";

const args = process.argv.slice(2);
let customOutputDir = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--outputDir' || args[i] === '-o') {
    customOutputDir = args[i + 1];
    break;
  }
}

/**
 * Securely resolves the report directory and config.
 */
async function getFullConfig() {
  const config = await getReporterConfig(customOutputDir);
  
  if (customOutputDir) {
    const resolvedPath = path.resolve(process.cwd(), customOutputDir);
    if (!resolvedPath.startsWith(process.cwd())) {
      console.error(
        "⛔ Security Error: Custom output directory must be within the current project root.",
      );
      process.exit(1);
    }
  }

  return config;
}

/**
 * Scans the report directory for subdirectories (shards).
 * Returns an array of absolute paths to these subdirectories.
 * Excludes the 'attachments' folder and non-shard directories.
 */
function getShardDirectories(dir, outputFile, individualReportsSubDir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((dirent) => {
      if (!dirent.isDirectory() || dirent.name === "attachments" || dirent.name === individualReportsSubDir) {
        return false;
      }
      
      const shardPath = path.join(dir, dirent.name);
      const hasDirectReport = fs.existsSync(path.join(shardPath, outputFile));
      const hasSequentialResults = fs.existsSync(path.join(shardPath, individualReportsSubDir));
      
      // Scenario 3: Only consider directories that have either a report or sequential results
      return hasDirectReport || hasSequentialResults;
    })
    .map((dirent) => path.join(dir, dirent.name));
}

/**
 * Merges JSON reports from all shard directories.
 */
function mergeReports(shardDirs, outputFile) {
  let combinedRun = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    flaky: 0
  };

  let combinedResults = [];
  let latestTimestamp = "";
  let latestGeneratedAt = "";
  let allEnvironments = [];

  for (const shardDir of shardDirs) {
    const jsonPath = path.join(shardDir, outputFile);

    if (!fs.existsSync(jsonPath)) {
      console.warn(`  Warning: No ${outputFile} found in ${path.basename(shardDir)} after pre-merge attempt.`);
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
      combinedRun.flaky += run.flaky || 0;
      combinedRun.duration += run.duration || 0;

      if (run.environment) {
        allEnvironments.push(run.environment);
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

  if (allEnvironments.length > 0) {
    combinedRun.environment = allEnvironments;
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
  await animate();
  
  const config = await getFullConfig();
  const REPORT_DIR = config.outputDir;
  const OUTPUT_FILE = config.outputFile;
  const INDIVIDUAL_SUBDIR = config.individualReportsSubDir;

  console.log(`\n🔄 Playwright Pulse - Merge Reports (Sharding Mode)\n`);
  console.log(`  Report directory: ${REPORT_DIR}`);
  console.log(`  Output file: ${OUTPUT_FILE}`);
  if (customOutputDir) {
    console.log(`  (from CLI argument)`);
  } else {
    console.log(`  (auto-detected from playwright.config or using default)`);
  }
  console.log();

  // 1. Get initial Shard Directories (Scenario 3: filtering non-relevant folders)
  const shardDirs = getShardDirectories(REPORT_DIR, OUTPUT_FILE, INDIVIDUAL_SUBDIR);

  if (shardDirs.length === 0) {
    console.log("❌ No shard directories found.");
    console.log(
      `   Expected structure: <report-dir>/<shard-folder>/${OUTPUT_FILE} or <report-dir>/<shard-folder>/${INDIVIDUAL_SUBDIR}/`,
    );
    process.exit(0);
  }

  console.log(`📂 Found ${shardDirs.length} shard director${shardDirs.length === 1 ? 'y' : 'ies'}:`);
  shardDirs.forEach((dir) => {
    console.log(`  - ${path.basename(dir)}`);
  });
  console.log();

  // 2. Scenario 1: Pre-merge sequential results for EACH shard if needed
  console.log(`⚙️  Checking for sequential results in shards...`);
  for (const shardDir of shardDirs) {
    const hasSequential = fs.existsSync(path.join(shardDir, INDIVIDUAL_SUBDIR));
    if (hasSequential) {
      console.log(`  - ${path.basename(shardDir)}: Merging sequential results...`);
      // Force merge because individual shard dirs might not have playwright.config.ts resolving to resetOnEachRun=false
      await mergeSequentialReportsIfNeeded(shardDir, true);
    }
  }
  console.log();

  // 3. Merge JSON Reports
  console.log(`🔀 Merging reports across shards...`);
  const merged = mergeReports(shardDirs, OUTPUT_FILE);
  console.log(`  ✓ Merged ${shardDirs.length} report(s)`);
  console.log();

  // 4. Copy Attachments
  console.log(`📎 Merging attachments...`);
  mergeAttachments(shardDirs, REPORT_DIR);
  console.log(`  ✓ Attachments merged`);

  // 5. Write Final Merged JSON
  const finalReportPath = path.join(REPORT_DIR, OUTPUT_FILE);
  fs.writeFileSync(finalReportPath, JSON.stringify(merged, null, 2));

  console.log(`\n✅ Merged report saved as ${OUTPUT_FILE}`);
  console.log(`   Total tests: ${merged.run.totalTests}`);
  console.log(`   Passed: ${merged.run.passed} | Failed: ${merged.run.failed} | Skipped: ${merged.run.skipped} | Flaky: ${merged.run.flaky}`);

  // 6. Cleanup Shard Directories
  cleanupShardDirectories(shardDirs);

  console.log();
})();
