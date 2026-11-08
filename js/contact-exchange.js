const encoder = new TextEncoder();

function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Некорректное base64url-значение.");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toHex(value) {
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalPayload(contact) {
  // Field order is part of the signed v1 package format.
  const payload = {
    version: contact.version,
    user_id: contact.user_id,
    public_key: contact.public_key,
    push_subscription_id: contact.push_subscription_id,
    created_at: contact.created_at
  };
  // Optional display name was added to v1 later; omit it for older invitations.
  if (Object.hasOwn(contact, "invitation_id")) payload.invitation_id = contact.invitation_id;
  if (Object.hasOwn(contact, "display_name")) payload.display_name = contact.display_name;
  return JSON.stringify(payload);
}

function decodeInput(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Вставьте ссылку или пакет контакта.");

  let encoded = raw;
  try {
    const url = new URL(raw);
    const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const params = new URLSearchParams(fragment);
    encoded = params.get("contact") || raw;
  } catch {
    if (raw.startsWith("#")) {
      const params = new URLSearchParams(raw.slice(1));
      encoded = params.get("contact") || raw;
    }
  }

  if (encoded.startsWith("{")) return JSON.parse(encoded);
  const bytes = fromBase64Url(encoded);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function verifyContactPackage(input) {
  const contact = decodeInput(input);
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) {
    throw new Error("Пакет контакта должен быть JSON-объектом.");
  }
  if (contact.version !== 1) throw new Error("Неподдерживаемая версия пакета контакта.");
  if (typeof contact.user_id !== "string" || !/^[a-f0-9]{64}$/.test(contact.user_id)) {
    throw new Error("Некорректный анонимный идентификатор контакта.");
  }
  if (typeof contact.public_key !== "string" ||
      typeof contact.push_subscription_id !== "string" ||
      !contact.push_subscription_id.trim() ||
      typeof contact.signature !== "string") {
    throw new Error("В пакете отсутствует публичный ключ, OneSignal Subscription ID или подпись.");
  }
  if (contact.created_at !== undefined &&
      (!Number.isFinite(Number(contact.created_at)) ||
       Number(contact.created_at) <= 0 ||
       Number(contact.created_at) > Date.now() + 5 * 60 * 1000)) {
    throw new Error("Некорректная дата создания приглашения.");
  }
  if (Object.hasOwn(contact, "invitation_id") &&
      (typeof contact.invitation_id !== "string" || !/^[0-9a-f-]{36}$/i.test(contact.invitation_id))) {
    throw new Error("Некорректный идентификатор приглашения.");
  }
  if (Object.hasOwn(contact, "display_name") &&
      (typeof contact.display_name !== "string" ||
       contact.display_name.length > 60 ||
       contact.display_name.trim() !== contact.display_name)) {
    throw new Error("Некорректное имя в приглашении.");
  }

  const publicBytes = fromBase64Url(contact.public_key);
  const fingerprint = toHex(await crypto.subtle.digest("SHA-256", publicBytes));
  if (fingerprint !== contact.user_id) {
    throw new Error("Fingerprint публичного ключа не совпадает с user_id.");
  }

  const signature = fromBase64Url(contact.signature);
  const publicKey = await crypto.subtle.importKey(
    "raw",
    publicBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    encoder.encode(canonicalPayload(contact))
  );
  if (!valid) throw new Error("Подпись пакета недействительна.");

  return {
    version: 1,
    user_id: contact.user_id,
    public_key: contact.public_key,
    push_subscription_id: contact.push_subscription_id,
    ...(contact.created_at !== undefined ? { created_at: Number(contact.created_at) } : {}),
    ...(Object.hasOwn(contact, "invitation_id") ? { invitation_id: contact.invitation_id } : {}),
    ...(Object.hasOwn(contact, "display_name") ? { display_name: contact.display_name } : {})
  };
}
