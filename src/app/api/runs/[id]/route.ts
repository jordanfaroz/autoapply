import { NextResponse } from "next/server";

import { resumeRun, stopRun } from "@/lib/runner";

/**
 * POST /api/runs/:id — { action: "stop" | "resume" }
 *
 * Resume is what you press after solving a CAPTCHA in the visible browser window;
 * the worker is already polling for the status to flip back.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return NextResponse.json({ ok: false, message: "Invalid run id." }, { status: 400 });
  }

  let action: string | undefined;
  try {
    ({ action } = (await request.json()) as { action?: string });
  } catch {
    return NextResponse.json({ ok: false, message: "Expected a JSON body." }, { status: 400 });
  }

  if (action === "stop") {
    const result = await stopRun(runId);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (action === "resume") {
    const result = resumeRun(runId);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  return NextResponse.json(
    { ok: false, message: 'action must be "stop" or "resume".' },
    { status: 400 },
  );
}
