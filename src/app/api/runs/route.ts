import { NextResponse } from "next/server";

import { RUN_TYPES, type RunType } from "@/lib/db/schema";
import { getStatus, startRun } from "@/lib/runner";
import { isSiteId } from "@/lib/sites";

/** GET /api/runs — current lease, active run and recent history (for polling). */
export async function GET() {
  const status = getStatus();
  return NextResponse.json(status);
}

/** POST /api/runs — start a scrape or apply run. Body: { type, site } */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Expected a JSON body." }, { status: 400 });
  }

  const { type, site } = (body ?? {}) as { type?: string; site?: string };

  if (!type || !(RUN_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json(
      { ok: false, message: `type must be one of ${RUN_TYPES.join(", ")}.` },
      { status: 400 },
    );
  }
  if (!site || !isSiteId(site)) {
    return NextResponse.json({ ok: false, message: `Unknown site "${site}".` }, { status: 400 });
  }

  const result = startRun(type as RunType, site);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
