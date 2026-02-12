"use strict";
// src/utils/compression-utils.ts
/**
 * Compression utilities for images
 * Uses sharp for image compression (works cross-platform with no external dependencies)
 */
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
exports.compressImage = compressImage;
exports.compressAttachment = compressAttachment;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
/**
 * Compress an image file in-place
 * @param filePath - Absolute path to the image file
 * @param options - Compression options
 */
async function compressImage(filePath, options = {}) {
    try {
        const sharp = require('sharp');
        const quality = options.quality || 75;
        const ext = path.extname(filePath).toLowerCase();
        // Read original file
        const imageBuffer = await fs.readFile(filePath);
        let compressedBuffer;
        if (ext === '.png') {
            // Compress PNG
            compressedBuffer = await sharp(imageBuffer)
                .png({ quality, compressionLevel: 9 })
                .toBuffer();
        }
        else if (ext === '.jpg' || ext === '.jpeg') {
            // Compress JPEG
            compressedBuffer = await sharp(imageBuffer)
                .jpeg({ quality, mozjpeg: true })
                .toBuffer();
        }
        else if (ext === '.webp') {
            // Compress WebP
            compressedBuffer = await sharp(imageBuffer)
                .webp({ quality })
                .toBuffer();
        }
        else if (ext === '.gif') {
            // Compress GIF
            compressedBuffer = await sharp(imageBuffer)
                .gif()
                .toBuffer();
        }
        else if (ext === '.tiff' || ext === '.tif') {
            // Compress TIFF
            compressedBuffer = await sharp(imageBuffer)
                .tiff({ quality, compression: 'lzw' })
                .toBuffer();
        }
        else {
            // Unsupported format, skip compression
            return;
        }
        // Only overwrite if compression actually reduced size
        if (compressedBuffer.length < imageBuffer.length) {
            await fs.writeFile(filePath, compressedBuffer);
        }
    }
    catch (error) {
        // File remains unchanged
    }
}
/**
 * Compress an attachment file (auto-detects type)
 * Note: Only compresses images. Videos are already compressed by Playwright.
 * @param filePath - Absolute path to the file
 * @param contentType - MIME content type
 */
async function compressAttachment(filePath, contentType) {
    if (contentType.startsWith('image/')) {
        await compressImage(filePath, { quality: 75 });
    }
    // Videos are skipped - already compressed by Playwright as WebM
}
