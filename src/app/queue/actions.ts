"use server";

import { revalidatePath } from "next/cache";

import { InvalidTransitionError, approveJob, rejectJob } from "@/lib/jobs";

export type ActionResult = { ok: boolean; message: string };

export async function approveJobAction(id: number): Promise<ActionResult> {
  try {
    const job = approveJob(id);
    revalidatePath("/queue");
    return { ok: true, message: `Approved "${job.title}" — ${job.company}.` };
  } catch (err) {
    if (err instanceof InvalidTransitionError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function rejectJobAction(id: number): Promise<ActionResult> {
  try {
    const job = rejectJob(id);
    revalidatePath("/queue");
    return { ok: true, message: `Rejected "${job.title}" — ${job.company}.` };
  } catch (err) {
    if (err instanceof InvalidTransitionError) return { ok: false, message: err.message };
    throw err;
  }
}
