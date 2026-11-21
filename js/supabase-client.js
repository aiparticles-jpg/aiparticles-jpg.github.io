import { createInvitationId, encryptSupabaseMessage, decryptSupabaseMessage } from "./supabase-protocol.mjs?v=1";
import { enqueueSupabaseOutboxMessage, listSupabaseOutboxMessages, saveSupabaseOutboxEnvelope, deleteSupabaseOutboxMessage } from "./local-store.js?v=23";

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


/**
 * Redeem a contact invitation and enqueue the first encrypted Supabase inbox
 * message. Sender identity is derived from the authenticated Supabase session.
 */
function supabaseOutboxDedupeKey(type, body) {
  const payload = body?.envelope?.payload || {};
  if (["hello", "answer", "cancel", "reject"].includes(type) && typeof payload.sid === "string") return type + ":" + payload.sid;
  if (type === "rotation_response" && typeof payload.rotation_id === "string") return type + ":" + payload.rotation_id;
  if ((type === "text" || type === "delivered") && typeof payload.message_id === "string") return type + ":" + payload.message_id;
  return null;
}

/** Queue and send one encrypted message to an already linked contact. */
export async function sendSupabaseMessage({ contact, type, body }) {
  if (!contact || typeof contact !== "object" ||
      typeof contact.supabase_user_id !== "string" ||
      typeof contact.invitation_secret !== "string" ||
      (!contact.supabase_invitation_redeemed_at && !contact.supabase_contact_accepted_at)) {
    throw new TypeError("Контакт ещё не подтвердил связь через Supabase или не содержит общего ключа.");
  }
  const identity = await getSupabaseIdentity();
  const recipientId = contact.supabase_user_id.toLowerCase();
  if (identity.user_id === recipientId) throw new Error("Нельзя отправить сообщение самому себе.");
  // Sequence reservation and the recoverable outbox row share one IndexedDB transaction.
  const dedupeKey = supabaseOutboxDedupeKey(type, body);
  const queued = await enqueueSupabaseOutboxMessage(recipientId, type, body, dedupeKey);
  await flushSupabaseOutbox({ contact, senderId: identity.user_id });
  return { sequence: queued.sequence, queued: false };
}

/** Flush pending messages in sequence order; uncertain sends retain identical ciphertext for retry. */
export async function flushSupabaseOutbox({ contact, senderId = null }) {
  if (!contact || typeof contact !== "object" ||
      typeof contact.supabase_user_id !== "string" ||
      typeof contact.invitation_secret !== "string") {
    throw new TypeError("A valid Supabase contact is required to flush its outbox.");
  }
  const identity = senderId ? { user_id: senderId } : await getSupabaseIdentity();
  const recipientId = contact.supabase_user_id.toLowerCase();
  const sender = identity.user_id.toLowerCase();
  if (!SUPABASE_UUID_RE.test(sender) || !SUPABASE_UUID_RE.test(recipientId) || sender === recipientId) {
    throw new TypeError("Invalid Supabase sender or recipient identity.");
  }
  const supabase = getSupabaseClient();
  const pending = await listSupabaseOutboxMessages(recipientId);
  let sent = 0;
  for (let message of pending) {
    if (!message.payload) {
      if (!message.body || typeof message.body !== "object") {
        throw new Error("В исходящей очереди Supabase повреждено неподготовленное сообщение.");
      }
      const payload = await encryptSupabaseMessage({
        sharedSecret: contact.invitation_secret,
        senderId: sender,
        recipientId,
        message: { type: message.type, seq: message.sequence, body: message.body }
      });
      message = await saveSupabaseOutboxEnvelope(message.id, payload);
    }
    const { data, error } = await supabase.rpc("submit_message", {
      p_payload: message.payload,
      p_recipient_id: recipientId,
      p_invitation_id: null
    });
    if (error) {
      const failure = new Error("Сообщение Supabase seq=" + message.sequence + " осталось в исходящей очереди: " + error.message);
      const status = Number(error.status);
      failure.retryable = !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
      throw failure;
    }
    if (typeof data !== "string" || Number.isNaN(Date.parse(data))) {
      throw new Error("Supabase не вернул корректное время для сообщения seq=" + message.sequence + "; сообщение оставлено в очереди для безопасного повтора.");
    }
    await deleteSupabaseOutboxMessage(message.id);
    sent++;
  }
  return { sent, remaining: (await listSupabaseOutboxMessages(recipientId)).length };
}

