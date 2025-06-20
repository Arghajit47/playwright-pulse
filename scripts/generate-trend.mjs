#!/usr/bin/env node
import * as fs from "fs/promises";
import path from "path";

// Use dynamic import for chalk as it's ESM only for prettier console logs
let chalk;
try {
  chalk = (await import("chalk")).default;
} catch (e) {
  chalk = {
    green: (t) => t,
    red: (t) => t,
    yellow: (t) => t,
    blue: (t) => t,
    bold: (t) => t,
  };
}

const DEFAULT_OUTPUT_DIR = "pulse-report";
const CURRENT_RUN_JSON_FILE = "playwright-pulse-report.json"; // Source of the current run data
const HISTORY_SUBDIR = "history"; // Subdirectory for historical JSON files
const HISTORY_FILE_PREFIX = "trend-";
const MAX_HISTORY_FILES = 15; // Store last 15 runs

async function archiveCurrentRunData() {
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const currentRunJsonPath = path.join(outputDir, CURRENT_RUN_JSON_FILE);
  const historyDir = path.join(outputDir, HISTORY_SUBDIR);

  try {
    // 1. Ensure history directory exists
    await fs.mkdir(historyDir, { recursive: true });
    // console.log(chalk.blue(`History directory ensured at: ${historyDir}`));

    // 2. Read the current run's JSON data
    // console.log(chalk.blue(`Reading current run data from: ${currentRunJsonPath}`));
    let currentReportData;
    try {
      const jsonData = await fs.readFile(currentRunJsonPath, "utf-8");
      currentReportData = JSON.parse(jsonData);
      if (
        !currentReportData ||
        !currentReportData.run ||
        !currentReportData.run.timestamp
      ) {
        throw new Error(
          "Invalid current run JSON report structure. Missing 'run' or 'run.timestamp' data."
        );
      }
    } catch (error) {
      console.error(
        chalk.red(
          `Error reading or parsing current run JSON report at ${currentRunJsonPath}: ${error.message}`
        )
      );
      process.exit(1); // Exit if we can't read the source file
    }

    // 3. Determine the filename for the new history file
    // Ensure timestamp is a valid number before using getTime()
    let runTimestampMs;
    try {
      runTimestampMs = new Date(currentReportData.run.timestamp).getTime();
      if (isNaN(runTimestampMs)) {
        throw new Error(
          `Invalid timestamp value: ${currentReportData.run.timestamp}`
        );
      }
    } catch (dateError) {
      console.error(
        chalk.red(
          `Failed to parse timestamp '${currentReportData.run.timestamp}': ${dateError.message}`
        )
      );
      process.exit(1);
    }

    const newHistoryFileName = `${HISTORY_FILE_PREFIX}${runTimestampMs}.json`;
    const newHistoryFilePath = path.join(historyDir, newHistoryFileName);

    // 4. Write the current run's data to the new history file
    // console.log(chalk.blue(`Saving current run data to: ${newHistoryFilePath}`));
    await fs.writeFile(
      newHistoryFilePath,
      JSON.stringify(currentReportData, null, 2),
      "utf-8"
    );
    console.log(chalk.green(`Archived current run to: ${newHistoryFilePath}`));

    // 5. Prune old history files
    await pruneOldHistoryFiles(historyDir);
  } catch (error) {
    console.error(
      chalk.red(`Error in archiveCurrentRunData: ${error.message}`)
    );
    // console.error(error.stack); // Uncomment for more detailed stack trace
    process.exit(1);
  }
}

async function pruneOldHistoryFiles(historyDir) {
  // console.log(chalk.blue(`Pruning old history files in ${historyDir} (keeping last ${MAX_HISTORY_FILES})...`));
  try {
    const files = await fs.readdir(historyDir);
    const historyJsonFiles = files
      .filter(
        (file) => file.startsWith(HISTORY_FILE_PREFIX) && file.endsWith(".json")
      )
      .map((file) => {
        const timestampPart = file
          .replace(HISTORY_FILE_PREFIX, "")
          .replace(".json", "");
        return { name: file, timestamp: parseInt(timestampPart, 10) };
      })
      .filter((file) => !isNaN(file.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp); // Sort ascending (oldest first)

    if (historyJsonFiles.length > MAX_HISTORY_FILES) {
      const filesToDelete = historyJsonFiles.slice(
        0,
        historyJsonFiles.length - MAX_HISTORY_FILES
      );
      console.log(
        chalk.yellow(
          `Found ${historyJsonFiles.length} history files. Pruning ${filesToDelete.length} oldest file(s)...`
        )
      );
      for (const fileMeta of filesToDelete) {
        const filePathToDelete = path.join(historyDir, fileMeta.name);
        try {
          await fs.unlink(filePathToDelete);
          // console.log(chalk.gray(`Deleted old history file: ${fileMeta.name}`));
        } catch (deleteError) {
          console.warn(
            chalk.yellow(
              `Could not delete old history file ${fileMeta.name}: ${deleteError.message}`
            )
          );
        }
      }
    } else {
      // console.log(chalk.green(`Found ${historyJsonFiles.length} history files. No pruning needed.`));
    }
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Warning during history pruning in ${historyDir}: ${error.message}`
      )
    );
    // Don't exit for pruning errors, as saving the current run is more critical
  }
}

// Main execution
archiveCurrentRunData().catch((error) => {
  // Fallback catch, though critical errors in archiveCurrentRunData should exit
  if (process.exitCode === undefined || process.exitCode === 0) {
    // check if not already exited
    console.error(
      chalk.red.bold("An unexpected error occurred in history archiving:"),
      error
    );
    process.exit(1);
  }
});
