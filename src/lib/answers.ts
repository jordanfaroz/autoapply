import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { answerBank, jobs, parkedQuestions } from "@/lib/db/schema";
import type { AnswerBankEntry, AnswerType } from "@/lib/db/schema";
import { normalizeQuestion } from "@/lib/questions";

// ---------------------------------------------------------------------------
// Answer bank CRUD
// ---------------------------------------------------------------------------

export type AnswerBankRow = AnswerBankEntry & {
  /** How many jobs this answer has already unblocked. */
  resolvedJobCount: number;
};

export function listAnswers(): AnswerBankRow[] {
  const rows = db.select().from(answerBank).orderBy(desc(answerBank.updatedAt)).all();

  const counts = db
    .select({
      answerId: parkedQuestions.resolvedAnswerId,
      n: sql<number>`count(distinct ${parkedQuestions.jobId})`,
    })
    .from(parkedQuestions)
    .groupBy(parkedQuestions.resolvedAnswerId)
    .all();

  const byId = new Map(counts.map((c) => [c.answerId, c.n]));
  return rows.map((row) => ({ ...row, resolvedJobCount: byId.get(row.id) ?? 0 }));
}

export class DuplicateQuestionError extends Error {
  readonly existing: AnswerBankEntry;

  constructor(existing: AnswerBankEntry) {
    super(`"${existing.question}" is already in the answer bank.`);
    this.name = "DuplicateQuestionError";
    this.existing = existing;
  }
}

export function findAnswerByQuestion(question: string): AnswerBankEntry | undefined {
  return db
    .select()
    .from(answerBank)
    .where(eq(answerBank.questionNormalized, normalizeQuestion(question)))
    .get();
}

export function createAnswer(input: {
  question: string;
  answer: string;
  type: AnswerType;
  createdFrom?: "manual" | "parked_job";
}): AnswerBankEntry {
  const normalized = normalizeQuestion(input.question);

  const existing = db
    .select()
    .from(answerBank)
    .where(eq(answerBank.questionNormalized, normalized))
    .get();
  if (existing) throw new DuplicateQuestionError(existing);

  return db
    .insert(answerBank)
    .values({
      question: input.question.trim(),
      questionNormalized: normalized,
      answer: input.answer.trim(),
      type: input.type,
      createdFrom: input.createdFrom ?? "manual",
    })
    .returning()
    .get();
}

export function updateAnswer(
  id: number,
  input: { question: string; answer: string; type: AnswerType },
): AnswerBankEntry {
  const normalized = normalizeQuestion(input.question);

  // Renaming onto another entry's question would violate the unique index.
  const clash = db
    .select()
    .from(answerBank)
    .where(eq(answerBank.questionNormalized, normalized))
    .get();
  if (clash && clash.id !== id) throw new DuplicateQuestionError(clash);

  return db
    .update(answerBank)
    .set({
      question: input.question.trim(),
      questionNormalized: normalized,
      answer: input.answer.trim(),
      type: input.type,
      updatedAt: new Date(),
    })
    .where(eq(answerBank.id, id))
    .returning()
    .get();
}

/**
 * Deleting an answer un-resolves any parked question that pointed at it (the FK is
 * ON DELETE SET NULL) and re-parks the jobs those questions belong to — otherwise a
 * job could be applied to with an answer that no longer exists.
 */
export function deleteAnswer(id: number): { reparkedJobs: number } {
  return db.transaction((tx) => {
    const affected = tx
      .select({ jobId: parkedQuestions.jobId })
      .from(parkedQuestions)
      .where(eq(parkedQuestions.resolvedAnswerId, id))
      .all();

    tx.delete(answerBank).where(eq(answerBank.id, id)).run();

    // The FK nulls resolvedAnswerId; clear the timestamp so it reads as unresolved.
    tx.update(parkedQuestions)
      .set({ resolvedAt: null })
      .where(isNull(parkedQuestions.resolvedAnswerId))
      .run();

    const jobIds = [...new Set(affected.map((a) => a.jobId))];
    for (const jobId of jobIds) {
      tx.update(jobs)
        .set({ status: "parked_needs_input", updatedAt: new Date() })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "approved")))
        .run();
    }

    return { reparkedJobs: jobIds.length };
  });
}

