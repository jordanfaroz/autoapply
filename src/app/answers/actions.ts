"use server";

import { revalidatePath } from "next/cache";

import {
  DuplicateQuestionError,
  createAnswer,
  deleteAnswer,
  resolveParkedQuestion,
  updateAnswer,
} from "@/lib/answers";
import { ANSWER_TYPES, type AnswerType } from "@/lib/db/schema";

export type ActionResult = { ok: boolean; message: string };

const MAX_QUESTION = 500;
const MAX_ANSWER = 4_000;

function isAnswerType(value: unknown): value is AnswerType {
  return typeof value === "string" && (ANSWER_TYPES as readonly string[]).includes(value);
}

type AnswerFields = { question: string; answer: string; type: AnswerType };

/** Shared validation for the add and edit paths. */
function validate(input: {
  question: string;
  answer: string;
  type: string;
}): AnswerFields | string {
  const question = input.question.trim();
  const answer = input.answer.trim();

  if (!question) return "Question cannot be empty.";
  if (question.length > MAX_QUESTION)
    return `Question is too long (${question.length}/${MAX_QUESTION} characters).`;
  if (!answer) return "Answer cannot be empty — park the question instead of guessing.";
  if (answer.length > MAX_ANSWER)
    return `Answer is too long (${answer.length}/${MAX_ANSWER} characters).`;
  if (!isAnswerType(input.type)) return `"${input.type}" is not a valid answer type.`;
  if (input.type === "number" && !/^-?\d+(\.\d+)?$/.test(answer))
    return `Type is "number" but the answer "${answer}" is not numeric.`;

  return { question, answer, type: input.type };
}

export async function createAnswerAction(input: {
  question: string;
  answer: string;
  type: string;
}): Promise<ActionResult> {
  const fields = validate(input);
  if (typeof fields === "string") return { ok: false, message: fields };

  try {
    createAnswer(fields);
  } catch (err) {
    if (err instanceof DuplicateQuestionError) return { ok: false, message: err.message };
    throw err;
  }

  revalidatePath("/answers");
  return { ok: true, message: "Answer added." };
}

export async function updateAnswerAction(input: {
  id: number;
  question: string;
  answer: string;
  type: string;
}): Promise<ActionResult> {
  const fields = validate(input);
  if (typeof fields === "string") return { ok: false, message: fields };

  try {
    updateAnswer(input.id, fields);
  } catch (err) {
    if (err instanceof DuplicateQuestionError) return { ok: false, message: err.message };
    throw err;
  }

  revalidatePath("/answers");
  return { ok: true, message: "Answer updated." };
}

export async function deleteAnswerAction(id: number): Promise<ActionResult> {
  const { reparkedJobs } = deleteAnswer(id);

  revalidatePath("/answers");
  revalidatePath("/queue");
  return {
    ok: true,
    message:
      reparkedJobs > 0
        ? `Answer deleted. ${reparkedJobs} job${reparkedJobs === 1 ? "" : "s"} moved back to parked.`
        : "Answer deleted.",
  };
}

export async function resolveParkedAction(input: {
  questionNormalized: string;
  questionText: string;
  answer: string;
  type: string;
}): Promise<ActionResult> {
  const fields = validate({
    question: input.questionText,
    answer: input.answer,
    type: input.type,
  });
  if (typeof fields === "string") return { ok: false, message: fields };

  const result = resolveParkedQuestion(input.questionNormalized, {
    answer: fields.answer,
    type: fields.type,
    question: fields.question,
  });

  revalidatePath("/answers");
  revalidatePath("/queue");

  const released =
    result.jobsReleased > 0
      ? ` ${result.jobsReleased} job${result.jobsReleased === 1 ? "" : "s"} returned to approved.`
      : " No job is fully unblocked yet — other questions are still parked.";

  return {
    ok: true,
    message: `Saved to the answer bank.${released}`,
  };
}
