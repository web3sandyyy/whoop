import type { User } from "./db";
import { deleteEvent, eventId, upsertEvent } from "./google";
import {
  getRecoveryForCycle,
  getSleep,
  getWorkout,
  listRecoveries,
  listSleeps,
  listWorkouts,
  type Recovery,
  type Sleep,
  type Workout,
} from "./whoop";

const MIN = 60_000;
const HOUR = 60 * MIN;

// Google event colors: 10 = Basil (green), 5 = Banana (yellow), 11 = Tomato (red), 8 = Graphite.
const GREEN = "10", YELLOW = "5", RED = "11", GREY = "8";

// ---------- formatting ----------

/** 6000000 -> "1h40" */
function hmCompact(ms: number): string {
  const total = Math.round(ms / MIN);
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
}

/** 33000000 -> "9h 10m" */
function hmLong(ms: number): string {
  const total = Math.round(ms / MIN);
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

function offsetMinutes(offset: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset ?? "");
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Wall-clock time in the user's own timezone, e.g. "12:45" or "10:30". */
function localClock(utcMs: number, offset: string): string {
  const d = new Date(utcMs + offsetMinutes(offset) * MIN);
  const h = d.getUTCHours() % 12 || 12;
  return `${h}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function localDate(utcMs: number, offset: string): string {
  return new Date(utcMs + offsetMinutes(offset) * MIN).toISOString().slice(0, 10);
}

const iso = (ms: number) => new Date(ms).toISOString();

function sportLabel(name: string): string {
  const s = (name || "Workout").replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sportEmoji(name: string): string {
  const s = (name || "").toLowerCase();
  if (/run|jog/.test(s)) return "🏃";
  if (/cycl|bik|spin/.test(s)) return "🚴";
  if (/swim/.test(s)) return "🏊";
  if (/walk|hik/.test(s)) return "🚶";
  if (/yoga|pilates|stretch/.test(s)) return "🧘";
  return "🏋️";
}

// ---------- sleep ----------

async function writeSleep(user: User, sleep: Sleep): Promise<void> {
  if (sleep.score_state !== "SCORED" || !sleep.score) return;
  const st = sleep.score.stage_summary;
  const asleep =
    st.total_light_sleep_time_milli + st.total_slow_wave_sleep_time_milli + st.total_rem_sleep_time_milli;
  const perf = sleep.score.sleep_performance_percentage;

  const summary = sleep.nap
    ? `💤 Nap · ${(asleep / HOUR).toFixed(1)}h asleep`
    : [`😴 ${(asleep / HOUR).toFixed(1)}h asleep`, perf != null ? `${Math.round(perf)}%` : null,
       `REM ${hmCompact(st.total_rem_sleep_time_milli)}`].filter(Boolean).join(" · ");

  await upsertEvent(user, eventId("sleep", sleep.id), {
    summary,
    description: [
      `In bed: ${hmLong(st.total_in_bed_time_milli)}`,
      `Awake: ${hmLong(st.total_awake_time_milli)}`,
      `Light: ${hmLong(st.total_light_sleep_time_milli)}`,
      `Deep (SWS): ${hmLong(st.total_slow_wave_sleep_time_milli)}`,
      `REM: ${hmLong(st.total_rem_sleep_time_milli)}`,
      sleep.score.sleep_efficiency_percentage != null
        ? `Efficiency: ${Math.round(sleep.score.sleep_efficiency_percentage)}%` : "",
    ].filter(Boolean).join("\n"),
    start: { dateTime: sleep.start },
    end: { dateTime: sleep.end },
    colorId: GREY,
  });

  // Tonight's bedtime is only worth writing off the most recent night's sleep.
  if (!sleep.nap && Date.now() - Date.parse(sleep.end) < 20 * HOUR) {
    await writeBedtime(user, sleep);
  }
}

/**
 * "🛏️ Bed by 12:45 · you need 9h 10m"
 * Need = Whoop's sleep need (baseline + debt + strain − naps) from the latest scored sleep.
 * Target wake time = the same clock time you woke up this morning.
 */
async function writeBedtime(user: User, sleep: Sleep): Promise<void> {
  const n = sleep.score!.sleep_needed;
  const need =
    n.baseline_milli + n.need_from_sleep_debt_milli + n.need_from_recent_strain_milli -
    Math.abs(n.need_from_recent_nap_milli);
  if (!(need > 0)) return;

  const wake = Date.parse(sleep.end) + 24 * HOUR;
  const bed = wake - need;
  const tz = sleep.timezone_offset;

  await upsertEvent(user, eventId("bedtime", localDate(bed, tz)), {
    summary: `🛏️ Bed by ${localClock(bed, tz)} · you need ${hmLong(need)}`,
    description:
      `To get the ${hmLong(need)} of sleep WHOOP says you need and still wake at ` +
      `${localClock(wake, tz)} (your wake time this morning).\n\n` +
      `Baseline ${hmLong(n.baseline_milli)} · sleep debt +${hmLong(n.need_from_sleep_debt_milli)} · ` +
      `strain +${hmLong(n.need_from_recent_strain_milli)} · naps −${hmLong(Math.abs(n.need_from_recent_nap_milli))}`,
    // 30-minute wind-down block that ends at bedtime, with a pop-up when it starts.
    start: { dateTime: iso(bed - 30 * MIN) },
    end: { dateTime: iso(bed) },
    colorId: "9", // Blueberry
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  });
}

// ---------- recovery ----------

async function writeRecovery(user: User, recovery: Recovery, sleep: Sleep): Promise<void> {
  if (recovery.score_state !== "SCORED" || !recovery.score) return;
  const { recovery_score, hrv_rmssd_milli, resting_heart_rate } = recovery.score;
  const score = Math.round(recovery_score);
  const [emoji, color] = score >= 67 ? ["🟢", GREEN] : score >= 34 ? ["🟡", YELLOW] : ["🔴", RED];
  const wake = Date.parse(sleep.end);

  await upsertEvent(user, eventId("recovery", sleep.id), {
    summary: `${emoji} Recovery ${score}% · HRV ${Math.round(hrv_rmssd_milli)} · RHR ${Math.round(resting_heart_rate)}`,
    description: recovery.score.user_calibrating ? "WHOOP is still calibrating." : undefined,
    start: { dateTime: iso(wake) },
    end: { dateTime: iso(wake + 30 * MIN) },
    colorId: color,
  });
}

// ---------- workouts ----------

async function writeWorkout(user: User, w: Workout): Promise<void> {
  if (w.score_state !== "SCORED" || !w.score) return;
  await upsertEvent(user, eventId("workout", w.id), {
    summary: `${sportEmoji(w.sport_name)} ${sportLabel(w.sport_name)} · Strain ${w.score.strain.toFixed(1)}`,
    description:
      `Avg HR ${Math.round(w.score.average_heart_rate)} · Max HR ${Math.round(w.score.max_heart_rate)} · ` +
      `${Math.round(w.score.kilojoule / 4.184)} kcal`,
    start: { dateTime: w.start },
    end: { dateTime: w.end },
    colorId: "6", // Tangerine
  });
}

// ---------- entry points ----------

/** Handles one Whoop webhook. For recovery events, `id` is the sleep's UUID (Whoop API v2). */
export async function handleWebhook(user: User, type: string, id: string): Promise<void> {
  switch (type) {
    case "sleep.updated": {
      const sleep = await getSleep(user, id);
      if (sleep) await writeSleep(user, sleep);
      return;
    }
    case "sleep.deleted":
      return deleteEvent(user, eventId("sleep", id));

    case "workout.updated": {
      const w = await getWorkout(user, id);
      if (w) await writeWorkout(user, w);
      return;
    }
    case "workout.deleted":
      return deleteEvent(user, eventId("workout", id));

    case "recovery.updated": {
      const sleep = await getSleep(user, id);
      if (!sleep) return;
      const recovery = await getRecoveryForCycle(user, sleep.cycle_id);
      if (recovery) await writeRecovery(user, recovery, sleep);
      return;
    }
    case "recovery.deleted":
      return deleteEvent(user, eventId("recovery", id));
  }
}

/** Right after connecting: fill in the last week so the calendar isn't empty on day one. */
export async function backfill(user: User, days = 7): Promise<void> {
  const since = new Date(Date.now() - days * 24 * HOUR);
  const [sleeps, workouts, recoveries] = await Promise.all([
    listSleeps(user, since),
    listWorkouts(user, since),
    listRecoveries(user, since),
  ]);
  const sleepById = new Map(sleeps.map((s) => [s.id, s]));

  for (const s of sleeps) await writeSleep(user, s);
  for (const w of workouts) await writeWorkout(user, w);
  for (const r of recoveries) {
    const s = sleepById.get(r.sleep_id);
    if (s) await writeRecovery(user, r, s);
  }
}
