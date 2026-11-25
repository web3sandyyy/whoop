import { NextResponse, type NextRequest } from "next/server";
import { upsertWhoopUser } from "@/lib/db";
import { STATE_COOKIE, setSession, stateMatches } from "@/lib/session";
import { exchangeWhoopCode, expiresAt, getWhoopUserId } from "@/lib/whoop";

export async function GET(req: NextRequest) {
  const home = new URL("/", process.env.APP_URL);
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !stateMatches(req.cookies.get(STATE_COOKIE)?.value, req.nextUrl.searchParams.get("state"))) {
    home.searchParams.set("error", "whoop");
    return NextResponse.redirect(home);
  }

  const tokens = await exchangeWhoopCode(code);
  const user = await upsertWhoopUser({
    whoop_user_id: await getWhoopUserId(tokens.access_token),
    whoop_access_token: tokens.access_token,
    whoop_refresh_token: tokens.refresh_token,
    whoop_expires_at: expiresAt(tokens.expires_in),
  });

  const res = NextResponse.redirect(home);
  res.cookies.delete(STATE_COOKIE);
  setSession(res, user.id);
  return res;
}
