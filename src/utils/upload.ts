import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { env } from '../config/env';

const UPLOAD_DIR = env.uploadsDir;

// Whitelist of safe file extensions
const SAFE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.txt',
]);

/** Ensure the upload directory exists (auto-create if not) */
function ensureUploadDir(subDir?: string): string {
  const dir = subDir ? path.join(UPLOAD_DIR, subDir) : UPLOAD_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitize file extension to prevent path traversal and dangerous file types.
 */
function sanitizeExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  // Only allow known safe extensions
  if (!SAFE_EXTENSIONS.has(ext)) {
    return '.bin'; // fallback to safe extension
  }
  return ext;
}

/**
 * Save a file buffer to the local flowkyn_uploads folder.
 * Returns the public URL path for the file.
 */
export function saveFile(
  fileBuffer: Buffer,
  originalName: string,
  subDir: string = 'general'
): { filePath: string; fileName: string; url: string } {
  const dir = ensureUploadDir(subDir);
  const ext = sanitizeExtension(originalName);
  const fileName = `${uuid()}${ext}`;
  const filePath = path.join(dir, fileName);

  // Verify the resolved path is within UPLOAD_DIR (prevent path traversal)
  const resolvedPath = path.resolve(filePath);
  const resolvedUploadDir = path.resolve(UPLOAD_DIR);
  if (!resolvedPath.startsWith(resolvedUploadDir)) {
    throw new Error('Invalid file path');
  }

  fs.writeFileSync(filePath, fileBuffer);

  // URL is relative — served via express.static
  const url = `${env.baseUrl}/uploads/${subDir}/${fileName}`;

  return { filePath, fileName, url };
}

/**
 * Delete a file from the uploads folder.
 */
export function deleteFile(relativePath: string): boolean {
  // Sanitize: no .. allowed in path
  if (relativePath.includes('..')) return false;

  const fullPath = path.join(UPLOAD_DIR, relativePath);
  const resolvedPath = path.resolve(fullPath);
  const resolvedUploadDir = path.resolve(UPLOAD_DIR);

  if (!resolvedPath.startsWith(resolvedUploadDir)) return false;

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    return true;
  }
  return false;
}

/**
 * Get the allowed mime types for uploads.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

export const ALLOWED_FILE_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export function isAllowedImageType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(mimeType);
}

export function isAllowedFileType(mimeType: string): boolean {
  return ALLOWED_FILE_TYPES.includes(mimeType);
}
