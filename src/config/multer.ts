import multer from 'multer';

/** Multer storage — memory buffer, then we save via upload utility */
const storage = multer.memoryStorage();

/** Avatar upload — max 5MB, images only */
export const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // SECURITY: SVG removed — can contain JavaScript (stored XSS)
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
    }
  },
});

/** General file upload — max 10MB */
export const fileUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const blocked = [
      'application/x-executable',
      'application/x-msdownload',
      'application/x-sh',
      'application/x-php',
      'text/html',
      'image/svg+xml', // SECURITY: SVG can embed JS
      'application/xml',
      'text/xml',
    ];
    if (blocked.includes(file.mimetype)) {
      cb(new Error('This file type is not allowed'));
    } else {
      cb(null, true);
    }
  },
});

/** Org logo upload — max 5MB images, no SVG */
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
    }
  },
});
