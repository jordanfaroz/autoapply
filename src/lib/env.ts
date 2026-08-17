/**
 * Environment access — the only module that reads the API key.
 *
 * This deliberately does not use `server-only`: from step 5 the worker process
 * scores jobs, so this module is imported by both Next and plain Node, where the
 * `server-only` marker does not resolve. The runtime guard below is the
 * replacement, and it is strictly stronger — `server-only` fails at build time
 * only for code the bundler sees, whereas this throws in any browser context.
 *
 * Next loads `.env` for server code; the worker calls `process.loadEnvFile()`.
 */

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "src/lib/env.ts was imported into browser code. The Anthropic key must never " +
        "reach the client — move this call into a server component, server action, " +
        "or the worker.",
    );
  }
}

export function getAnthropicKey(): string | undefined {
  assertServer();
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : undefined;
}

/** Throws with actionable guidance. Call this at the top of any Claude touchpoint. */
export function requireAnthropicKey(): string {
  const key = getAnthropicKey();
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key, " +
        "then restart the dev server.",
    );
  }
  return key;
}

export type ApiKeyStatus = {
  present: boolean;
  /** Safe to render: e.g. "sk-ant-…7f2a". Never the full key. */
  masked: string | null;
};

export function getApiKeyStatus(): ApiKeyStatus {
  const key = getAnthropicKey();
  if (!key) return { present: false, masked: null };
  const head = key.slice(0, 7);
  const tail = key.slice(-4);
  return { present: true, masked: `${head}…${tail}` };
}
