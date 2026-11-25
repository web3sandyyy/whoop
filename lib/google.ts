import { createHash } from "crypto";
import { updateUser, type User } from "./db";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

// Narrowest calendar scope: we can only see and edit calendars this app created.
// Users' real calendars and events are untouchable.
const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

const redirectUri = () => `${process.env.APP_URL}/api/google/callback`;

export function googleAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    state,
  });
  return `${AUTH_URL}?${q}`;
}

type GoogleTokens = { access_token: string; refresh_token?: string; expires_in: number };

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function exchangeGoogleCode(code: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
}

async function accessToken(user: User): Promise<string> {
  if (user.google_access_token && user.google_expires_at &&
      Date.parse(user.google_expires_at) - Date.now() > 60_000) {
    return user.google_access_token;
  }
  if (!user.google_refresh_token) throw new Error("Google not connected");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: user.google_refresh_token });
  const patch = {
    google_access_token: t.access_token,
    google_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  };
  await updateUser(user.id, patch);
  Object.assign(user, patch);
  return t.access_token;
}

async function gcal(user: User, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken(user)}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

const cal = (user: User) => `/calendars/${encodeURIComponent(user.google_calendar_id!)}`;

/** Reuses the user's existing "Whoop" calendar if it's still there, otherwise creates one. */
export async function ensureCalendar(user: User): Promise<string> {
  if (user.google_calendar_id) {
    const res = await gcal(user, cal(user));
    if (res.ok) return user.google_calendar_id;
  }
  const res = await gcal(user, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: "Whoop", description: "Sleep, recovery and workouts from WHOOP." }),
  });
  if (!res.ok) throw new Error(`Create calendar failed: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  await updateUser(user.id, { google_calendar_id: id });
  user.google_calendar_id = id;
  return id;
}

export async function deleteCalendar(user: User): Promise<void> {
  if (!user.google_calendar_id) return;
  const res = await gcal(user, cal(user), { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error("Delete calendar failed", res.status, await res.text());
  }
}

export async function revokeGoogle(user: User): Promise<void> {
  const token = user.google_refresh_token ?? user.google_access_token;
  if (!token) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  }).catch((err) => console.error("Google revoke failed", err));
}

/**
 * Deterministic event ids (hex is valid base32hex), so re-delivered or re-scored
 * Whoop data updates the same calendar event instead of creating duplicates.
 */
export const eventId = (kind: string, key: string) =>
  createHash("sha1").update(`${kind}:${key}`).digest("hex");

export type CalendarEvent = {
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  colorId?: string;
  transparency?: "transparent" | "opaque";
  reminders?: { useDefault: boolean; overrides?: { method: "popup"; minutes: number }[] };
};

export async function upsertEvent(user: User, id: string, event: CalendarEvent): Promise<void> {
  if (!user.google_calendar_id) return;
  // Default: show as "free" so these never block anyone's scheduling.
  const body = { transparency: "transparent", ...event, status: "confirmed" };

  // PUT also revives an event that was previously deleted with the same id.
  let res = await gcal(user, `${cal(user)}/events/${id}`, { method: "PUT", body: JSON.stringify(body) });
  if (res.status === 404) {
    res = await gcal(user, `${cal(user)}/events`, { method: "POST", body: JSON.stringify({ id, ...body }) });
  }
  if (res.status === 404) {
    // The user deleted the Whoop calendar: respect that and stop writing to it.
    await updateUser(user.id, { google_calendar_id: null });
    user.google_calendar_id = null;
    return;
  }
  if (!res.ok) throw new Error(`Upsert event failed: ${res.status} ${await res.text()}`);
}

export async function deleteEvent(user: User, id: string): Promise<void> {
  if (!user.google_calendar_id) return;
  const res = await gcal(user, `${cal(user)}/events/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Delete event failed: ${res.status} ${await res.text()}`);
  }
}
