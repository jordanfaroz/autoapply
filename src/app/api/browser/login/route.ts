import { NextResponse } from "next/server";

import { getLoginLease, openLoginWindow } from "@/lib/runner";
import { isSiteId } from "@/lib/sites";

/** GET /api/browser/login — is a login window currently open, and for which site? */
export async function GET() {
  return NextResponse.json({ lease: getLoginLease() });
}

/**
 * POST /api/browser/login — { site }
 *
 * Launches the visible persistent browser at the site's login page. Credentials are
 * never handled here: you sign in yourself and the session persists in the profile
 * directory for later runs.
 */
export async function POST(request: Request) {
  let site: string | undefined;
  try {
    ({ site } = (await request.json()) as { site?: string });
  } catch {
    return NextResponse.json({ ok: false, message: "Expected a JSON body." }, { status: 400 });
  }

  if (!site || !isSiteId(site)) {
    return NextResponse.json({ ok: false, message: `Unknown site "${site}".` }, { status: 400 });
  }

  const result = openLoginWindow(site);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
