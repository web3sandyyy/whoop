import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl } from "@/lib/google";
import { SESSION_COOKIE, newState, readSession, setStateCookie } from "@/lib/session";

export async function GET(req: NextRequest) {
  // Whoop first: it identifies who this is.
  if (!readSession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.redirect(new URL("/", process.env.APP_URL));
  }
  const state = newState();
  const res = NextResponse.redirect(googleAuthUrl(state));
  setStateCookie(res, state);
  return res;
}
