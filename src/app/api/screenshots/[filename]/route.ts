import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { SCREENSHOTS_DIR } from "@/lib/config";

/**
 * GET /api/screenshots/:filename — serves a failure screenshot captured by the
 * engine (src/engine/browser.ts's captureFailureScreenshot). Only ever reads by
 * basename from the fixed screenshots directory, so a crafted filename cannot walk
 * outside it.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/screenshots/[filename]">) {
  const { filename } = await ctx.params;
  const safe = path.basename(filename);
  if (!safe || safe !== filename || !/^[\w.-]+\.png$/.test(safe)) {
    return NextResponse.json({ ok: false, message: "Invalid filename." }, { status: 400 });
  }

  const filePath = path.join(SCREENSHOTS_DIR, safe);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    return NextResponse.json({ ok: false, message: "Screenshot not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
  });
}