export async function submitSupabaseInvitationAcceptance({ contact }) {
  if (!contact || typeof contact !== "object" ||
      typeof contact.supabase_user_id !== "string" ||
      typeof contact.supabase_invitation_id !== "string" ||
      typeof contact.invitation_secret !== "string") {
    throw new TypeError("Контакт не содержит полного Supabase-приглашения.");
  }

  const identity = await getSupabaseIdentity();
  if (identity.user_id === contact.supabase_user_id.toLowerCase()) {
    throw new Error("Нельзя принять собственное Supabase-приглашение.");
  }

  const payload = await encryptSupabaseMessage({
    sharedSecret: contact.invitation_secret,
    senderId: identity.user_id,
    recipientId: contact.supabase_user_id,
    message: { type: "contact_accept", seq: "1", body: {} }
  });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("submit_message", {
    p_payload: payload,
    p_recipient_id: null,
    p_invitation_id: contact.supabase_invitation_id
  });
  if (error) {
    throw new Error("Supabase не принял первое зашифрованное сообщение: " + error.message);
  }
  if (typeof data !== "string" || Number.isNaN(Date.parse(data))) {
    throw new Error("Supabase не вернул корректное время создания первого сообщения.");
  }
  return { created_at: data, sender_id: identity.user_id, recipient_id: contact.supabase_user_id.toLowerCase() };
}


const SUPABASE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function subscribeSupabaseInbox(userId, onMessage, onStatus = () => {}) {
  if (typeof userId !== "string" || !SUPABASE_UUID_RE.test(userId) || typeof onMessage !== "function") {
    throw new TypeError("A valid Supabase inbox identity and message handler are required.");
  }
  return getSupabaseClient()
    .channel("inbox:" + userId.toLowerCase(), { config: { private: true } })
    .on("broadcast", { event: "INSERT" }, message => {
      // The database trigger broadcasts the complete inserted row to inbox:<recipient>.
      const record = message?.payload?.record || message?.record || null;
      Promise.resolve(onMessage(record)).catch(error => console.error("VoiceLink Supabase inbox handler failed:", error));
    })
    .subscribe(status => onStatus(status));
}

export async function fetchSupabaseInbox(userId, pageSize = 500) {
  if (typeof userId !== "string" || !SUPABASE_UUID_RE.test(userId)) throw new TypeError("A valid Supabase inbox identity is required.");
  const safePageSize = Math.max(1, Math.min(1000, Math.trunc(Number(pageSize) || 500)));
  const supabase = getSupabaseClient();
  const rows = [];
  // Read the complete durable inbox in bounded pages. Broadcast is already
  // subscribed by the caller, so inserts concurrent with this scan are also
  // delivered live; seq makes overlap/duplicate delivery harmless.
  for (let offset = 0; ; offset += safePageSize) {
    const { data, error } = await supabase.from("messages")
      .select("sender_id,recipient_id,payload,created_at")
      .eq("recipient_id", userId.toLowerCase())
      .order("created_at", { ascending: true })
      .order("sender_id", { ascending: true })
      .order("payload", { ascending: true })
      .range(offset, offset + safePageSize - 1);
    if (error) throw new Error("Не удалось восстановить входящие сообщения Supabase: " + error.message);
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < safePageSize) break;
  }
  return rows;
}

export async function decryptSupabaseInboxRecord(record, sharedSecret) {
  if (!record || typeof record !== "object" || typeof record.sender_id !== "string" ||
      typeof record.recipient_id !== "string" || typeof record.created_at !== "string" || Number.isNaN(Date.parse(record.created_at)) || !record.payload) {
    throw new TypeError("Supabase inbox row is incomplete.");
  }
  const candidates = (Array.isArray(sharedSecret) ? sharedSecret : [sharedSecret])
    .filter((secret, index, values) => typeof secret === "string" && secret && values.indexOf(secret) === index);
  let lastError;
  for (const secret of candidates) {
    try {
      return await decryptSupabaseMessage({
        sharedSecret: secret, senderId: record.sender_id, recipientId: record.recipient_id, envelope: record.payload
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No active shared key can decrypt this Supabase inbox message.");
}
