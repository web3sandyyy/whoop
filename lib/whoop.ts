import { createHmac, timingSafeEqual } from "crypto";
import { getUser, updateUser, type User } from "./db";

const BASE = "https://api.prod.whoop.com";
const AUTH_URL = `${BASE}/oauth/oauth2/auth`;
const TOKEN_URL = `${BASE}/oauth/oauth2/token`;
const API = `${BASE}/developer/v2`;

// `offline` gives us a refresh token, so users never have to reconnect.
const SCOPES = "offline read:profile read:sleep read:recovery read:workout read:cycles";

const redirectUri = () => `${process.env.APP_URL}/api/whoop/callback`;

export type WhoopTokens = { access_token: string; refresh_token: string; expires_in: number };

export type Sleep = {
  id: string;
  cycle_id: number;
  start: string;
  end: string;
  timezone_offset: string; // e.g. "-05:00"
  nap: boolean;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    sleep_performance_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
};

export type Workout = {
  id: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: { strain: number; average_heart_rate: number; max_heart_rate: number; kilojoule: number };
};

export type Recovery = {
  cycle_id: number;
  sleep_id: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    user_calibrating: boolean;
  };
};

export function whoopAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<WhoopTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`Whoop token request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function exchangeWhoopCode(code: string): Promise<WhoopTokens> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
}

export const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

/** Returns a valid access token, refreshing (and saving the rotated refresh token) if needed. */
async function accessToken(user: User): Promise<string> {
  if (Date.parse(user.whoop_expires_at) - Date.now() > 60_000) return user.whoop_access_token;
  try {
    const t = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: user.whoop_refresh_token,
      scope: "offline",
    });
    const patch = {
      whoop_access_token: t.access_token,
      whoop_refresh_token: t.refresh_token,
      whoop_expires_at: expiresAt(t.expires_in),
    };
    await updateUser(user.id, patch);
    Object.assign(user, patch);
    return t.access_token;
  } catch (err) {
    // Whoop rotates refresh tokens. If two webhooks raced, the other one already refreshed:
    // pick up its fresh token instead of failing.
    const fresh = await getUser(user.id);
    if (fresh && fresh.whoop_refresh_token !== user.whoop_refresh_token) {
      Object.assign(user, fresh);
      return fresh.whoop_access_token;
    }
    throw err;
  }
}

async function whoopGet<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Whoop GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function get<T>(user: User, path: string): Promise<T | null> {
  return whoopGet<T>(await accessToken(user), path);
}

async function getAll<T>(user: User, path: string, start: Date): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | undefined;
  do {
    const q = new URLSearchParams({ start: start.toISOString(), limit: "25" });
    if (nextToken) q.set("nextToken", nextToken);
    const page = await get<{ records: T[]; next_token?: string }>(user, `${path}?${q}`);
    out.push(...(page?.records ?? []));
    nextToken = page?.next_token || undefined;
  } while (nextToken);
  return out;
}

export async function getWhoopUserId(token: string): Promise<number> {
  const profile = await whoopGet<{ user_id: number }>(token, "/user/profile/basic");
  if (!profile) throw new Error("Whoop profile not found");
  return profile.user_id;
}

export const getSleep = (u: User, id: string) => get<Sleep>(u, `/activity/sleep/${id}`);
export const getWorkout = (u: User, id: string) => get<Workout>(u, `/activity/workout/${id}`);
export const getRecoveryForCycle = (u: User, cycleId: number) =>
  get<Recovery>(u, `/cycle/${cycleId}/recovery`);

export const listSleeps = (u: User, since: Date) => getAll<Sleep>(u, "/activity/sleep", since);
export const listWorkouts = (u: User, since: Date) => getAll<Workout>(u, "/activity/workout", since);
export const listRecoveries = (u: User, since: Date) => getAll<Recovery>(u, "/recovery", since);

/** Revokes our access so Whoop stops sending webhooks for this user. Best effort. */
export async function revokeWhoop(user: User): Promise<void> {
  try {
    const token = await accessToken(user);
    await fetch(`${API}/user/access`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error("Whoop revoke failed", err);
  }
}

/** Whoop signs webhooks with base64(HMAC-SHA256(timestamp + rawBody, client secret)). */
export function verifyWhoopSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature) return false;
  const expected = Buffer.from(
    createHmac("sha256", process.env.WHOOP_CLIENT_SECRET!).update(timestamp + rawBody).digest("base64"),
  );
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
