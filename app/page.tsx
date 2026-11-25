import { cookies } from "next/headers";
import { getUser } from "@/lib/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; disconnected?: string }>;
}) {
  const params = await searchParams;
  const userId = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  const user = userId ? await getUser(userId) : null;

  const whoop = !!user;
  const google = !!user?.google_refresh_token;
  const calendarGone = google && !user?.google_calendar_id;
  const done = whoop && google && !calendarGone;

  return (
    <main>
      <h1>Whoop → Calendar</h1>
      <p className="lede">
        Your sleep, workouts and morning recovery appear in Google Calendar automatically, plus a
        nightly “bed by” reminder based on the sleep WHOOP says you need.
      </p>

      {params.error && (
        <p className="note error">That didn’t go through. Please try again.</p>
      )}
      {params.disconnected && (
        <p className="note">Disconnected. Your data and the Whoop calendar have been removed.</p>
      )}

      <ol className="steps">
        <li className={whoop ? "done" : ""}>
          <span className="num">{whoop ? "✓" : "1"}</span>
          <div>
            <strong>Connect WHOOP</strong>
            {whoop ? (
              <p>Connected.</p>
            ) : (
              <a className="btn" href="/api/whoop/connect">Connect Whoop</a>
            )}
          </div>
        </li>

        <li className={done ? "done" : ""}>
          <span className="num">{done ? "✓" : "2"}</span>
          <div>
            <strong>Connect Google Calendar</strong>
            {done ? (
              <p>Connected. Look for the “Whoop” calendar in Google Calendar.</p>
            ) : (
              <>
                {calendarGone && (
                  <p>The Whoop calendar was deleted, so syncing is paused. Reconnect to bring it back.</p>
                )}
                {whoop ? (
                  <a className="btn" href="/api/google/connect">
                    {calendarGone ? "Reconnect Google Calendar" : "Connect Google Calendar"}
                  </a>
                ) : (
                  <span className="btn disabled">Connect Google Calendar</span>
                )}
                <p className="hint">
                  Google will warn that this app isn’t verified. Click <em>Advanced</em> →{" "}
                  <em>Go to Whoop Calendar</em>. It can only touch the separate “Whoop” calendar it
                  creates, never your own events.
                </p>
              </>
            )}
          </div>
        </li>
      </ol>

      {done && (
        <section className="what">
          <p>What you’ll see:</p>
          <ul>
            <li>😴 6.4h asleep · 78% · REM 1h40</li>
            <li>🟡 Recovery 52% · HRV 63 · RHR 57</li>
            <li>🏋️ Weightlifting · Strain 15.0</li>
            <li>🛏️ Bed by 12:45 · you need 9h 10m</li>
          </ul>
          <p className="hint">New data shows up a few minutes after WHOOP finishes scoring it.</p>
        </section>
      )}

      {whoop && (
        <form action="/api/disconnect" method="post" className="disconnect">
          <button type="submit">Disconnect and delete my data</button>
        </form>
      )}
    </main>
  );
}
