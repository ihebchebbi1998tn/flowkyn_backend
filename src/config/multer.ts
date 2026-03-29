import multer from 'multer';

/** Multer storage — memory buffer, then we save via upload utility */
const storage = multer.memoryStorage();

/** SECURITY: Allowed MIME types for images */
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** SECURITY: Blocked MIME types (executables, scripts, etc.) */
const BLOCKED_MIMES = [
  'application/x-executable',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-php',
  'text/html',
  'image/svg+xml', // SECURITY: SVG can embed JavaScript
  'application/xml',
  'text/xml',
  'application/x-powershell',
  'application/x-java',
  'application/zip', // Consider if zip uploads are needed
  'application/x-rar-compressed',
  'application/x-7z-compressed',
];

/** SECURITY: Blocked file extensions (defense in depth) */
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com',
  '.sh', '.bash', '.zsh', '.fish',
  '.php', '.jsp', '.asp', '.aspx',
  '.py', '.java', '.class', '.jar',
  '.js', '.mjs', '.ts', '.tsx',
  '.html', '.htm', '.svg', '.xml',
  '.zip', '.rar', '.7z', '.tar', '.gz',
];

/**
 * Helper: Validate file extension against blocklist
 */
function isBlockedExtension(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return BLOCKED_EXTENSIONS.includes(ext);
}

/** Avatar upload — max 5MB, images only */
export const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // SECURITY: Check extension first (defense in depth)
    if (isBlockedExtension(file.originalname)) {
      return cb(new Error(`File extension not allowed: ${file.originalname}`));
    }
    // SECURITY: SVG removed — can contain JavaScript (stored XSS)
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      return cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
    }
    cb(null, true);
  },
});

/** General file upload — max 10MB, with blocklist */
export const fileUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // SECURITY: Check extension first (defense in depth)
    if (isBlockedExtension(file.originalname)) {
      return cb(new Error(`File extension not allowed: ${file.originalname}`));
    }
    // SECURITY: Block known dangerous MIME types
    if (BLOCKED_MIMES.includes(file.mimetype)) {
      return cb(new Error('This file type is not allowed'));
    }
    cb(null, true);
  },
});

/** Org logo upload — max 5MB images, no SVG */
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // SECURITY: Check extension first (defense in depth)
    if (isBlockedExtension(file.originalname)) {
      return cb(new Error(`File extension not allowed: ${file.originalname}`));
    }
    // SECURITY: Only allow safe image formats
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      return cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
    }
    cb(null, true);
  },
});
