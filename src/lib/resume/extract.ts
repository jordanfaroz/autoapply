import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

/**
 * Below this many characters of extracted text, the PDF is almost certainly a
 * scan or an image export. Sending that to Claude would produce a confidently
 * wrong profile, so we stop and say so instead.
 */
export const MIN_USABLE_CHARS = 200;

export class PdfExtractionError extends Error {
  /** True when the file parsed fine but yielded (nearly) no text. */
  readonly likelyScanned: boolean;

  constructor(message: string, likelyScanned = false) {
    super(message);
    this.name = "PdfExtractionError";
    this.likelyScanned = likelyScanned;
  }
}

export type ExtractedResume = {
  text: string;
  pages: number;
  charCount: number;
};

/** Collapses the ragged whitespace pdf.js produces without destroying line structure. */
function normalise(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractResumeText(bytes: Uint8Array): Promise<ExtractedResume> {
  let raw: string;
  let pages: number;

  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    raw = result.text;
    pages = result.totalPages;
  } catch (err) {
    throw new PdfExtractionError(
      `Could not read that PDF: ${(err as Error).message}. ` +
        "If it is password-protected, remove the password and try again.",
    );
  }

  const text = normalise(raw);

  if (text.length < MIN_USABLE_CHARS) {
    throw new PdfExtractionError(
      `Only ${text.length} characters of text came out of this ${pages}-page PDF. ` +
        "It is most likely a scan or an image export, so there is nothing for Claude " +
        "to read. Export or re-save your resume as a text-based PDF and upload again.",
      true,
    );
  }

  return { text, pages, charCount: text.length };
}
