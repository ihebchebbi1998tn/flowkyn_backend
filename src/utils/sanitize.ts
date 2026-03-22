/**
 * Input sanitization utility — strips potential XSS vectors from text content.
 * Used for user-generated content like messages, posts, descriptions.
 * 
 * SECURITY: This utility is CRITICAL for preventing stored XSS attacks.
 * DO NOT bypass this function for user-generated content.
 */

/** Remove HTML tags from a string with enhanced XSS prevention */
export function stripHtml(input: string): string {
  // FIX #2: Enhanced XSS Prevention (Wins of Week Security)
  // Remove various XSS attack vectors:
  
  return input
    // 1. Remove all HTML tags
    .replace(/<[^>]*>/g, '')
    
    // 2. Decode common entities to prevent double-encoding bypasses
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    
    // 3. Re-strip any tags that emerged from decoding
    .replace(/<[^>]*>/g, '')
    
    // 4. Remove dangerous protocols
    .replace(/javascript:/gi, '')      // javascript: protocol
    .replace(/vbscript:/gi, '')        // vbscript: protocol
    .replace(/data:/gi, '')            // data: protocol (for embedded HTML/JS)
    .replace(/file:/gi, '')            // file: protocol
    
    // 5. Remove event handlers and attributes
    .replace(/on\w+\s*=/gi, '')        // onclick=, onerror=, etc.
    .replace(/src\s*=/gi, '')          // src= (can be used in tags)
    .replace(/href\s*=/gi, '')         // href= (can point to javascript:)
    
    // 6. Remove script-like patterns
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')  // Remove <script> entirely
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')  // Remove <iframe> entirely
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')  // Remove <object> entirely
    .replace(/<embed[^>]*>/gi, '')                      // Remove <embed>
    
    // 7. Remove control characters that might bypass filters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    
    // 8. Final trim
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
