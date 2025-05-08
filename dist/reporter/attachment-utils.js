"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachFiles = attachFiles;
const path = __importStar(require("path"));
const fs = __importStar(require("fs")); // Use synchronous methods for simplicity in this context
const ATTACHMENTS_SUBDIR = "attachments"; // Consistent subdirectory name
/**
 * Processes attachments from a Playwright TestResult and updates the PulseTestResult.
 * @param testId A unique identifier for the test, used for folder naming.
 * @param pwResult The TestResult object from Playwright.
 * @param pulseResult The internal test result structure to update.
 * @param config The reporter configuration options.
 */
function attachFiles(testId, pwResult, pulseResult, config) {
    const baseReportDir = config.outputDir || "pulse-report"; // Base output directory
    // Ensure attachments are relative to the main outputDir
    const attachmentsBaseDir = path.resolve(baseReportDir, ATTACHMENTS_SUBDIR); // Absolute path for FS operations
    const attachmentsSubFolder = testId.replace(/[^a-zA-Z0-9_-]/g, "_"); // Sanitize testId for folder name
    const testAttachmentsDir = path.join(attachmentsBaseDir, attachmentsSubFolder); // e.g., pulse-report/attachments/test_id_abc
    try {
        if (!fs.existsSync(testAttachmentsDir)) {
            fs.mkdirSync(testAttachmentsDir, { recursive: true });
        }
    }
    catch (error) {
        console.error(`Pulse Reporter: Failed to create attachments directory: ${testAttachmentsDir}`, error);
        return; // Stop processing if directory creation fails
    }
    if (!pwResult.attachments)
        return;
    const { base64Images } = config; // Get base64 embedding option
    pulseResult.screenshots = []; // Initialize screenshots array
    pwResult.attachments.forEach((attachment) => {
        const { contentType, name, path: attachmentPath, body } = attachment;
        // Skip attachments without path or body
        if (!attachmentPath && !body) {
            console.warn(`Pulse Reporter: Attachment "${name}" for test ${testId} has no path or body. Skipping.`);
            return;
        }
        // Determine filename
        const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "_"); // Sanitize original name
        const extension = attachmentPath
            ? path.extname(attachmentPath)
            : `.${getFileExtension(contentType)}`;
        const baseFilename = attachmentPath
            ? path.basename(attachmentPath, extension)
            : safeName;
        // Ensure unique filename within the test's attachment folder
        const fileName = `${baseFilename}_${Date.now()}${extension}`;
        // Relative path for storing in JSON (relative to baseReportDir)
        const relativePath = path.join(ATTACHMENTS_SUBDIR, attachmentsSubFolder, fileName);
        // Full path for file system operations
        const fullPath = path.join(testAttachmentsDir, fileName);
        if (contentType === null || contentType === void 0 ? void 0 : contentType.startsWith("image/")) {
            // Handle all image types consistently
            handleImage(attachmentPath, body, base64Images, fullPath, relativePath, pulseResult, name);
        }
        else if (name === "video" || (contentType === null || contentType === void 0 ? void 0 : contentType.startsWith("video/"))) {
            handleAttachment(attachmentPath, body, fullPath, relativePath, "videoPath", pulseResult);
        }
        else if (name === "trace" || contentType === "application/zip") {
            // Trace files are zips
            handleAttachment(attachmentPath, body, fullPath, relativePath, "tracePath", pulseResult);
        }
        else {
            // Handle other generic attachments if needed (e.g., log files)
            // console.log(`Pulse Reporter: Processing generic attachment "${name}" (Type: ${contentType}) for test ${testId}`);
            // handleAttachment(attachmentPath, body, fullPath, relativePath, 'otherAttachments', pulseResult); // Example for storing other types
        }
    });
}
/**
 * Handles image attachments, either embedding as base64 or copying the file.
 */
function handleImage(attachmentPath, body, base64Embed, fullPath, relativePath, pulseResult, attachmentName) {
    let screenshotData = undefined;
    if (attachmentPath) {
        try {
            if (base64Embed) {
                const fileContent = fs.readFileSync(attachmentPath, "base64");
                screenshotData = `data:image/${getFileExtension(attachmentName)};base64,${fileContent}`;
            }
            else {
                fs.copyFileSync(attachmentPath, fullPath);
                screenshotData = relativePath;
            }
        }
        catch (error) {
            console.error(`Pulse Reporter: Failed to read/copy screenshot file: ${attachmentPath}. Error: ${error.message}`);
        }
    }
    else if (body) {
        // Always embed if only body is available
        screenshotData = `data:image/${getFileExtension(attachmentName)};base64,${body.toString("base64")}`;
        if (!base64Embed) {
            // Optionally save the buffer to a file even if embedding is off,
            // but the primary representation will be base64.
            try {
                fs.writeFileSync(fullPath, body);
                // console.log(`Pulse Reporter: Saved screenshot buffer to ${fullPath}`);
            }
            catch (error) {
                console.error(`Pulse Reporter: Failed to save screenshot buffer: ${fullPath}. Error: ${error.message}`);
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
function handleAttachment(attachmentPath, body, fullPath, relativePath, resultKey, // Add more keys if needed
pulseResult) {
    try {
        if (attachmentPath) {
            fs.copyFileSync(attachmentPath, fullPath);
            pulseResult[resultKey] = relativePath;
        }
        else if (body) {
            fs.writeFileSync(fullPath, body);
            pulseResult[resultKey] = relativePath; // Store relative path even if from buffer
        }
    }
    catch (error) {
        console.error(`Pulse Reporter: Failed to copy/write attachment to ${fullPath}. Error: ${error.message}`);
        // Don't set the path in pulseResult if saving failed
    }
}
/**
 * Determines a file extension based on content type.
 * @param contentType The MIME type string.
 * @returns A file extension string.
 */
function getFileExtension(contentType) {
    var _a;
    if (!contentType)
        return "bin"; // Default binary extension
    // More robust mapping
    const extensions = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/svg+xml": "svg",
        "video/webm": "webm",
        "video/mp4": "mp4",
        "application/zip": "zip", // For traces
        "text/plain": "txt",
        "application/json": "json",
    };
    return (extensions[contentType.toLowerCase()] ||
        ((_a = contentType.split("/")[1]) === null || _a === void 0 ? void 0 : _a.split("+")[0]) ||
        "bin");
}
