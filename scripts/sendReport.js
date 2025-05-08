#!/usr/bin/env node
const nodemailer = require("nodemailer");
const path = require("path");
const archiver = require("archiver");
const fileSystem = require("fs");
const reportDir = "./pulse-report";

require("dotenv").config();

let fetch;
import("node-fetch")
  .then((module) => {
    fetch = module.default;
  })
  .catch((err) => {
    console.error("Failed to import node-fetch:", err);
    process.exit(1);
  });

let projectName;

function getUUID() {
  const reportPath = path.join(
    process.cwd(),
    `${reportDir}/playwright-pulse-report.json`
  );
  console.log("Report path:", reportPath);

  if (!fileSystem.existsSync(reportPath)) {
    throw new Error("Pulse report file not found.");
  }

  const content = JSON.parse(fileSystem.readFileSync(reportPath, "utf-8"));
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

// Generate test-data from allure report
const getPulseReportSummary = () => {
  const reportPath = path.join(
    process.cwd(),
    `${reportDir}/playwright-pulse-report.json`
  );

  if (!fileSystem.existsSync(reportPath)) {
    throw new Error("Pulse report file not found.");
  }

  const content = JSON.parse(fileSystem.readFileSync(reportPath, "utf-8"));
  const run = content.run;

  const total = run.totalTests || 0;
  const passed = run.passed || 0;
  const failed = run.failed || 0;
  const skipped = run.skipped || 0;
  const duration = (run.duration || 0) / 1000; // Convert ms to seconds

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
    duration: formatDuration(duration),
  };
};

// sleep function for javascript file
const delay = (time) => new Promise((resolve) => setTimeout(resolve, time));
// Function to zip the folder asynchronously using async/await
const zipFolder = async (folderPath, zipPath) => {
  return new Promise((resolve, reject) => {
    const output = fileSystem.createWriteStream(zipPath); // Must use require("fs") directly here
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`${archive.pointer()} total bytes`);
      console.log("Folder has been zipped successfully.");
      resolve(); // Resolve the promise after zipping is complete
    });

    archive.on("error", (err) => {
      reject(err); // Reject the promise in case of an error
    });

    archive.pipe(output);
    archive.directory(folderPath, false); // Zip the folder without the parent folder
    archive.finalize(); // Finalize the archive
  });
};

// Function to convert JSON data to HTML table format
const generateHtmlTable = (data) => {
  projectName = "Pulse Emailable Report";
  const stats = data;
  const total = stats.passed + stats.failed + stats.skipped;
  const passedTests = stats.passed;
  const passedPercentage = stats.passedPercentage;
  const failedTests = stats.failed;
  const failedPercentage = stats.failedPercentage;
  const skippedTests = stats.skipped;
  const skippedPercentage = stats.skippedPercentage;
  const startTime = stats.startTime;
  const durationSeconds = stats.duration;

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
    <h1>${projectName} Statistics Report</h1>
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
          <td>Test Run Duration (Seconds)</td>
          <td>${durationSeconds}</td>
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
    <p>Networks QA Team</p>
  </body>
  </html>
  `;
};

// Async function to send an email
const sendEmail = async (credentials) => {
  try {
    console.log("Starting the sendEmail function...");

    // Configure nodemailer transporter
    const secureTransporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // Use SSL/TLS
      auth: {
        user: credentials.username,
        pass: credentials.password, // Ensure you use app password or secured token
      },
    });
    // Generate HTML content for email
    const reportData = getPulseReportSummary();
    const htmlContent = generateHtmlTable(reportData);

    // Configure mail options
    const mailOptions = {
      from: credentials.username,
      to: [
        process.env.SENDER_EMAIL_1 || "",
        process.env.SENDER_EMAIL_2 || "",
        process.env.SENDER_EMAIL_3 || "",
        process.env.SENDER_EMAIL_4 || "",
        process.env.SENDER_EMAIL_5 || "",
      ],
      subject: "Pulse Report " + new Date().toLocaleString(),
      html: htmlContent,
      attachments: [
        {
          filename: `report.html`,
          path: `${reportDir}/playwright-pulse-static-report.html`, // Attach the zipped folder
        },
      ],
    };

    // Send email
    const info = await secureTransporter.sendMail(mailOptions);
    console.log("Email sent: ", info.response);
  } catch (error) {
    console.error("Error sending email: ", error);
  }
};

async function fetchCredentials(retries = 6) {
  const timeout = 10000; // 10 seconds timeout
  const key = getUUID();
  // Validate API key exists before making any requests
  if (!key) {
    console.error(
      "🔴 Critical: API key not provided - please set EMAIL_KEY in your environment variables"
    );
    console.warn("🟠 Falling back to default credentials (if any)");
    return null; // Return null instead of throwing
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🟡 Attempt ${attempt} of ${retries}`);

      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Request timed out after ${timeout}ms`));
        }, timeout);
      });

      // Create the fetch promise
      const fetchPromise = fetch(
        "https://test-dashboard-66zd.onrender.com/api/getcredentials",
        {
          method: "GET",
          headers: {
            "x-api-key": `${key}`,
          },
        }
      );

      // Race between fetch and timeout
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        // Handle specific HTTP errors with console messages only
        if (response.status === 401) {
          console.error("🔴 Invalid API key - authentication failed");
        } else if (response.status === 404) {
          console.error("🔴 Endpoint not found - check the API URL");
        } else {
          console.error(`🔴 Fetch failed with status: ${response.status}`);
        }
        continue; // Skip to next attempt instead of throwing
      }

      const data = await response.json();

      // Validate the response structure
      if (!data.username || !data.password) {
        console.error("🔴 Invalid credentials format received from API");
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
        console.warn(
          "🟠 Proceeding without credentials - email sending will be skipped"
        );
        return null;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Main function to zip the folder and send the email
const main = async () => {
  await import("node-fetch").then((module) => {
    fetch = module.default;
  });
  const credentials = await fetchCredentials();
  if (!credentials) {
    console.warn("Skipping email sending due to missing credentials");
    // Continue with pipeline without failing
    return;
  }
  await delay(10000);
  try {
    await sendEmail(credentials);
  } catch (error) {
    console.error("Error in main function: ", error);
  }
};

main();
