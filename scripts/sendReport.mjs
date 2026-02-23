#!/usr/bin/env node
import nodemailer from "nodemailer";
import path from "path";
import archiver from "archiver";
import {
  createWriteStream,
  readFileSync as fsReadFileSync,
  existsSync as fsExistsSync,
} from "fs";
import { fileURLToPath } from "url";
import { animate } from "./terminal-logo.mjs";
import { fork } from "child_process";
import "dotenv/config";
import { getOutputDir } from "./config-reader.mjs";

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
let projectName;

function getUUID(reportDir) {
  const reportPath = path.join(reportDir, "playwright-pulse-report.json");
  console.log("Report path:", reportPath);

  if (!fsExistsSync(reportPath)) {
    throw new Error("Pulse report file not found.");
  }

  const content = JSON.parse(fsReadFileSync(reportPath, "utf-8"));
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

const getPulseReportSummary = (reportDir) => {
  const reportPath = path.join(reportDir, "playwright-pulse-report.json");

  if (!fsExistsSync(reportPath)) {
    throw new Error("Pulse report file not found.");
  }

  const content = JSON.parse(fsReadFileSync(reportPath, "utf-8"));
  const run = content.run;

  const total = run.totalTests || 0;
  const passed = run.passed || 0;
  const failed = run.failed || 0;
  const skipped = run.skipped || 0;
  const durationInMs = run.duration || 0;

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
    duration: formatDuration(durationInMs),
  };
};

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
  const durationString = stats.duration;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Stats Report</title>
  <style>
    @keyframes slideUpFade {
      0% { opacity: 0; transform: translateY(20px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes gentlePulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); }
    }
    @keyframes popIn {
      0% { opacity: 0; transform: scale(0.5); }
      80% { transform: scale(1.1); }
      100% { opacity: 1; transform: scale(1); }
    }
    .anim-card { animation: slideUpFade 0.8s ease-out forwards; }
    .anim-logo { animation: gentlePulse 3s infinite ease-in-out; }
    .anim-row-1 { animation: slideUpFade 0.5s ease-out 0.2s backwards; }
    .anim-row-2 { animation: slideUpFade 0.5s ease-out 0.3s backwards; }
    .anim-row-3 { animation: slideUpFade 0.5s ease-out 0.4s backwards; }
    .anim-row-4 { animation: slideUpFade 0.5s ease-out 0.5s backwards; }
    .anim-badge { animation: popIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.6s backwards; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 0;">
    <tr>
      <td align="center">
        <table class="anim-card" role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); overflow: hidden;">
          <tr><td height="6" style="background-color: #4f46e5;"></td></tr>
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
                <tr class="anim-row-3">
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #4b5563;">Tests Failed</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; text-align: right;">
                    <span class="anim-badge" style="background-color: #f3f4f6; color: #991b1b; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; display: inline-block; white-space: nowrap;">
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
const archiveRunScriptPath = path.resolve(
  __dirname,
  "generate-email-report.mjs",
);

