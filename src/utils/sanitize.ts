/**
 * Input sanitization utility — strips potential XSS vectors from text content.
 * Used for user-generated content like messages, posts, descriptions.
 */

/** Remove HTML tags from a string */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')           // Remove HTML tags
    .replace(/&lt;/g, '<')             // Decode common entities for re-stripping
    .replace(/&gt;/g, '>')
    .replace(/<[^>]*>/g, '')           // Strip again after decode
    .replace(/javascript:/gi, '')      // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '')        // Remove event handlers (onclick=, etc.)
    .replace(/data:\s*text\/html/gi, '') // Remove data:text/html
    .trim();
}

/** Sanitize user-generated text — safe for storage, prevents stored XSS */
export function sanitizeText(input: string, maxLength: number = 10000): string {
  if (typeof input !== 'string') return '';
  return stripHtml(input).slice(0, maxLength);
}

/** Sanitize a potential URL — must be http/https only */
export function sanitizeUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
