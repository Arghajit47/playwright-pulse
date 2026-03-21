import * as fs from "fs/promises";
import * as path from "path";

import { getReporterConfig } from "./config-reader.mjs";

/**
 * Reads all `<outputFile>-*.json` files in the `pulse-results` directory
 * and merges them into a single `<outputFile>.json`.
 * It resolves duplicate tests using exactly the same logic as the reporter.
 * 
 * @param {string} customOutputDir The base report directory override (from CLI).
 * @param {boolean} forceMerge Try to merge regardless of config.resetOnEachRun (used by sharded merge).
 */
export async function mergeSequentialReportsIfNeeded(customOutputDir, forceMerge = false) {
  const config = await getReporterConfig(customOutputDir);

  // This logic should ONLY run if resetOnEachRun is disabled, UNLESS we are forcing it 
  // (e.g. recovering orphaned shards in merge-pulse-report.mjs).
  if (config.resetOnEachRun && !forceMerge) {
    return;
  }

  const individualReportsSubDir = config.individualReportsSubDir;
  const baseOutputFile = config.outputFile;
  
  // If customOutputDir is provided, it might be an absolute path to a shard. Use it directly if it is absolute.
  // Otherwise, fall back to the config's outputDir (which is resolved relative to CWD).
  const outputDir = customOutputDir && path.isAbsolute(customOutputDir) 
    ? customOutputDir 
    : config.outputDir;

  const pulseResultsDir = path.join(outputDir, individualReportsSubDir);
  const finalOutputPath = path.join(outputDir, baseOutputFile);

  // Use the actual outputFile name as seed for shard files (e.g. "results.json" -> "results-")
  const shardPrefix = baseOutputFile.replace(".json", "-");

  let reportFiles;
  try {
    const allFiles = await fs.readdir(pulseResultsDir);
    reportFiles = allFiles.filter(
      (file) =>
        file.startsWith(shardPrefix) && file.endsWith(".json"),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      // No individual reports directory found, which is completely fine/normal
      return;
    }
    console.error(
      `Pulse Reporter: Error reading directory ${pulseResultsDir}:`,
      error,
    );
    return;
  }

  if (reportFiles.length === 0) {
    // No matching JSON report files found to merge
    return;
  }

  console.log(
    `\n🔄 Merging ${reportFiles.length} sequential test run(s) from '${individualReportsSubDir}'...`,
  );

  const allResultsFromAllFiles = [];
  let latestTimestamp = new Date(0);
  let lastRunEnvironment = undefined;
  let totalDuration = 0;

  for (const file of reportFiles) {
    const filePath = path.join(pulseResultsDir, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const json = JSON.parse(content);

      let currentRunId = `run-${Date.now()}`;
      if (json.run) {
        if (json.run.id) currentRunId = json.run.id;
        
        const runTimestamp = new Date(json.run.timestamp);
        if (runTimestamp > latestTimestamp) {
          latestTimestamp = runTimestamp;
          lastRunEnvironment = json.run.environment || undefined;
        }
      }

      if (json.results) {
        // Tag each result with its runId to ensure we can sum them up if they have same IDs but different runs
        const resultsWithRunId = json.results.map((r) => ({
          ...r,
          runId: currentRunId,
        }));
        allResultsFromAllFiles.push(...resultsWithRunId);
      }
    } catch (err) {
      console.warn(
        `Pulse Reporter: Could not parse report file ${filePath}. Skipping. Error: ${err.message}`,
      );
    }
  }

  // The results from individual run JSONs are already finalized and deduplicated by their own run's reporter.
  // We simply concatenate them. The runId tag ensures tests across runs remain distinguishable.
  const finalMergedResults = allResultsFromAllFiles;

  totalDuration = finalMergedResults.reduce(
    (acc, r) => acc + (r.duration || 0),
    0,
  );

  const combinedRun = {
    id: `run-${Date.now()}`,
    timestamp: latestTimestamp.toISOString(),
    environment: lastRunEnvironment,
    totalTests: finalMergedResults.length,
    passed: finalMergedResults.filter(
      (r) => (r.final_status || r.status) === "passed",
    ).length,
    failed: finalMergedResults.filter(
      (r) => (r.final_status || r.status) === "failed",
    ).length,
    skipped: finalMergedResults.filter(
      (r) => (r.final_status || r.status) === "skipped",
    ).length,
    flaky: finalMergedResults.filter(
      (r) => (r.final_status || r.status) === "flaky",
    ).length,
    duration: totalDuration,
  };

  const finalReport = {
    run: combinedRun,
    results: finalMergedResults,
    metadata: {
      generatedAt: new Date().toISOString(),
    },
  };

  try {
    await fs.writeFile(
      finalOutputPath,
      JSON.stringify(
        finalReport,
        (key, value) => {
          if (value instanceof Date) return value.toISOString();
          return value;
        },
        2,
      ),
    );
    console.log(
      `✅ Merged report with ${finalMergedResults.length} total results saved to ${finalOutputPath}`,
    );

    // Clean up the pulse-results directory after a successful merge
    try {
      await fs.rm(pulseResultsDir, { recursive: true, force: true });
      console.log(
        `🧹 Cleaned up temporary reports directory at ${pulseResultsDir}`,
      );
    } catch (cleanupErr) {
      console.warn(
        `Pulse Reporter: Could not clean up individual reports directory. Error: ${cleanupErr.message}`,
      );
    }
  } catch (err) {
    console.error(
      `Pulse Reporter: Failed to write final merged report to ${finalOutputPath}. Error: ${err.message}`,
    );
  }
}
