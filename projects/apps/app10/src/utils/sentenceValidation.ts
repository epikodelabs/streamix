export interface SentenceValidationResult {
  valid: boolean;
  error?: string;
  wordCount: number;
  charCount: number;
}

const ABBREVIATIONS = /\b(Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|Vol|No|Fig|etc|vs|e\.g|i\.e)\./gi;

export function validateSingleSentence(rawInput: string): SentenceValidationResult {
  const trimmed = rawInput.trim();
  const charCount = trimmed.length;
  const wordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;

  if (charCount === 0) {
    return { valid: false, wordCount: 0, charCount: 0 };
  }

  if (charCount < 12) {
    return {
      valid: false,
      error: 'Write at least 12 characters so the sentence carries narrative weight.',
      wordCount,
      charCount,
    };
  }

  if (charCount > 240) {
    return {
      valid: false,
      error: 'Limit sentences to 240 characters so each daily turn stays concise.',
      wordCount,
      charCount,
    };
  }

  // Mask common abbreviations and ellipses before counting sentence terminators
  const masked = trimmed
    .replace(/\.\.\./g, '…')
    .replace(ABBREVIATIONS, '$1_ABBR_');

  // Check for sentence-ending punctuation followed by whitespace and a new capital/quote letter
  const multiSentencePattern = /[.!?]["”’)]?\s+[A-Z“"‘']/;
  if (multiSentencePattern.test(masked)) {
    return {
      valid: false,
      error: 'One sentence only — please remove the second sentence before submitting.',
      wordCount,
      charCount,
    };
  }

  // Must end with valid terminal punctuation (including optional closing quote)
  if (!/[.!?…]["”’)]?$/.test(trimmed)) {
    return {
      valid: false,
      error: 'End your sentence with terminal punctuation (. ! or ?).',
      wordCount,
      charCount,
    };
  }

  return {
    valid: true,
    wordCount,
    charCount,
  };
}
