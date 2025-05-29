// generate-trend-excel.mjs
import * as fs from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";

// Use dynamic import for chalk as it's ESM only for prettier console logs
let chalk;
try {
  chalk = (await import("chalk")).default;
} catch (e) {
  chalk = { green: (t) => t, red: (t) => t, yellow: (t) => t, blue: (t) => t }; // Basic fallback
}

const DEFAULT_OUTPUT_DIR = "pulse-report"; // Should match reporter's outputDir
const DEFAULT_JSON_FILE = "playwright-pulse-report.json";
const TREND_EXCEL_FILE_NAME = "trend.xls";

class ExcelTrendManager {
  // Convention for "private" members in JS often uses an underscore
  _excelFilePath;
  _maxRuns = 5; // Max history runs to keep in Excel (excluding overall)

  constructor(outputDir, excelFileName = TREND_EXCEL_FILE_NAME) {
    this._excelFilePath = path.join(outputDir, excelFileName);
  }

  // Method to get the Excel file path (was public, still is by default)
  getExcelFilePath() {
    return this._excelFilePath;
  }

  async _readExistingData() {
    // Conventionally "private"
    try {
      await fs.access(this._excelFilePath);
      const buffer = await fs.readFile(this._excelFilePath);
      return XLSX.read(buffer, { type: "buffer" });
    } catch {
      return null; // File doesn't exist or not accessible
    }
  }

  _shiftOverallRuns(data, currentNumericRunId) {
    // Conventionally "private"
    // Ensure data is an array
    const validData = Array.isArray(data) ? data : [];

    // Filter out any potential future runs or non-numeric RUN_ID entries
    const pastOrCurrentData = validData.filter(
      (row) =>
        row.hasOwnProperty("RUN_ID") &&
        typeof row.RUN_ID === "number" &&
        row.RUN_ID <= currentNumericRunId
    );

    // Add current run's data (it's already added to the array before calling this)
    // Sort by RUN_ID to ensure correct order before shifting
    const sortedData = [...pastOrCurrentData].sort(
      (a, b) => a.RUN_ID - b.RUN_ID
    );

    if (sortedData.length > this._maxRuns) {
      return sortedData.slice(sortedData.length - this._maxRuns);
    }
    return sortedData;
  }

