/**
 * Claude touchpoint 3 of 4: map a job's screening questions onto the answer bank.
 *
 * The rule this module exists to enforce: Claude decides *whether* an existing
 * answer applies to a newly-worded question, and may adapt its *formatting* to fit
 * the field (e.g. pulling "3" out of a stored "3 months" for a numeric field, or
 * picking the closest of a dropdown's own option strings) — it never invents new
 * factual content, and never answers a question with nothing behind it. Unmapped
 * questions come back unmapped; the caller parks them rather than guessing.
 *
 * Called only from the worker (src/engine/apply.mts), so — like score.ts — this uses
 * relative, extensioned imports rather than the `@/` alias or "server-only".
 */

import { callClaudeJson } from "./client.ts";

export type QuestionToMap = {
  /** Opaque to this module — passed straight through to the result. */
  id: string;
  questionText: string;
  fieldType: "text" | "textarea" | "number" | "choice";
  /** Present only for "choice" fields — the exact strings the site offers. */
  options?: string[];
};

export type AnswerBankSnapshot = Array<{
  id: number;
  question: string;
  answer: string;
  type: "text" | "number" | "choice";
}>;

export type QuestionMapResult =
  | { id: string; matched: true; answerBankId: number; answer: string }
  | { id: string; matched: false };

const SYSTEM_PROMPT = `You match job-application screening questions to a candidate's
existing answer bank. You do not know anything about this candidate except what is in
the answer bank below — never use outside knowledge or assumptions to answer a question.

Return ONLY a JSON array, no prose and no code fence, with exactly one object per
question in the same order:
[
  { "id": "<question id>", "answerBankId": <number> | null, "answer": "<string>" | null }
]

Rules:
- Match on MEANING, not exact wording — the same fact is asked in different words on
  every job site ("Notice period?" / "How soon can you join?" / "Availability to
  join").
- Set answerBankId to the id of the bank entry you matched, and answer to the text to
  submit. Set both to null if nothing in the bank confidently answers this question —
  a wrong or fabricated answer is worse than leaving it unmapped, so when in doubt,
  return null.
- The factual content of "answer" must come from the matched bank entry. You may only
  ADAPT ITS FORMAT to fit the field:
    * fieldType "choice": answer MUST be copied character-for-character from that
      question's "options" list. Pick the option that best represents the bank
      entry's answer. If no option reasonably represents it, return null — do not
      pick the closest wrong option.
    * fieldType "number": you may extract the numeric value implied by the bank
      entry (e.g. bank answer "3 months notice" -> "3" for a field asking for a
      number of months). Never invent a number the bank entry does not support.
    * fieldType "text" / "textarea": use the bank entry's answer as written. Trim
      whitespace or fix obviously broken capitalization only — do not rephrase,
      expand, or add information.
- Every question must appear in your output exactly once, same order, same "id".`;

function describeBank(bank: AnswerBankSnapshot): string {
  if (bank.length === 0) return "(the answer bank is currently empty)";
  return bank
    .map((e) => `id=${e.id} [${e.type}] Q: ${e.question}\n  A: ${e.answer}`)
    .join("\n");
}

function describeQuestions(questions: QuestionToMap[]): string {
  return questions
    .map((q) => {
      const opts = q.options?.length ? `\n  options: ${JSON.stringify(q.options)}` : "";
      return `id=${q.id} [${q.fieldType}] ${q.questionText}${opts}`;
    })
    .join("\n");
}

function coerceResults(raw: unknown, questions: QuestionToMap[]): QuestionMapResult[] {
  const array = Array.isArray(raw) ? raw : [];
  const byId = new Map<string, unknown>();
  for (const entry of array) {
    if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
      byId.set((entry as { id: string }).id, entry);
    }
  }

  return questions.map((q): QuestionMapResult => {
    const entry = byId.get(q.id) as
      | { answerBankId?: unknown; answer?: unknown }
      | undefined;
    if (!entry) return { id: q.id, matched: false };

    const answerBankId =
      typeof entry.answerBankId === "number" ? entry.answerBankId : null;
    const answer = typeof entry.answer === "string" ? entry.answer.trim() : null;

    if (answerBankId === null || !answer) return { id: q.id, matched: false };

    // Guard against a hallucinated choice value even after the prompt's instructions.
    if (q.fieldType === "choice" && q.options && !q.options.includes(answer)) {
      return { id: q.id, matched: false };
    }

    return { id: q.id, matched: true, answerBankId, answer };
  });
}

export async function mapQuestionsToAnswers(
  questions: QuestionToMap[],
  bank: AnswerBankSnapshot,
): Promise<{ results: QuestionMapResult[]; costUsd: number | null }> {
  if (questions.length === 0) return { results: [], costUsd: 0 };

  const { data, usage } = await callClaudeJson<unknown>({
    label: "map-questions",
    system: SYSTEM_PROMPT,
    thinking: true,
    effort: "low",
    maxTokens: 4_000,
    user: [
      "ANSWER BANK",
      "===========",
      describeBank(bank),
      "",
      "QUESTIONS TO MAP",
      "================",
      describeQuestions(questions),
    ].join("\n"),
  });

  return { results: coerceResults(data, questions), costUsd: usage.costUsd };
}
