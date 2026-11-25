import { NextResponse, type NextRequest } from "next/server";
import { deleteUser, getUser } from "@/lib/db";
import { deleteCalendar, revokeGoogle } from "@/lib/google";
import { SESSION_COOKIE, clearSession, readSession } from "@/lib/session";
import { revokeWhoop } from "@/lib/whoop";

// Removes the Whoop calendar from Google, revokes both connections, deletes the stored tokens.
export async function POST(req: NextRequest) {
  const userId = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await getUser(userId) : null;

  if (user) {
    try {
      if (user.google_refresh_token) {
        await deleteCalendar(user);
        await revokeGoogle(user);
      }
    } catch (err) {
      console.error("Google cleanup failed", err);
    }
    await revokeWhoop(user);
    await deleteUser(user.id);
  }

  const res = NextResponse.redirect(new URL("/?disconnected=1", process.env.APP_URL), 303);
  clearSession(res);
  return res;
}
