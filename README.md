# Whoop → Calendar

One page, two connect buttons. WHOOP sleep, workouts, morning recovery and a nightly
"bed by" event land in a separate **Whoop** calendar in each user's Google account.

```
WHOOP ──webhook──▶ /api/whoop/webhook ──fetch──▶ WHOOP API v2
                                     └─write──▶ Google Calendar ("Whoop" calendar)
```

| Event | Example | When |
|---|---|---|
| Sleep block (actual sleep time) | 😴 6.4h asleep · 78% · REM 1h40 | `sleep.updated` |
| Workout block | 🏋️ Weightlifting · Strain 15.0 | `workout.updated` |
| Recovery (at wake time, 30 min) | 🔴 Recovery 32% · HRV 63 · RHR 57 | `recovery.updated` |
| Bedtime (30-min wind-down ending at bedtime, pop-up) | 🛏️ Bed by 12:45 · you need 9h 10m | after the morning's sleep is scored |

Bedtime = (same clock time you woke this morning, tomorrow) − WHOOP's sleep need
(baseline + debt + strain − naps) from last night's scored sleep.

Events use deterministic ids, so re-scored or re-delivered data updates in place, and
deletions in WHOOP delete the event. Right after connecting Google, the last 7 days are filled in.

## Setup (about 20 minutes)

### 1. Supabase
1. Create a project, open **SQL editor**, run [`supabase/schema.sql`](supabase/schema.sql).
2. Copy the project URL and the **service_role** key (Project settings → API).

### 2. Deploy to Vercel
1. Push this folder to a GitHub repo and import it in Vercel (or run `npx vercel`).
2. Add the env vars from [`.env.example`](.env.example). `APP_URL` is your Vercel URL,
   e.g. `https://whoop-calendar.vercel.app`. `SESSION_SECRET`: `openssl rand -base64 32`.
3. Redeploy after setting the env vars.

### 3. WHOOP developer app ([developer.whoop.com](https://developer.whoop.com))
- Redirect URL: `https://YOUR_APP/api/whoop/callback`
- Scopes: `offline`, `read:profile`, `read:sleep`, `read:recovery`, `read:workout`, `read:cycles`
  (`offline` = refresh tokens, so users never reconnect)
- Webhook URL: `https://YOUR_APP/api/whoop/webhook`, model version **v2**
- Copy Client ID / Secret into `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET`.

### 4. Google Cloud ([console.cloud.google.com](https://console.cloud.google.com))
1. Create a project, enable **Google Calendar API**.
2. **OAuth consent screen** (Google Auth Platform): External; add scope
   `https://www.googleapis.com/auth/calendar.app.created`.
   This is the narrowest calendar scope: the app can only see the calendar it created,
   never the user's own calendars.
3. **Audience → Publish app → In production.** Leave it unverified. Users see "Google hasn't
   verified this app" → *Advanced* → *Go to …*, which is fine under 100 users.
   Don't stay in *Testing*: refresh tokens expire after 7 days there and sync silently stops.
4. **Credentials → Create OAuth client → Web application**, redirect URI
   `https://YOUR_APP/api/google/callback`. Copy into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### Local development
```bash
cp .env.example .env.local   # fill in, APP_URL=http://localhost:3000
npm run dev
```
Add `http://localhost:3000/api/...callback` redirect URLs to both apps. Webhooks need a public
URL, so test them on the Vercel deployment (or a tunnel such as `ngrok`).

## How users are identified
Connecting WHOOP *is* the login: the WHOOP user id becomes the account and a signed cookie
remembers it. Lost the cookie (new browser)? Click Connect Whoop again and you're back in.

## Disconnect
Deletes the Whoop calendar from Google, revokes Google and WHOOP access, and deletes the row
(tokens) from Supabase. If a user deletes the Whoop calendar themselves, syncing pauses and
the page offers "Reconnect Google Calendar".

## Files
- `app/page.tsx` the one page
- `app/api/whoop/{connect,callback,webhook}` WHOOP OAuth + webhooks
- `app/api/google/{connect,callback}` Google OAuth, creates the calendar, 7-day backfill
- `app/api/disconnect` cleanup
- `lib/sync.ts` event titles, bedtime math, webhook dispatch
- `lib/whoop.ts`, `lib/google.ts`, `lib/db.ts`, `lib/session.ts`
