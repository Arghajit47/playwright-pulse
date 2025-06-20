import type { TestResult as PwTestResult } from "@playwright/test/reporter";
import * as path from "path";
import * as fs from "fs"; // Use synchronous methods for simplicity in this context
import type { TestResult, PlaywrightPulseReporterOptions } from "../types"; // Use project's types

const ATTACHMENTS_SUBDIR = "attachments"; // Consistent subdirectory name

/**
 * Processes attachments from a Playwright TestResult and updates the PulseTestResult.
 * @param testId A unique identifier for the test, used for folder naming.
 * @param pwResult The TestResult object from Playwright.
 * @param pulseResult The internal test result structure to update.
 * @param config The reporter configuration options.
 */
export function attachFiles(
  testId: string,
  pwResult: PwTestResult,
  pulseResult: TestResult,
  config: PlaywrightPulseReporterOptions
) {
  const baseReportDir = config.outputDir || "pulse-report";
  const attachmentsBaseDir = path.resolve(baseReportDir, ATTACHMENTS_SUBDIR);
  const attachmentsSubFolder = testId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const testAttachmentsDir = path.join(
    attachmentsBaseDir,
    attachmentsSubFolder
  );

  try {
    if (!fs.existsSync(testAttachmentsDir)) {
      fs.mkdirSync(testAttachmentsDir, { recursive: true });
    }
  } catch (error: any) {
    console.error(
      `Pulse Reporter: Failed to create attachments directory: ${testAttachmentsDir}`,
      error
    );
    return;
  }

  if (!pwResult.attachments) return;

  const { base64Images } = config;

  // --- MODIFICATION: Initialize all attachment arrays to prevent errors ---
  pulseResult.screenshots = [];
  pulseResult.videoPath = [];
  pulseResult.attachments = [];

  pwResult.attachments.forEach((attachment) => {
    const { contentType, name, path: attachmentPath, body } = attachment;

    if (!attachmentPath && !body) {
      console.warn(
        `Pulse Reporter: Attachment "${name}" for test ${testId} has no path or body. Skipping.`
      );
      return;
    }

    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const extension = attachmentPath
      ? path.extname(attachmentPath)
      : `.${getFileExtension(contentType)}`;
    const baseFilename = attachmentPath
      ? path.basename(attachmentPath, extension)
      : safeName;
    const fileName = `${baseFilename}_${Date.now()}${extension}`;

    const relativePath = path.join(
      ATTACHMENTS_SUBDIR,
      attachmentsSubFolder,
      fileName
    );
    const fullPath = path.join(testAttachmentsDir, fileName);

    if (contentType?.startsWith("image/")) {
      handleImage(
        attachmentPath,
        body,
        base64Images,
        fullPath,
        relativePath,
        pulseResult,
        name
      );
    } else if (name === "video" || contentType?.startsWith("video/")) {
      handleAttachment(
        attachmentPath,
        body,
        fullPath,
        relativePath,
        "videoPath",
        pulseResult,
        attachment
      );
    } else if (name === "trace" || contentType === "application/zip") {
      handleAttachment(
        attachmentPath,
        body,
        fullPath,
        relativePath,
        "tracePath",
        pulseResult,
        attachment
      );
    } else {
      // --- MODIFICATION: Enabled handling for all other file types ---
      handleAttachment(
        attachmentPath,
        body,
        fullPath,
        relativePath,
        "attachments",
        pulseResult,
        attachment
      );
    }
  });
}

/**
 * Handles image attachments, either embedding as base64 or copying the file.
 * (This function is unchanged)
 */
function handleImage(
  attachmentPath: string | undefined,
  body: Buffer | undefined,
  base64Embed: boolean | undefined,
  fullPath: string,
  relativePath: string,
  pulseResult: TestResult,
  attachmentName: string
) {
  let screenshotData: string | undefined = undefined;

  if (attachmentPath) {
    try {
      if (base64Embed) {
        const fileContent = fs.readFileSync(attachmentPath, "base64");
        screenshotData = `data:image/${getFileExtension(
          attachmentName
        )};base64,${fileContent}`;
      } else {
        fs.copyFileSync(attachmentPath, fullPath);
        screenshotData = relativePath;
      }
    } catch (error: any) {
      console.error(
        `Pulse Reporter: Failed to read/copy screenshot file: ${attachmentPath}. Error: ${error.message}`
      );
    }
  } else if (body) {
    screenshotData = `data:image/${getFileExtension(
      attachmentName
    )};base64,${body.toString("base64")}`;
    if (!base64Embed) {
      try {
        fs.writeFileSync(fullPath, body);
      } catch (error: any) {
        console.error(
          `Pulse Reporter: Failed to save screenshot buffer: ${fullPath}. Error: ${error.message}`
        );
      }
    }
  }

  if (screenshotData) {
    if (!pulseResult.screenshots) {
      pulseResult.screenshots = [];
    }
    pulseResult.screenshots.push(screenshotData);
  }
}

/**
 * Handles non-image attachments by copying the file or writing the buffer.
 */
function handleAttachment(
  attachmentPath: string | undefined,
  body: Buffer | undefined,
  fullPath: string,
  relativePath: string,
  resultKey: "videoPath" | "tracePath" | "attachments", // MODIFIED: Added 'attachments'
  pulseResult: TestResult,
  originalAttachment: PwTestResult["attachments"][0] // MODIFIED: Pass original attachment
) {
  try {
    if (attachmentPath) {
      fs.copyFileSync(attachmentPath, fullPath);
    } else if (body) {
      fs.writeFileSync(fullPath, body);
    }

    // --- MODIFICATION: Logic to handle different properties correctly ---
    switch (resultKey) {
      case "videoPath":
        pulseResult.videoPath?.push(relativePath);
        break;
      case "tracePath":
        pulseResult.tracePath = relativePath;
        break;
      case "attachments":
        pulseResult.attachments?.push({
          name: originalAttachment.name,
          path: relativePath,
          contentType: originalAttachment.contentType,
        });
        break;
    }
  } catch (error: any) {
    console.error(
      `Pulse Reporter: Failed to copy/write attachment to ${fullPath}. Error: ${error.message}`
    );
  }
}

/**
 * Determines a file extension based on content type.
 * @param contentType The MIME type string.
 * @returns A file extension string.
 */
function getFileExtension(contentType: string | undefined): string {
  if (!contentType) return "bin";

  const extensions: { [key: string]: string } = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/webm": "webm",
    "video/mp4": "mp4",
    "application/zip": "zip",
    "text/plain": "txt",
    "application/json": "json",
    "text/html": "html",
    "application/pdf": "pdf",
    "text/csv": "csv",
  };
  return (
    extensions[contentType.toLowerCase()] ||
    contentType.split("/")[1]?.split("+")[0] ||
    "bin"
  );
}