async function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const childProcess = fork(scriptPath, args, { stdio: "inherit" });
    childProcess.on("error", (err) => {
      console.error(chalk.red(`Failed to start script: ${scriptPath}`), err);
      reject(err);
    });
    childProcess.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script ${scriptPath} exited with code ${code}.`));
    });
  });
}

const sendEmail = async (credentials, reportDir) => {
  const archiveArgs = customOutputDir ? ["--outputDir", customOutputDir] : [];
  await runScript(archiveRunScriptPath, archiveArgs);

  try {
    console.log("Starting the sendEmail function...");
    const reportData = getPulseReportSummary(reportDir);
    const htmlContent = generateHtmlTable(reportData);

    const recipients = [
      process.env.RECIPIENT_EMAIL_1 || "",
      process.env.RECIPIENT_EMAIL_2 || "",
      process.env.RECIPIENT_EMAIL_3 || "",
      process.env.RECIPIENT_EMAIL_4 || "",
      process.env.RECIPIENT_EMAIL_5 || "",
    ].filter((email) => email);

    // --- DEFAULT FLOW: BREVO API ---
    if (credentials.apiKey) {
      const SENDER_NAME = "Pulse Email Report";
      const attachmentPath = path.join(reportDir, "pulse-email-summary.html");
      let attachments = [];
      if (fsExistsSync(attachmentPath)) {
        // Brevo requires attachments to be Base64 encoded strings
        const fileContent = fsReadFileSync(attachmentPath).toString("base64");
        attachments.push({
          content: fileContent,
          name: "report.html",
        });
      }
      const payload = {
        sender: {
          name: SENDER_NAME,
          email: credentials.username,
        },
        to: recipients.map((email) => ({ email })),
        subject: "Pulse Report " + new Date().toLocaleString(),
        htmlContent: htmlContent,
        attachment: attachments,
      };

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": credentials.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (response.ok) {
        console.log("Email sent: ", result.messageId);
      } else {
        console.error(
          "Error sending email via Brevo: ",
          result.message || result,
        );
      }
      return; // Exit after default flow
    }

    // --- CUSTOM FLOW: GMAIL / OUTLOOK ---
    let secureTransporter;
    const mailHost = credentials.host
      ? credentials.host.toLowerCase()
      : "gmail";

    if (mailHost === "gmail") {
      secureTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: credentials.username, pass: credentials.password },
      });
    } else if (mailHost === "outlook") {
      secureTransporter = nodemailer.createTransport({
        host: "smtp.outlook.com",
        port: 587,
        secure: false,
        auth: { user: credentials.username, pass: credentials.password },
      });
    } else {
      console.log(
        chalk.red(
          "Pulse report currently do not support provided mail host, kindly use either outlook mail or, gmail",
        ),
      );
      process.exit(1);
    }

    const mailOptions = {
      from: credentials.username,
      to: recipients,
      subject: "Pulse Report " + new Date().toLocaleString(),
      html: htmlContent,
      attachments: [
        {
          filename: `report.html`,
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
  if (!fetch) {
    try {
      fetch = (await import("node-fetch")).default;
    } catch (err) {
      console.error(
        "Failed to import node-fetch dynamically for fetchCredentials:",
        err,
      );
      return null;
    }
  }

  const timeout = 10000;
  const key = getUUID(reportDir);

  if (!key) {
    console.error(
      "🔴 Critical: API key (UUID from report) not found or invalid.",
    );
    return null;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🟡 Attempt ${attempt} of ${retries} to fetch credentials`);

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(
        "https://get-credentials.netlify.app/api/getcredentials",
        {
          method: "GET",
          headers: { "x-api-key": `${key}` },
          signal: controller.signal,
        },
      );
      clearTimeout(id);

      if (!response.ok) {
        if (attempt < retries)
          await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const data = await response.json();
      console.log("🟢 Fetched credentials successfully");
      return data; // Returns data which now contains 'apiKey' for Brevo
    } catch (err) {
      console.error(`🔴 Attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) return null;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
}

const main = async () => {
  await animate();
  if (!fetch) {
    try {
      fetch = (await import("node-fetch")).default;
    } catch (err) {
      console.error("Failed to import node-fetch at start of main:", err);
      process.exit(1);
    }
  }

  const reportDir = await getOutputDir(customOutputDir);
  console.log(chalk.blue(`Preparing to send email report...`));
  console.log(chalk.blue(`Report directory set to: ${reportDir}`));

  let credentials;

  if (
    process.env.PULSE_MAIL_HOST &&
    process.env.PULSE_MAIL_USERNAME &&
    process.env.PULSE_MAIL_PASSWORD
  ) {
    const host = process.env.PULSE_MAIL_HOST.toLowerCase();
    if (host !== "gmail" && host !== "outlook") {
      console.log(
        chalk.red(
          "Pulse report currently do not support provided mail host, kindly use either outlook mail or, gmail.",
        ),
      );
      process.exit(1);
    }
    console.log(
      chalk.blue(
        `Using custom credentials from environment variables for ${host}.`,
      ),
    );
    credentials = {
      username: process.env.PULSE_MAIL_USERNAME,
      password: process.env.PULSE_MAIL_PASSWORD,
      host: host,
    };
  } else {
    credentials = await fetchCredentials(reportDir);
    if (!credentials) {
      console.warn(
        "Skipping email sending due to missing or failed credential fetch",
      );
      return;
    }
  }

  try {
    await sendEmail(credentials, reportDir);
  } catch (error) {
    console.error("Error in main function: ", error);
  }
};

main();
