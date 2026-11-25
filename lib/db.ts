import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type User = {
  id: string;
  whoop_user_id: number;
  whoop_access_token: string;
  whoop_refresh_token: string;
  whoop_expires_at: string;
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_expires_at: string | null;
  google_calendar_id: string | null;
  created_at: string;
};

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function getUser(id: string): Promise<User | null> {
  const { data, error } = await db().from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as User | null;
}

export async function getUserByWhoopId(whoopUserId: number): Promise<User | null> {
  const { data, error } = await db()
    .from("users")
    .select("*")
    .eq("whoop_user_id", whoopUserId)
    .maybeSingle();
  if (error) throw error;
  return data as User | null;
}

export async function upsertWhoopUser(
  fields: Pick<User, "whoop_user_id" | "whoop_access_token" | "whoop_refresh_token" | "whoop_expires_at">,
): Promise<User> {
  const { data, error } = await db()
    .from("users")
    .upsert(fields, { onConflict: "whoop_user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as User;
}

export async function updateUser(id: string, patch: Partial<Omit<User, "id">>): Promise<void> {
  const { error } = await db().from("users").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await db().from("users").delete().eq("id", id);
  if (error) throw error;
}
