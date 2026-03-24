/**
 * Content Validator -- Steven Delta SD-013
 *
 * Validates user input for potential XSS, injection, and abuse patterns.
 * Sanitizes text content before it reaches the database or agents.
 */

const SUSPICIOUS_PATTERNS = [
  /<script\b/i,
  /javascript:/i,
  /on\w+\s*=/i,       // onclick=, onerror=, etc.
  /data:\s*text\/html/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /import\s*\(/,       // dynamic import injection
  /require\s*\(/,      // require injection
  /\$\{.*\}/,          // template literal injection in raw strings
  /;\s*DROP\s/i,       // SQL injection attempt
  /;\s*DELETE\s/i,
  /UNION\s+SELECT/i,
  /--\s*$/m,           // SQL comment terminator
];

const MAX_CONSECUTIVE_SPECIAL = 50; // Max consecutive special chars (anti-spam)

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate user-provided text content for suspicious patterns.
 */
export function validateContent(text: string, fieldName: string = 'input'): ValidationResult {
  if (typeof text !== 'string') {
    return { valid: false, reason: `${fieldName} must be a string` };
  }

  // Check for null bytes
  if (text.includes('\0')) {
    return { valid: false, reason: `${fieldName} contains null bytes` };
  }

  // Check for suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, reason: `${fieldName} contains disallowed content` };
    }
  }

  // Check for excessive special characters (spam indicator)
  const specialRun = text.match(/[^a-zA-Z0-9\s]{50,}/);
  if (specialRun) {
    return { valid: false, reason: `${fieldName} contains excessive special characters` };
  }

  return { valid: true };
}

/**
 * Validate and sanitize goal text specifically.
 * Applies content validation + length limits.
 */
export function validateGoalText(text: string): ValidationResult {
  const contentCheck = validateContent(text, 'goalText');
  if (!contentCheck.valid) return contentCheck;

  if (text.trim().length === 0) {
    return { valid: false, reason: 'goalText cannot be empty' };
  }

  if (text.length > 5000) {
    return { valid: false, reason: 'goalText must be 5000 characters or fewer' };
  }

  return { valid: true };
}
