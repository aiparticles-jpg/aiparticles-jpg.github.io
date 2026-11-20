const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITATION_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_UINT64 = 18446744073709551615n;

function requireCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto API is unavailable.");
  }
}
function encode64url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
function decode64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("Invalid Base64URL value.");
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function uuid(value, label) {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new TypeError("Invalid " + label + " Supabase UUID.");
  return value.toLowerCase();
}
function validateMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid message plaintext.");
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== "body" || keys[1] !== "seq" || keys[2] !== "type") {
    throw new TypeError("Message plaintext must contain only type, seq and body.");
  }
  if (typeof value.type !== "string" || !value.type || value.type.length > 64) throw new TypeError("Invalid message type.");
  if (typeof value.seq !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value.seq)) throw new TypeError("Invalid message sequence.");
  const sequence = BigInt(value.seq);
  if (sequence < 1n || sequence > MAX_UINT64) throw new TypeError("Message sequence is outside uint64 range.");
  if (!value.body || typeof value.body !== "object" || Array.isArray(value.body)) throw new TypeError("Message body must be an object.");
  return value;
}
async function deriveKey(secret, sender, recipient) {
  if (typeof secret !== "string" || !INVITATION_RE.test(secret)) throw new TypeError("Shared contact secret must be 32-byte Base64URL.");
  const raw = decode64url(secret);
  if (raw.length !== 32) throw new TypeError("Shared contact secret must be exactly 32 bytes.");
  const material = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const pair = [sender, recipient].sort().join("|");
  const salt = await crypto.subtle.digest("SHA-256", encoder.encode("voicelink-supabase-pair-v1|" + pair));
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt,
    info: encoder.encode("voicelink-supabase-message-v1|" + sender + "|" + recipient)
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function aad(version, sender, recipient) {
  return encoder.encode("voicelink-supabase-envelope|v=" + version + "|sender=" + sender + "|recipient=" + recipient);
}

/** Generate the original raw 256-bit invitation ID; hashing happens only in PostgreSQL. */
export function createInvitationId() {
  requireCrypto();
  return encode64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Encrypt {type, seq, body} as {v:1,data:base64url(IV || ciphertext || GCM tag)}. */
export async function encryptSupabaseMessage({ sharedSecret, senderId, recipientId, message }) {
  requireCrypto();
  const sender = uuid(senderId, "sender");
  const recipient = uuid(recipientId, "recipient");
  if (sender === recipient) throw new TypeError("Sender and recipient must be different.");
  const valid = validateMessage(message);
  const key = await deriveKey(sharedSecret, sender, recipient);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: aad(1, sender, recipient), tagLength: 128
  }, key, encoder.encode(JSON.stringify(valid))));
  const framed = new Uint8Array(12 + encrypted.length);
  framed.set(iv, 0);
  framed.set(encrypted, 12);
  return { v: 1, data: encode64url(framed) };
}

/** Decrypt using authenticated database-row sender_id and recipient_id as AAD. */
export async function decryptSupabaseMessage({ sharedSecret, senderId, recipientId, envelope }) {
  requireCrypto();
  const sender = uuid(senderId, "sender");
  const recipient = uuid(recipientId, "recipient");
  if (sender === recipient) throw new TypeError("Sender and recipient must be different.");
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(",") !== "data,v" || envelope.v !== 1 || typeof envelope.data !== "string") {
    throw new TypeError("Unsupported or malformed Supabase message envelope.");
  }
  const framed = decode64url(envelope.data);
  if (framed.length < 29) throw new TypeError("Encrypted message is too short.");
  const key = await deriveKey(sharedSecret, sender, recipient);
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: framed.slice(0, 12),
    additionalData: aad(envelope.v, sender, recipient), tagLength: 128
  }, key, framed.slice(12));
  return validateMessage(JSON.parse(decoder.decode(plaintext)));
}
