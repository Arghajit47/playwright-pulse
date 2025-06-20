#!/usr/bin/env node
import nodemailer from "nodemailer"; // CHANGED
import path from "path"; // CHANGED (already was, but good to be explicit)
import archiver from "archiver"; // CHANGED
import {
  createWriteStream,
  readFileSync as fsReadFileSync, // Renamed to avoid conflict if fs from fs/promises is used
  existsSync as fsExistsSync, // Renamed
} from "fs"; // CHANGED for specific functions
import { fileURLToPath } from "url";
import { fork } from "child_process"; // This was missing in your sendReport.js but present in generate-email-report.js and needed for runScript
import "dotenv/config"; // CHANGED for dotenv

// Import chalk using top-level await if your Node version supports it (14.8+)
// or keep the dynamic import if preferred, but ensure chalk is resolved before use.
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

const reportDir = "./pulse-report";

let fetch;
// Ensure fetch is imported and available before it's used in fetchCredentials
// Using a top-level import is generally cleaner:
// import fetch from 'node-fetch';
// However, your dynamic import pattern is also fine if `fetch` is awaited properly.
// For simplicity, I'll assume the dynamic import is handled and awaited before fetchCredentials is called.
// The existing dynamic import for fetch is okay.

let projectName;

function getUUID() {
  const reportPath = path.join(
    process.cwd(),
    `${reportDir}/playwright-pulse-report.json`
  );
  console.log("Report path:", reportPath);

  if (!fsExistsSync(reportPath)) {
    // CHANGED
    throw new Error("Pulse report file not found.");
  }

  const content = JSON.parse(fsReadFileSync(reportPath, "utf-8")); // CHANGED
  const idString = content.run.id;
  const parts = idString.split("-");
  const uuid = parts.slice(-5).join("-");
  return uuid;
}

function formatDuration(ms) {
  const seconds = (ms / 1000).toFixed(2);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${seconds}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
const formatStartTime = (isoString) => {
  const date = new Date(isoString);
  return date.toLocaleString(); // Default locale
};

const getPulseReportSummary = () => {
  const reportPath = path.join(
    process.cwd(),
    `${reportDir}/playwright-pulse-report.json`
  );

  if (!fsExistsSync(reportPath)) {
    // CHANGED
    throw new Error("Pulse report file not found.");
  }

  const content = JSON.parse(fsReadFileSync(reportPath, "utf-8")); // CHANGED
  const run = content.run;

  const total = run.totalTests || 0;
  const passed = run.passed || 0;
  const failed = run.failed || 0;
  const skipped = run.skipped || 0;
  const durationInMs = run.duration || 0; // Keep in ms for formatDuration

  const readableStartTime = new Date(run.timestamp).toLocaleString();

  return {
    total,
    passed,
    failed,
    skipped,
    passedPercentage: total ? ((passed / total) * 100).toFixed(2) : "0.00",
    failedPercentage: total ? ((failed / total) * 100).toFixed(2) : "0.00",
    skippedPercentage: total ? ((skipped / total) * 100).toFixed(2) : "0.00",
    startTime: readableStartTime,
    duration: formatDuration(durationInMs), // Pass ms to formatDuration
  };
};

const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));

const zipFolder = async (folderPath, zipPath) => {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath); // CHANGED
    const archiveInstance = archiver("zip", { zlib: { level: 9 } }); // Renamed to avoid conflict

    output.on("close", () => {
      console.log(`${archiveInstance.pointer()} total bytes`);
      console.log("Folder has been zipped successfully.");
      resolve();
    });

    archiveInstance.on("error", (err) => {
      reject(err);
    });

    archiveInstance.pipe(output);
    archiveInstance.directory(folderPath, false);
    archiveInstance.finalize();
  });
};