  async updateTrendData(
    runIdFromReport, // This is the string ID from JSON, e.g., "run-timestamp-uuid"
    timestamp, // JS timestamp (ms since epoch)
    totalTests,
    passed,
    failed,
    skipped,
    duration,
    testResultsForThisRun
  ) {
    let workbook = await this._readExistingData();

    // For Excel sheet naming and internal ID, use a simpler numeric ID.
    const numericRunId = Math.floor(timestamp / 1000); // Use seconds since epoch

    if (!workbook) {
      workbook = XLSX.utils.book_new();
    }

    // --- Overall Data ---
    let existingOverallData = [];
    if (workbook.Sheets["overall"]) {
      try {
        existingOverallData = XLSX.utils.sheet_to_json(
          workbook.Sheets["overall"]
        );
      } catch (e) {
        console.warn(
          chalk.yellow(
            "Could not parse existing 'overall' sheet. Starting fresh."
          )
        );
        existingOverallData = [];
      }
    }

    // Avoid duplicate entries for the same numericRunId
    existingOverallData = existingOverallData.filter(
      (row) => row.RUN_ID !== numericRunId
    );

    const newOverallRow = {
      RUN_ID: numericRunId, // Use numeric ID for sorting and management
      DURATION: duration,
      TIMESTAMP: timestamp, // Store the original ms timestamp for potential full-date reconstruction
      TOTAL_TESTS: totalTests,
      PASSED: passed,
      FAILED: failed,
      SKIPPED: skipped,
    };

    let updatedOverallData = [...existingOverallData, newOverallRow];
    // Pass numericRunId to _shiftOverallRuns for correct comparison
    updatedOverallData = this._shiftOverallRuns(
      updatedOverallData,
      numericRunId
    );

    const overallSheet = XLSX.utils.json_to_sheet(updatedOverallData);
    // Ensure "overall" sheet is visible and typically first
    if (workbook.SheetNames.includes("overall")) {
      workbook.Sheets["overall"] = overallSheet; // Replace existing
    } else {
      XLSX.utils.book_append_sheet(workbook, overallSheet, "overall");
      // Move "overall" to the beginning if it was just added
      const overallIndex = workbook.SheetNames.indexOf("overall");
      if (overallIndex > 0) {
        const sheetName = workbook.SheetNames.splice(overallIndex, 1)[0];
        workbook.SheetNames.unshift(sheetName);
      }
    }
    XLSX.utils.book_set_sheet_visibility(
      workbook,
      "overall",
      XLSX.utils.SHEET_VISIBLE
    );

    // --- Per-Test Data Sheet for the Current Run ---
    const runKey = `test run ${numericRunId}`; // Sheet name based on numeric ID
    const currentRunTestData = testResultsForThisRun.map((test) => ({
      TEST_NAME: test.name,
      DURATION: test.duration,
      STATUS: test.status,
      TIMESTAMP: timestamp, // Timestamp of the run
    }));

    const testRunSheet = XLSX.utils.json_to_sheet(currentRunTestData);
    workbook.Sheets[runKey] = testRunSheet; // Add or replace the sheet
    XLSX.utils.book_set_sheet_visibility(
      workbook,
      runKey,
      XLSX.utils.SHEET_VISIBLE
    );

    // Add to SheetNames if new, ensuring no duplicates
    if (!workbook.SheetNames.includes(runKey)) {
      workbook.SheetNames.push(runKey);
    }

    // --- Maintain Max Sheet Count for Individual Test Runs ---
    let testRunSheetNames = workbook.SheetNames.filter(
      (name) => name.toLowerCase().startsWith("test run ") && name !== "overall"
    );

    testRunSheetNames.sort((a, b) => {
      const idA = parseInt(a.split(" ").pop() || "0", 10);
      const idB = parseInt(b.split(" ").pop() || "0", 10);
      return idA - idB; // Sort by the numeric part of "test run X"
    });

    if (testRunSheetNames.length > this._maxRuns) {
      const sheetsToRemoveCount = testRunSheetNames.length - this._maxRuns;
      const removedSheetNames = [];
      for (let i = 0; i < sheetsToRemoveCount; i++) {
        const oldestSheetName = testRunSheetNames[i];
        delete workbook.Sheets[oldestSheetName];
        removedSheetNames.push(oldestSheetName);
      }
      // Rebuild SheetNames array without the removed sheets
      workbook.SheetNames = workbook.SheetNames.filter(
        (name) => !removedSheetNames.includes(name)
      );
    }

    // --- Write Workbook ---
    try {
      const buffer = XLSX.write(workbook, { bookType: "xls", type: "buffer" });
      await fs.writeFile(this._excelFilePath, buffer);
      console.log(
        chalk.green(
          `Excel trend report updated successfully at ${this._excelFilePath}`
        )
      );
    } catch (writeError) {
      console.error(
        chalk.red(`Failed to write Excel file at ${this._excelFilePath}`),
        writeError
      );
      throw writeError;
    }
  }
}

async function generateTrendExcel() {
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const jsonReportPath = path.join(outputDir, DEFAULT_JSON_FILE);

  await fs.mkdir(outputDir, { recursive: true }); // Ensure output directory exists

  console.log(chalk.blue(`Reading JSON report from: ${jsonReportPath}`));

  let reportData;
  try {
    const jsonData = await fs.readFile(jsonReportPath, "utf-8");
    reportData = JSON.parse(jsonData);
    if (!reportData || !reportData.run || !Array.isArray(reportData.results)) {
      throw new Error(
        "Invalid JSON report structure. Missing 'run' or 'results' data."
      );
    }
  } catch (error) {
    console.error(
      chalk.red(`Error reading or parsing JSON report: ${error.message}`)
    );
    process.exit(1);
  }

  const { run, results } = reportData;
  const runTimestamp = new Date(run.timestamp).getTime();

  const testResultsForExcel = results.map((r) => ({
    name: r.name,
    duration: r.duration,
    status: r.status,
  }));

  const excelManager = new ExcelTrendManager(outputDir);
  try {
    await excelManager.updateTrendData(
      run.id, // The original string run ID from JSON
      runTimestamp,
      run.totalTests,
      run.passed,
      run.failed,
      run.skipped,
      run.duration,
      testResultsForExcel
    );
  } catch (excelError) {
    console.error(chalk.red("Aborting due to error during Excel generation."));
    process.exit(1);
  }
}

// Main execution
generateTrendExcel().catch((error) => {
  console.error(
    chalk.red("An unexpected error occurred in generate-trend-excel:"),
    error
  );
  process.exit(1);
});
