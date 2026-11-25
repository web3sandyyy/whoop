import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextResponse } from "next/server";

// A signed cookie holding the user's row id. No passwords: connecting Whoop *is* the login.
export const SESSION_COOKIE = "wc_session";
export const STATE_COOKIE = "wc_oauth_state";

const secure = process.env.NODE_ENV === "production";

function sign(value: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(value).digest("base64url");
}

export function readSession(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const [id, sig] = cookieValue.split(".");
  if (!id || !sig) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return id;
}

export function setSession(res: NextResponse, userId: string) {
  res.cookies.set(SESSION_COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function clearSession(res: NextResponse) {
  res.cookies.delete(SESSION_COOKIE);
}

// OAuth `state` protection for both providers.
export const newState = () => randomBytes(16).toString("hex");

export function setStateCookie(res: NextResponse, state: string) {
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

export function stateMatches(cookieValue: string | undefined, given: string | null): boolean {
  if (!cookieValue || !given || cookieValue.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(given));
}
