import { after } from "next/server";
import { getUserByWhoopId } from "@/lib/db";
import { handleWebhook } from "@/lib/sync";
import { verifyWhoopSignature } from "@/lib/whoop";

export const maxDuration = 60;

type WhoopWebhook = { user_id: number; id: string | number; type: string; trace_id?: string };

export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyWhoopSignature(
    raw,
    req.headers.get("x-whoop-signature-timestamp"),
    req.headers.get("x-whoop-signature"),
  );
  if (!ok) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(raw) as WhoopWebhook;

  // Answer Whoop immediately; do the API calls after the response is sent.
  after(async () => {
    try {
      const user = await getUserByWhoopId(event.user_id);
      if (!user?.google_calendar_id) return;
      await handleWebhook(user, event.type, String(event.id));
    } catch (err) {
      console.error("Webhook sync failed", event, err);
    }
  });

  return new Response("ok");
}
