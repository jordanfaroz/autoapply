/**
 * Defensive JSON extraction for model output.
 *
 * Even with an explicit "JSON only" instruction, a model may wrap its answer in
 * a ```json fence or add a sentence before/after. Rather than fail the whole run
 * on that, we strip the common wrappers and parse the outermost JSON value.
 */

export class ClaudeJsonError extends Error {
  readonly raw: string;

  constructor(message: string, raw: string) {
    super(message);
    this.name = "ClaudeJsonError";
    this.raw = raw;
  }
}

/** Removes a leading/trailing markdown code fence, with or without a language tag. */
function stripCodeFence(input: string): string {
  const text = input.trim();
  if (!text.startsWith("```")) return text;

  // Drop the opening fence line (```/```json/```JSON etc).
  const firstNewline = text.indexOf("\n");
  if (firstNewline === -1) return text;

  const body = text.slice(firstNewline + 1);
  const closing = body.lastIndexOf("```");
  return (closing === -1 ? body : body.slice(0, closing)).trim();
}

/**
 * Slices out the outermost balanced `{...}` or `[...]`, ignoring braces that appear
 * inside string literals. Handles prose on either side of the JSON.
 */
function sliceOutermostJson(text: string): string | null {
  const openIndex = (() => {
    const brace = text.indexOf("{");
    const bracket = text.indexOf("[");
    if (brace === -1) return bracket;
    if (bracket === -1) return brace;
    return Math.min(brace, bracket);
  })();
  if (openIndex === -1) return null;

  const open = text[openIndex];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }

  return null;
}

/**
 * Parses model output as JSON, tolerating code fences and surrounding prose.
 * Throws `ClaudeJsonError` (carrying the raw text) when nothing parseable is found.
 */
export function parseClaudeJson<T = unknown>(raw: string): T {
  const unfenced = stripCodeFence(raw);

  // Fast path: the model did what it was told.
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    // fall through to the slicing attempt
  }

  const sliced = sliceOutermostJson(unfenced);
  if (sliced) {
    try {
      return JSON.parse(sliced) as T;
    } catch (err) {
      throw new ClaudeJsonError(
        `Claude returned malformed JSON: ${(err as Error).message}`,
        raw,
      );
    }
  }

  throw new ClaudeJsonError("Claude returned no JSON object or array.", raw);
}
