import { NextResponse } from "next/server";
import { newState, setStateCookie } from "@/lib/session";
import { whoopAuthUrl } from "@/lib/whoop";

export async function GET() {
  const state = newState();
  const res = NextResponse.redirect(whoopAuthUrl(state));
  setStateCookie(res, state);
  return res;
}
