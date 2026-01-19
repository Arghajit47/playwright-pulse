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
import { getOutputDir } from "./config-reader.mjs";

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

const args = process.argv.slice(2);
let customOutputDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--outputDir" || args[i] === "-o") {
    customOutputDir = args[i + 1];
    break;
  }
}

let fetch;
// Ensure fetch is imported and available before it's used in fetchCredentials
// Using a top-level import is generally cleaner:
// import fetch from 'node-fetch';
// However, your dynamic import pattern is also fine if `fetch` is awaited properly.
// For simplicity, I'll assume the dynamic import is handled and awaited before fetchCredentials is called.
// The existing dynamic import for fetch is okay.

let projectName;

function getUUID(reportDir) {
  const reportPath = path.join(reportDir, "playwright-pulse-report.json");
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

const getPulseReportSummary = (reportDir) => {
  const reportPath = path.join(reportDir, "playwright-pulse-report.json");

  if (!fsExistsSync(reportPath)) {
    // CHANGED
    throw new Error("Pulse report file not found.");
  }

  const content = JSON.parse(fsReadFileSync(reportPath, "utf-8")); // D
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
    /* ANIMATION KEYFRAMES 
      (Supported by Apple Mail, iOS, Outlook Mac, etc.)
    */
    
    /* 1. Slide the card up and fade in */
    @keyframes slideUpFade {
      0% { opacity: 0; transform: translateY(20px); }
      100% { opacity: 1; transform: translateY(0); }
    }

    /* 2. Gentle pulse for the logo */
    @keyframes gentlePulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); }
    }

    /* 3. Pop in effect for status badges */
    @keyframes popIn {
      0% { opacity: 0; transform: scale(0.5); }
      80% { transform: scale(1.1); }
      100% { opacity: 1; transform: scale(1); }
    }

    /* CLASSES TO APPLY ANIMATIONS */
    .anim-card {
      animation: slideUpFade 0.8s ease-out forwards;
    }
    
    .anim-logo {
      animation: gentlePulse 3s infinite ease-in-out;
    }

    /* Staggered delays for list items so they cascade in */
    .anim-row-1 { animation: slideUpFade 0.5s ease-out 0.2s backwards; }
    .anim-row-2 { animation: slideUpFade 0.5s ease-out 0.3s backwards; }
    .anim-row-3 { animation: slideUpFade 0.5s ease-out 0.4s backwards; }
    .anim-row-4 { animation: slideUpFade 0.5s ease-out 0.5s backwards; }

    .anim-badge {
      animation: popIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.6s backwards;
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 0;">
    <tr>
      <td align="center">
        
        <table class="anim-card" role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <tr>
            <td height="6" style="background-color: #4f46e5;"></td>
          </tr>

          <tr>
            <td style="padding: 32px 32px 20px 32px;">
              <table border="0" cellspacing="0" cellpadding="0" width="100%">
                <tr>
                  <td width="55" style="vertical-align: middle; padding-right: 16px;">
                    <img class="anim-logo" src="https://ocpaxmghzmfbuhxzxzae.supabase.co/storage/v1/object/public/images/pulse-report/playwright_pulse_icon.png" alt="Report Logo" height="40" style="display: block; border: 0; border-radius: 8px;">
                  </td>
                  <td style="vertical-align: middle;">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #111827;">${projectName}</h1>
                    <p style="margin: 4px 0 0 0; font-size: 14px; color: #6b7280;">Automated Execution Report</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 32px 20px 32px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 16px; border-right: 1px solid #e5e7eb; width: 50%;">
                    <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; font-weight: 600;">Start Time</p>
                    <p style="margin: 0; font-size: 14px; color: #374151; font-weight: 500;">${startTime}</p>
                  </td>
                  <td style="padding: 16px; width: 50%;">
                    <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; font-weight: 600;">Duration</p>
                    <p style="margin: 0; font-size: 14px; color: #374151; font-weight: 500;">${durationString}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 32px 32px 32px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                
                <tr class="anim-row-1">
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #4b5563;">Total Tests Executed</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; text-align: right; font-size: 14px; font-weight: 600; color: #111827;">${total}</td>
                </tr>

                <tr class="anim-row-2">
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #4b5563;">Tests Passed</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; text-align: right;">
                    <span class="anim-badge" style="background-color: #d1fae5; color: #065f46; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; display: inline-block; white-space: nowrap;">
                      ${passedTests} (${passedPercentage}%)
                    </span>
                  </td>
                </tr>

                <tr class="anim-row-3" style="background-color: ${
                  failedTests > 0 ? "#fef2f2" : "transparent"
                };">
                  <td style="padding: 12px 10px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: ${
                    failedTests > 0 ? "#991b1b" : "#4b5563"
                  }; font-weight: ${
  failedTests > 0 ? "700" : "400"
}; border-radius: 4px 0 0 4px;">
                    Tests Failed
                  </td>
                  <td style="padding: 12px 10px; border-bottom: 1px solid #f3f4f6; text-align: right; border-radius: 0 4px 4px 0;">
                    <span class="anim-badge" style="background-color: ${
                      failedTests > 0 ? "#ffffff" : "#f3f4f6"
                    }; color: ${
  failedTests > 0 ? "#991b1b" : "#9ca3af"
}; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; display: inline-block; white-space: nowrap;">
                      ${failedTests} (${failedPercentage}%)
                    </span>
                  </td>
                </tr>

                <tr class="anim-row-4">
                  <td style="padding: 12px 0; font-size: 14px; color: #4b5563;">Tests Skipped</td>
                  <td style="padding: 12px 0; text-align: right;">
                    <span class="anim-badge" style="background-color: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; display: inline-block; white-space: nowrap;">
                      ${skippedTests} (${skippedPercentage}%)
                    </span>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">Generated by Pulse Report</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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

