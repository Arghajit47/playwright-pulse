/**
 * Compression utilities for images
 * Uses sharp for image compression (works cross-platform with no external dependencies)
 */
/**
 * Compress an image file in-place
 * @param filePath - Absolute path to the image file
 * @param options - Compression options
 */
export declare function compressImage(filePath: string, options?: {
    quality?: number;
}): Promise<void>;
/**
 * Compress an attachment file (auto-detects type)
 * Note: Only compresses images. Videos are already compressed by Playwright.
 * @param filePath - Absolute path to the file
 * @param contentType - MIME content type
 */
export declare function compressAttachment(filePath: string, contentType: string): Promise<void>;
