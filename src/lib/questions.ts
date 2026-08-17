/**
 * Question normalisation.
 *
 * Screening forms phrase the same question inconsistently — "Notice period?",
 * "NOTICE PERIOD *", "Notice  period". The canonical text is stored as written,
 * but matching (dedupe in the bank, and "resolve every job waiting on this
 * question") always goes through the normalised form.
 *
 * Plain module — safe to import from both server and client code.
 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, " ")
    // Trailing required-field markers and punctuation carry no meaning.
    .replace(/[\s?:.*]+$/g, "")
    .replace(/^[\s*]+/g, "")
    .trim();
}

/** True when two questions are the same question for bank/parking purposes. */
export function isSameQuestion(a: string, b: string): boolean {
  return normalizeQuestion(a) === normalizeQuestion(b);
}
