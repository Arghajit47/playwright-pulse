// src/utils/compression-utils.ts
/**
 * Compression utilities for images
 * Uses sharp for image compression (works cross-platform with no external dependencies)
 */

import * as fs from 'fs/promises';
import * as path from 'path';


/**
 * Compress an image file in-place
 * @param filePath - Absolute path to the image file
 * @param options - Compression options
 */
export async function compressImage(
  filePath: string,
  options: { quality?: number } = {}
): Promise<void> {
  try {
    const sharp = require('sharp');
    const quality = options.quality || 75;
    const ext = path.extname(filePath).toLowerCase();
    
    // Read original file
    const imageBuffer = await fs.readFile(filePath);
    
    let compressedBuffer: Buffer;
    
    if (ext === '.png') {
      // Compress PNG
      compressedBuffer = await sharp(imageBuffer)
        .png({ quality, compressionLevel: 9 })
        .toBuffer();
    } else if (ext === '.jpg' || ext === '.jpeg') {
      // Compress JPEG
      compressedBuffer = await sharp(imageBuffer)
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    } else if (ext === '.webp') {
      // Compress WebP
      compressedBuffer = await sharp(imageBuffer)
        .webp({ quality })
        .toBuffer();
    } else if (ext === '.gif') {
      // Compress GIF
      compressedBuffer = await sharp(imageBuffer)
        .gif()
        .toBuffer();
    } else if (ext === '.tiff' || ext === '.tif') {
      // Compress TIFF
      compressedBuffer = await sharp(imageBuffer)
        .tiff({ quality, compression: 'lzw' })
        .toBuffer();
    } else {
      // Unsupported format, skip compression
      return;
    }
    
    // Only overwrite if compression actually reduced size
    if (compressedBuffer.length < imageBuffer.length) {
      await fs.writeFile(filePath, compressedBuffer);
    }
  } catch (error: any) {
    // File remains unchanged
  }
}


/**
 * Compress an attachment file (auto-detects type)
 * Note: Only compresses images. Videos are already compressed by Playwright.
 * @param filePath - Absolute path to the file
 * @param contentType - MIME content type
 */
export async function compressAttachment(
  filePath: string,
  contentType: string
): Promise<void> {
  if (contentType.startsWith('image/')) {
    await compressImage(filePath, { quality: 75 });
  }
  // Videos are skipped - already compressed by Playwright as WebM
}