const generateHtmlTable = (data) => {
  projectName = "Pulse Emailable Report"; // Consider passing projectName as an arg or making it a const
  const stats = data;
  const total = stats.passed + stats.failed + stats.skipped;
  const passedTests = stats.passed;
  const passedPercentage = stats.passedPercentage;
  const failedTests = stats.failed;
  const failedPercentage = stats.failedPercentage;
  const skippedTests = stats.skipped;
  const skippedPercentage = stats.skippedPercentage;
  const startTime = stats.startTime;
  const durationString = stats.duration; // Already formatted string

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Stats Report</title>
    <style>
      table {
        width: 100%;
        border-collapse: collapse;
      }
      table, th, td {
        border: 1px solid black;
      }
      th, td {
        padding: 8px;
        text-align: left;
      }
      th {
        background-color: #f2f2f2;
      }
    </style>
  </head>
  <body>
    <h1>${projectName} Statistics</h1>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Test Start Time</td>
          <td>${startTime}</td>
        </tr>
        <tr>
          <td>Test Run Duration</td> 
          <td>${durationString}</td>
        </tr>
        <tr>
          <td>Total Tests Count</td>
          <td>${total}</td>
        </tr>
        <tr>
          <td>Tests Passed</td>
          <td>${passedTests} (${passedPercentage}%)</td>
        </tr>
        <tr>
          <td>Skipped Tests</td>
          <td>${skippedTests} (${skippedPercentage}%)</td>
        </tr>
        <tr>
          <td>Test Failed</td>
          <td>${failedTests} (${failedPercentage}%)</td>
        </tr>
      </tbody>
    </table>
    <p>With regards,</p>
    <p>QA / SDET</p>
  </body>
  </html>
  `;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the name here matches the actual file name of input_file_0.js
// If input_file_0.js is indeed the script, use that name.
// Using .mjs extension explicitly tells Node to treat it as ESM.
const archiveRunScriptPath = path.resolve(
  __dirname,
  "generate-email-report.mjs" // Or input_file_0.mjs if you rename it, or input_file_0.js if you configure package.json
);

async function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const childProcess = fork(scriptPath, [], {
      // Renamed variable
      stdio: "inherit",
    });

    childProcess.on("error", (err) => {
      console.error(chalk.red(`Failed to start script: ${scriptPath}`), err);
      reject(err);
    });

    childProcess.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const errorMessage = `Script ${scriptPath} exited with code ${code}.`;
        console.error(chalk.red(errorMessage));
        reject(new Error(errorMessage));
      }
    });
  });
}

const sendEmail = async (credentials) => {
  await runScript(archiveRunScriptPath);
  try {
    console.log("Starting the sendEmail function...");

    const secureTransporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: credentials.username,
        pass: credentials.password,
      },
    });

    const reportData = getPulseReportSummary();
    const htmlContent = generateHtmlTable(reportData);

    const mailOptions = {
      from: credentials.username,
      to: [
        process.env.RECIPIENT_EMAIL_1 || "",
        process.env.RECIPIENT_EMAIL_2 || "",
        process.env.RECIPIENT_EMAIL_3 || "",
        process.env.RECIPIENT_EMAIL_4 || "",
        process.env.RECIPIENT_EMAIL_5 || "",
      ].filter((email) => email), // Filter out empty strings
      subject: "Pulse Report " + new Date().toLocaleString(),
      html: htmlContent,
      attachments: [
        {
          filename: `report.html`,
          // Make sure this path is correct and the file is generated by archiveRunScriptPath
          path: path.join(reportDir, "pulse-email-summary.html"),
        },
      ],
    };

    const info = await secureTransporter.sendMail(mailOptions);
    console.log("Email sent: ", info.response);
  } catch (error) {
    console.error("Error sending email: ", error);
  }
};

async function fetchCredentials(retries = 6) {
  // Ensure fetch is initialized from the dynamic import before calling this
  if (!fetch) {
    try {
      fetch = (await import("node-fetch")).default;
    } catch (err) {
      console.error(
        "Failed to import node-fetch dynamically for fetchCredentials:",
        err
      );
      return null;
    }
  }

  const timeout = 10000;
  const key = getUUID();

  if (!key) {
    console.error(
      "🔴 Critical: API key (UUID from report) not found or invalid."
    );
    return null;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🟡 Attempt ${attempt} of ${retries} to fetch credentials`);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Request timed out after ${timeout}ms`));
        }, timeout);
      });

      const fetchPromise = fetch(
        "https://test-dashboard-66zd.onrender.com/api/getcredentials",
        {
          method: "GET",
          headers: {
            "x-api-key": `${key}`,
          },
        }
      );

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        if (response.status === 401) {
          console.error("🔴 Invalid API key - authentication failed");
        } else if (response.status === 404) {
          console.error("🔴 Endpoint not found - check the API URL");
        } else {
          console.error(`🔴 Fetch failed with status: ${response.status}`);
        }
        if (attempt < retries)
          await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const data = await response.json();

      if (!data.username || !data.password) {
        console.error("🔴 Invalid credentials format received from API");
        if (attempt < retries)
          await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      console.log("🟢 Fetched credentials successfully");
      return data;
    } catch (err) {
      console.error(`🔴 Attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) {
        console.error(
          `🔴 All ${retries} attempts failed. Last error: ${err.message}`
        );
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null; // Should be unreachable if loop logic is correct
}

const main = async () => {
  // Ensure fetch is initialized (dynamic import at top or here)
  if (!fetch) {
    try {
      fetch = (await import("node-fetch")).default;
    } catch (err) {
      console.error("Failed to import node-fetch at start of main:", err);
      process.exit(1); // Or handle error appropriately
    }
  }

  const credentials = await fetchCredentials();
  if (!credentials) {
    console.warn(
      "Skipping email sending due to missing or failed credential fetch"
    );
    return;
  }
  // Removed await delay(10000); // If not strictly needed, remove it.
  try {
    await sendEmail(credentials);
  } catch (error) {
    console.error("Error in main function: ", error);
  }
};

main();
