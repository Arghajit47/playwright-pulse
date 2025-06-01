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
  _excelFilePath;
  _maxRuns = 15;

  constructor(outputDir, excelFileName = TREND_EXCEL_FILE_NAME) {
    this._excelFilePath = path.join(outputDir, excelFileName);
  }

  getExcelFilePath() {
    return this._excelFilePath;
  }

  async _readExistingData() {
    try {
      await fs.access(this._excelFilePath);
      const buffer = await fs.readFile(this._excelFilePath);
      return XLSX.read(buffer, { type: "buffer" });
    } catch {
      return null;
    }
  }

  _shiftOverallRuns(data, currentNumericRunId) {
    const validData = Array.isArray(data) ? data : [];
    const pastOrCurrentData = validData.filter(
      (row) =>
        row.hasOwnProperty("RUN_ID") &&
        typeof row.RUN_ID === "number" &&
        row.RUN_ID <= currentNumericRunId
    );
    const sortedData = [...pastOrCurrentData].sort(
      (a, b) => a.RUN_ID - b.RUN_ID
    );
    if (sortedData.length > this._maxRuns) {
      return sortedData.slice(sortedData.length - this._maxRuns);
    }
    return sortedData;
  }

  async updateTrendData(
    runIdFromReport,
    timestamp,
    totalTests,
    passed,
    failed,
    skipped,
    duration,
    testResultsForThisRun
  ) {
    let workbook = await this._readExistingData();
    const numericRunId = Math.floor(timestamp / 1000);

    if (!workbook) {
      workbook = XLSX.utils.book_new();
      // If the workbook is new, SheetNames will be empty.
      // We need to initialize it if it doesn't exist
      if (!workbook.SheetNames) {
        workbook.SheetNames = [];
      }
    } else {
      // Ensure SheetNames exists even for existing workbooks (should, but defensive)
      if (!workbook.SheetNames) {
        workbook.SheetNames = [];
      }
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
            "Could not parse existing 'overall' sheet. Starting fresh. Error:",
            e.message
          )
        );
        existingOverallData = [];
      }
    }
    existingOverallData = existingOverallData.filter(
      (row) => row.RUN_ID !== numericRunId
    );
    const newOverallRow = {
      RUN_ID: numericRunId,
      DURATION: duration,
      TIMESTAMP: timestamp,
      TOTAL_TESTS: totalTests,
      PASSED: passed,
      FAILED: failed,
      SKIPPED: skipped,
    };
    let updatedOverallData = [...existingOverallData, newOverallRow];
    updatedOverallData = this._shiftOverallRuns(
      updatedOverallData,
      numericRunId
    );

    const overallSheet = XLSX.utils.json_to_sheet(updatedOverallData);

    // UPDATED: Use book_append_sheet for new sheets, or replace existing
    if (!workbook.SheetNames.includes("overall")) {
      XLSX.utils.book_append_sheet(workbook, overallSheet, "overall");
      // Move "overall" to the beginning if it was just added and not already first
      const overallIndex = workbook.SheetNames.indexOf("overall");
      if (overallIndex > 0) {
        const sheetName = workbook.SheetNames.splice(overallIndex, 1)[0];
        workbook.SheetNames.unshift(sheetName);
      }
    } else {
      workbook.Sheets["overall"] = overallSheet; // Replace existing
    }
    XLSX.utils.book_set_sheet_visibility(workbook, "overall", 0);

    // --- Per-Test Data Sheet for the Current Run ---
    const runKey = `test run ${numericRunId}`;
    const currentRunTestData = testResultsForThisRun.map((test) => ({
      TEST_NAME: test.name,
      DURATION: test.duration,
      STATUS: test.status,
      TIMESTAMP: timestamp,
    }));
    const testRunSheet = XLSX.utils.json_to_sheet(currentRunTestData);

    // UPDATED: Logic to add or replace the sheet and ensure it's in SheetNames
    if (!workbook.SheetNames.includes(runKey)) {
      XLSX.utils.book_append_sheet(workbook, testRunSheet, runKey); // This adds to Sheets and SheetNames
    } else {
      workbook.Sheets[runKey] = testRunSheet; // Just replace the sheet data
    }
    // Now that the sheet is guaranteed to be in SheetNames and workbook.Sheets, set visibility
    XLSX.utils.book_set_sheet_visibility(workbook, runKey, 0);

    // --- Maintain Max Sheet Count for Individual Test Runs ---
    let testRunSheetNames = workbook.SheetNames.filter(
      (name) => name.toLowerCase().startsWith("test run ") && name !== "overall"
    );
    testRunSheetNames.sort((a, b) => {
      const matchA = a.match(/test run (\d+)$/i);
      const matchB = b.match(/test run (\d+)$/i);
      const idA = matchA && matchA[1] ? parseInt(matchA[1], 10) : 0;
      const idB = matchB && matchB[1] ? parseInt(matchB[1], 10) : 0;
      return idA - idB;
    });

    if (testRunSheetNames.length > this._maxRuns) {
      const sheetsToRemoveCount = testRunSheetNames.length - this._maxRuns;
      const removedSheetNames = [];
      for (let i = 0; i < sheetsToRemoveCount; i++) {
        const oldestSheetName = testRunSheetNames[i];
        // Remove from workbook.Sheets
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
        chalk.red(`Failed to write Excel file at ${this._excelFilePath}`)
      );
      console.error(chalk.red("Write Error Details:"), writeError);
      throw writeError;
    }
  }
}

async function generateTrendExcel() {
  const outputDir = path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  const jsonReportPath = path.join(outputDir, DEFAULT_JSON_FILE);

  // Ensure output directory exists before any file operations
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (mkdirError) {
    console.error(
      chalk.red(`Failed to create output directory ${outputDir}:`),
      mkdirError
    );
    process.exit(1);
  }

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
    console.error(chalk.red("JSON Read/Parse Error Details:"), error);
    process.exit(1);
  }

  const { run, results } = reportData;
  if (!run.timestamp || isNaN(new Date(run.timestamp).getTime())) {
    console.error(
      chalk.red(`Invalid or missing run.timestamp in JSON: ${run.timestamp}`)
    );
    process.exit(1);
  }
  const runTimestamp = new Date(run.timestamp).getTime();

  const testResultsForExcel = results.map((r) => ({
    name: r.name,
    duration: r.duration,
    status: r.status,
  }));

  const excelManager = new ExcelTrendManager(outputDir);
  try {
    await excelManager.updateTrendData(
      run.id,
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
    console.error(chalk.red("Excel Generation Error Details:"), excelError);
    process.exit(1);
  }
}

generateTrendExcel().catch((error) => {
  console.error(
    chalk.red("An unexpected error occurred in generate-trend-excel:"),
    error
  );
  process.exit(1);
});