// ---------------------------------------------------------------------------
// Parked questions
// ---------------------------------------------------------------------------

export type ParkedQuestionGroup = {
  questionNormalized: string;
  /** The wording of the first job that hit this question. */
  questionText: string;
  jobs: Array<{ id: number; company: string; title: string; site: string }>;
};

/** Unresolved parked questions, grouped so one answer clears the whole group. */
export function listParkedQuestions(): ParkedQuestionGroup[] {
  const rows = db
    .select({
      questionNormalized: parkedQuestions.questionNormalized,
      questionText: parkedQuestions.questionText,
      createdAt: parkedQuestions.createdAt,
      jobId: jobs.id,
      company: jobs.company,
      title: jobs.title,
      site: jobs.site,
    })
    .from(parkedQuestions)
    .innerJoin(jobs, eq(jobs.id, parkedQuestions.jobId))
    .where(isNull(parkedQuestions.resolvedAnswerId))
    .orderBy(parkedQuestions.createdAt)
    .all();

  const groups = new Map<string, ParkedQuestionGroup>();
  for (const row of rows) {
    let group = groups.get(row.questionNormalized);
    if (!group) {
      group = {
        questionNormalized: row.questionNormalized,
        questionText: row.questionText,
        jobs: [],
      };
      groups.set(row.questionNormalized, group);
    }
    if (!group.jobs.some((j) => j.id === row.jobId)) {
      group.jobs.push({
        id: row.jobId,
        company: row.company,
        title: row.title,
        site: row.site,
      });
    }
  }

  return [...groups.values()];
}

export type ResolveResult = {
  answer: AnswerBankEntry;
  questionsResolved: number;
  jobsReleased: number;
};

/**
 * Answers a parked question: stores it in the bank, marks every parked row with the
 * same normalised question as resolved, and returns to `approved` each job that has
 * no unresolved questions left.
 *
 * A job is only ever moved out of `parked_needs_input` — no other status is touched,
 * so this can never promote a job you have not already approved.
 */
export function resolveParkedQuestion(
  questionNormalized: string,
  input: { answer: string; type: AnswerType; question?: string },
): ResolveResult {
  return db.transaction((tx) => {
    const pending = tx
      .select({ id: parkedQuestions.id, jobId: parkedQuestions.jobId })
      .from(parkedQuestions)
      .where(
        and(
          eq(parkedQuestions.questionNormalized, questionNormalized),
          isNull(parkedQuestions.resolvedAnswerId),
        ),
      )
      .all();

    const existing = tx
      .select()
      .from(answerBank)
      .where(eq(answerBank.questionNormalized, questionNormalized))
      .get();

    const answer = existing
      ? tx
          .update(answerBank)
          .set({
            answer: input.answer.trim(),
            type: input.type,
            updatedAt: new Date(),
          })
          .where(eq(answerBank.id, existing.id))
          .returning()
          .get()
      : tx
          .insert(answerBank)
          .values({
            question: (input.question ?? questionNormalized).trim(),
            questionNormalized,
            answer: input.answer.trim(),
            type: input.type,
            createdFrom: "parked_job",
          })
          .returning()
          .get();

    const now = new Date();
    tx.update(parkedQuestions)
      .set({ resolvedAnswerId: answer.id, resolvedAt: now })
      .where(
        and(
          eq(parkedQuestions.questionNormalized, questionNormalized),
          isNull(parkedQuestions.resolvedAnswerId),
        ),
      )
      .run();

    let jobsReleased = 0;
    for (const jobId of new Set(pending.map((p) => p.jobId))) {
      const stillBlocked = tx
        .select({ id: parkedQuestions.id })
        .from(parkedQuestions)
        .where(
          and(eq(parkedQuestions.jobId, jobId), isNull(parkedQuestions.resolvedAnswerId)),
        )
        .get();
      if (stillBlocked) continue;

      const released = tx
        .update(jobs)
        .set({ status: "approved", updatedAt: now })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "parked_needs_input")))
        .returning({ id: jobs.id })
        .all();
      jobsReleased += released.length;
    }

    return { answer, questionsResolved: pending.length, jobsReleased };
  });
}
