"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachFiles = attachFiles;
const path = {
    resolve: (...paths) => paths.join("/"),
    join: (...paths) => paths.join("/"),
    extname: (p) => {
        const parts = p.split(".");
        return parts.length > 1 ? "." + parts.pop() : "";
    },
    basename: (p, ext) => {
        const base = p.split("/").pop() || "";
        return ext ? base.replace(ext, "") : base;
    },
};
const fs = {
    existsSync: (path) => {
        console.log(`Checking if ${path} exists`);
        return false;
    },
    mkdirSync: (path, options) => {
        console.log(`Creating directory ${path}`);
    },
    readFileSync: (path, encoding) => {
        console.log(`Reading file ${path}`);
        return "";
    },
    copyFileSync: (src, dest) => {
        console.log(`Copying ${src} to ${dest}`);
    },
    writeFileSync: (path, data) => {
        console.log(`Writing to ${path}`);
    },
};
const ATTACHMENTS_SUBDIR = "attachments";
function attachFiles(testId, pwResult, pulseResult, config) {
    const baseReportDir = config.outputDir || "pulse-report";
    const attachmentsBaseDir = path.resolve(baseReportDir, ATTACHMENTS_SUBDIR);
    const attachmentsSubFolder = `${testId}-retry-${pwResult.retry || 0}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const testAttachmentsDir = path.join(attachmentsBaseDir, attachmentsSubFolder);
    try {
        if (!fs.existsSync(testAttachmentsDir)) {
            fs.mkdirSync(testAttachmentsDir, { recursive: true });
        }
    }
    catch (error) {
        console.error(`Pulse Reporter: Failed to create attachments directory: ${testAttachmentsDir}`, error);
        return;
    }
    if (!pwResult.attachments)
        return;
    const { base64Images } = config;
    pulseResult.screenshots = [];
    pulseResult.videoPath = [];
    pulseResult.attachments = [];
    pwResult.attachments.forEach((attachment) => {
        const { contentType, name, path: attachmentPath, body } = attachment;
        if (!attachmentPath && !body) {
            console.warn(`Pulse Reporter: Attachment "${name}" for test ${testId} has no path or body. Skipping.`);
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
        const relativePath = path.join(ATTACHMENTS_SUBDIR, attachmentsSubFolder, fileName);
        const fullPath = path.join(testAttachmentsDir, fileName);
        if (contentType === null || contentType === void 0 ? void 0 : contentType.startsWith("image/")) {
            handleImage(attachmentPath, body, base64Images, fullPath, relativePath, pulseResult, name);
        }
        else if (name === "video" || (contentType === null || contentType === void 0 ? void 0 : contentType.startsWith("video/"))) {
            handleAttachment(attachmentPath, body, fullPath, relativePath, "videoPath", pulseResult, attachment);
        }
        else if (name === "trace" || contentType === "application/zip") {
            handleAttachment(attachmentPath, body, fullPath, relativePath, "tracePath", pulseResult, attachment);
        }
        else {
            handleAttachment(attachmentPath, body, fullPath, relativePath, "attachments", pulseResult, attachment);
        }
    });
}
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
        screenshotData = `data:image/${getFileExtension(attachmentName)};base64,${body.toString("base64")}`;
        if (!base64Embed) {
            try {
                fs.writeFileSync(fullPath, body);
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
function handleAttachment(attachmentPath, body, fullPath, relativePath, resultKey, pulseResult, originalAttachment) {
    var _a, _b;
    try {
        if (attachmentPath) {
            fs.copyFileSync(attachmentPath, fullPath);
        }
        else if (body) {
            fs.writeFileSync(fullPath, body);
        }
        switch (resultKey) {
            case "videoPath":
                (_a = pulseResult.videoPath) === null || _a === void 0 ? void 0 : _a.push(relativePath);
                break;
            case "tracePath":
                pulseResult.tracePath = relativePath;
                break;
            case "attachments":
                (_b = pulseResult.attachments) === null || _b === void 0 ? void 0 : _b.push({
                    name: originalAttachment.name,
                    path: relativePath,
                    contentType: originalAttachment.contentType,
                });
                break;
        }
    }
    catch (error) {
        console.error(`Pulse Reporter: Failed to copy/write attachment to ${fullPath}. Error: ${error.message}`);
    }
}
function getFileExtension(contentType) {
    var _a;
    if (!contentType)
        return "bin";
    const extensions = {
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
    return (extensions[contentType.toLowerCase()] ||
        ((_a = contentType.split("/")[1]) === null || _a === void 0 ? void 0 : _a.split("+")[0]) ||
        "bin");
}
