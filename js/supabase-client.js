import { createInvitationId } from "./supabase-protocol.mjs?v=1";

const SUPABASE_URL = "https://lcmccpecmtnqknthtijl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GEu1s4k6b44_2km0_9w1gw_3RuiN_S9";
const STORAGE_KEY = "voicelink-supabase-auth-v1";

let client;

export function getSupabaseClient() {
  if (client) return client;
  const createClient = globalThis.supabase?.createClient;
  if (typeof createClient !== "function") {
    throw new Error("Не загрузилась библиотека Supabase. Проверьте соединение и обновите страницу.");
  }
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: STORAGE_KEY
    },
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  });
  return client;
}

/**
 * Returns the one network identity for the new transport: Supabase Anonymous
 * Auth UUID. The old local/ntfy identity is deliberately left untouched while
 * the production transport migration is in progress.
 */
export async function getSupabaseIdentity() {
  const supabase = getSupabaseClient();
  let { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Не удалось получить Supabase Auth session: " + error.message);
  let session = data?.session;

  if (!session) {
    ({ data, error } = await supabase.auth.signInAnonymously());
    if (error) throw new Error("Не удалось создать анонимную Supabase Auth session: " + error.message);
    session = data?.session;
  }

  if (!session?.user?.id || session.user.is_anonymous !== true) {
    throw new Error("Supabase вернул сессию без анонимного Auth UUID.");
  }
  return { user_id: session.user.id.toLowerCase() };
}

/**
 * Creates the server-side one-time route for a future first message. The raw
 * ID is returned only to the caller for inclusion in an invitation; PostgreSQL
 * stores SHA-256(raw ID). This helper is introduced separately from the live
 * ntfy exchange so the current contact handshake is not switched prematurely.
 */
export async function createSupabaseInvitation() {
  const identity = await getSupabaseIdentity();
  const supabase = getSupabaseClient();
  const invitationId = createInvitationId();
  const { error } = await supabase.rpc("create_invitation", {
    p_invitation_id: invitationId
  });
  if (error) throw new Error("Не удалось зарегистрировать одноразовое приглашение Supabase: " + error.message);
  return {
    supabase_user_id: identity.user_id,
    supabase_invitation_id: invitationId
  };
}
