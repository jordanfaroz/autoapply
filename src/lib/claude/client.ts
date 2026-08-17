import Anthropic from "@anthropic-ai/sdk";

// Relative, extensioned imports: this module is loaded both by Next (which bundles
// it) and by the worker process (plain Node, which resolves neither the `@/` alias
// nor extensionless specifiers). See src/lib/env.ts for why `server-only` is gone.
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, CLAUDE_RETRY } from "../config.ts";
import { requireAnthropicKey } from "../env.ts";
import { parseClaudeJson } from "./json.ts";

/**
 * The single entry point for every Claude call in this app. All four touchpoints
 * (resume parsing, job scoring, screening-question mapping, tailored blurb) go
 * through here so retries, JSON handling and cost logging exist in exactly one place.
 */

// ---------------------------------------------------------------------------
// Pricing — USD per million tokens. Used only for the per-call log line.
// Update from https://platform.claude.com/docs/en/pricing if these drift.
// ---------------------------------------------------------------------------

type Price = { input: number; output: number };

const PRICE_PER_MTOK: Record<string, Price> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache writes bill at 1.25x input, cache reads at 0.1x. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export type ClaudeUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Null when the model is not in the price table above. */
  costUsd: number | null;
  elapsedMs: number;
};

function computeCost(model: string, usage: Omit<ClaudeUsage, "costUsd" | "elapsedMs">) {
  const price = PRICE_PER_MTOK[model];
  if (!price) return null;

  const perToken = (n: number, rate: number) => (n / 1_000_000) * rate;
  return (
    perToken(usage.inputTokens, price.input) +
    perToken(usage.outputTokens, price.output) +
    perToken(usage.cacheWriteTokens, price.input * CACHE_WRITE_MULTIPLIER) +
    perToken(usage.cacheReadTokens, price.input * CACHE_READ_MULTIPLIER)
  );
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let cached: { key: string; client: Anthropic } | undefined;

function getClient(): Anthropic {
  const key = requireAnthropicKey();
  if (cached?.key === key) return cached.client;

  // maxRetries: 0 — we run our own retry loop below so each attempt is logged.
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 10 * 60 * 1000 });
  cached = { key, client };
  return client;
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    return typeof err.status === "number" && err.status >= 500;
  }
  return false;
}

/** Honours a `retry-after` header when the server sends one, else exponential backoff. */
function backoffMs(err: unknown, attempt: number): number {
  if (err instanceof Anthropic.APIError && err.headers) {
    const header = err.headers.get?.("retry-after");
    const seconds = header ? Number(header) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, CLAUDE_RETRY.maxDelayMs);
    }
  }
  const exponential = CLAUDE_RETRY.baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * CLAUDE_RETRY.baseDelayMs;
  return Math.min(exponential + jitter, CLAUDE_RETRY.maxDelayMs);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ClaudeCallOptions = {
  /** Short identifier for the log line, e.g. "resume-parse". */
  label: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Adaptive thinking. Off by default — extraction tasks do not benefit from it. */
  thinking?: boolean;
  effort?: "low" | "medium" | "high" | "max";
};

export type ClaudeResult = { text: string; usage: ClaudeUsage };

export class ClaudeCallError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ClaudeCallError";
    this.attempts = attempts;
  }
}

/**
 * `output_config.effort` is not accepted by every model. Rather than hard-fail a run
 * the first time it is rejected, we detect that specific 400 and drop the field for
 * the rest of the process — the call is still perfectly valid without it.
 */
let effortSupported = true;

function looksLikeUnsupportedEffort(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError) || err.status !== 400) return false;
  return /output_config|effort/i.test(err.message);
}

export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  const client = getClient();
  const startedAt = Date.now();

  let lastError: unknown;

  for (let attempt = 0; attempt < CLAUDE_RETRY.maxAttempts; attempt++) {
    try {
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: opts.maxTokens ?? CLAUDE_MAX_TOKENS,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        thinking: opts.thinking ? { type: "adaptive" } : { type: "disabled" },
        ...(opts.effort && effortSupported ? { output_config: { effort: opts.effort } } : {}),
      });

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      const usage: ClaudeUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        costUsd: null,
        elapsedMs: Date.now() - startedAt,
      };
      usage.costUsd = computeCost(CLAUDE_MODEL, usage);

      logUsage(opts.label, usage, attempt);

      if (response.stop_reason === "max_tokens") {
        throw new ClaudeCallError(
          `Claude hit the ${opts.maxTokens ?? CLAUDE_MAX_TOKENS}-token output cap on ` +
            `"${opts.label}" — the response is truncated. Raise maxTokens and retry.`,
          attempt + 1,
        );
      }

      if (response.stop_reason === "refusal") {
        throw new ClaudeCallError(
          `Claude declined the "${opts.label}" request.`,
          attempt + 1,
        );
      }

      return { text, usage };
    } catch (err) {
      // Our own errors are terminal — don't burn retries on them.
      if (err instanceof ClaudeCallError) throw err;

      lastError = err;

      // Model does not accept an effort level: drop it and retry immediately.
      // This attempt is not counted against the backoff schedule.
      if (opts.effort && effortSupported && looksLikeUnsupportedEffort(err)) {
        effortSupported = false;
        console.warn(
          `[claude] ${opts.label}: ${CLAUDE_MODEL} rejected output_config.effort — ` +
            `retrying without it and omitting it for the rest of this process.`,
        );
        attempt--;
        continue;
      }

      if (!isRetryable(err) || attempt === CLAUDE_RETRY.maxAttempts - 1) break;

      const delay = backoffMs(err, attempt);
      console.warn(
        `[claude] ${opts.label} attempt ${attempt + 1} failed ` +
          `(${describeError(err)}); retrying in ${Math.round(delay)}ms`,
      );
      await sleep(delay);
    }
  }

  throw new ClaudeCallError(
    `Claude call "${opts.label}" failed after ${CLAUDE_RETRY.maxAttempts} attempts: ` +
      describeError(lastError),
    CLAUDE_RETRY.maxAttempts,
    { cause: lastError },
  );
}

/** `callClaude` + defensive JSON parsing. Use this for every structured touchpoint. */
export async function callClaudeJson<T>(
  opts: ClaudeCallOptions,
): Promise<{ data: T; usage: ClaudeUsage }> {
  const { text, usage } = await callClaude(opts);
  return { data: parseClaudeJson<T>(text), usage };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logUsage(label: string, usage: ClaudeUsage, attempt: number) {
  const cost = usage.costUsd === null ? "n/a" : `$${usage.costUsd.toFixed(4)}`;
  const retry = attempt > 0 ? ` retry=${attempt}` : "";
  console.info(
    `[claude] ${label} model=${CLAUDE_MODEL} in=${usage.inputTokens} ` +
      `out=${usage.outputTokens} cache_read=${usage.cacheReadTokens} ` +
      `cache_write=${usage.cacheWriteTokens} cost=${cost} ` +
      `${(usage.elapsedMs / 1000).toFixed(1)}s${retry}`,
  );
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.status ?? "?"} ${err.name}: ${err.message}`;
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