async function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const childProcess = fork(scriptPath, args, {
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

const sendEmail = async (credentials, reportDir) => {
  const archiveArgs = customOutputDir ? ["--outputDir", customOutputDir] : [];
  await runScript(archiveRunScriptPath, archiveArgs);
  try {
    console.log("Starting the sendEmail function...");

    let secureTransporter;
    const mailHost = credentials.host
      ? credentials.host.toLowerCase()
      : "gmail";

    if (mailHost === "gmail") {
      secureTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: credentials.username,
          pass: credentials.password,
        },
      });
    } else if (mailHost === "outlook") {
      secureTransporter = nodemailer.createTransport({
        host: "smtp.outlook.com",
        port: 587,
        secure: false,
        auth: {
          user: credentials.username,
          pass: credentials.password,
        },
      });
    } else {
      // Should be caught in main, but safety check here
      console.log(
        chalk.red(
          "Pulse report currently do not support provided mail host, kindly use either outlook mail or, gmail"
        )
      );
      process.exit(1);
    }

    const reportData = getPulseReportSummary(reportDir);
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

async function fetchCredentials(reportDir, retries = 10) {
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
  const key = getUUID(reportDir);

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
        "https://get-credentials.netlify.app/api/getcredentials",
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

  const reportDir = await getOutputDir(customOutputDir);

  console.log(chalk.blue(`Preparing to send email report...`));
  console.log(chalk.blue(`Report directory set to: ${reportDir}`));
  if (customOutputDir) {
    console.log(chalk.gray(`  (from CLI argument)`));
  } else {
    console.log(
      chalk.gray(`  (auto-detected from playwright.config or using default)`)
    );
  }

  // --- MODIFIED: Credentials Selection Logic ---
  let credentials;

  // Check if custom environment variables are provided
  if (
    process.env.PULSE_MAIL_HOST &&
    process.env.PULSE_MAIL_USERNAME &&
    process.env.PULSE_MAIL_PASSWORD
  ) {
    const host = process.env.PULSE_MAIL_HOST.toLowerCase();

    // Validate host immediately
    if (host !== "gmail" && host !== "outlook") {
      console.log(
        chalk.red(
          "Pulse report currently do not support provided mail host, kindly use either outlook mail or, gmail."
        )
      );
      process.exit(1);
    }

    console.log(
      chalk.blue(
        `Using custom credentials from environment variables for ${host}.`
      )
    );
    credentials = {
      username: process.env.PULSE_MAIL_USERNAME,
      password: process.env.PULSE_MAIL_PASSWORD,
      host: host,
    };
  } else {
    // Fallback to existing fetch mechanism
    credentials = await fetchCredentials(reportDir);
    if (!credentials) {
      console.warn(
        "Skipping email sending due to missing or failed credential fetch"
      );
      return;
    }
    // Mark fetched credentials as gmail by default for compatibility
    credentials.host = "gmail";
  }
  // --- END MODIFICATION ---
  // Removed await delay(10000); // If not strictly needed, remove it.
  try {
    await sendEmail(credentials, reportDir);
  } catch (error) {
    console.error("Error in main function: ", error);
  }
};

main();
