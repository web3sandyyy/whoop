import { after, NextResponse, type NextRequest } from "next/server";
import { getUser, updateUser } from "@/lib/db";
import { ensureCalendar, exchangeGoogleCode } from "@/lib/google";
import { SESSION_COOKIE, STATE_COOKIE, readSession, stateMatches } from "@/lib/session";
import { backfill } from "@/lib/sync";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const home = new URL("/", process.env.APP_URL);
  const userId = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await getUser(userId) : null;
  const code = req.nextUrl.searchParams.get("code");
  if (!user || !code ||
      !stateMatches(req.cookies.get(STATE_COOKIE)?.value, req.nextUrl.searchParams.get("state"))) {
    home.searchParams.set("error", "google");
    return NextResponse.redirect(home);
  }

  const t = await exchangeGoogleCode(code);
  const patch = {
    google_access_token: t.access_token,
    google_refresh_token: t.refresh_token ?? user.google_refresh_token,
    google_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  };
  await updateUser(user.id, patch);
  Object.assign(user, patch);
  await ensureCalendar(user);

  after(async () => {
    try {
      await backfill(user);
    } catch (err) {
      console.error("Backfill failed", err);
    }
  });

  const res = NextResponse.redirect(home);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
