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
    invitation_id: contact.invitation_id,
    message_encryption_public_key: contact.message_encryption_public_key,
    message_encryption_key_id: contact.message_encryption_key_id
  };
  if (Object.hasOwn(contact, "message_encryption_generation")) payload.message_encryption_generation = contact.message_encryption_generation;
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
  if (typeof contact.invitation_id !== "string" || !/^[0-9a-f-]{36}$/i.test(contact.invitation_id)) {
    throw new Error("Некорректный идентификатор приглашения.");
  }
  if (Object.hasOwn(contact, "display_name") &&
      (typeof contact.display_name !== "string" ||
       contact.display_name.length > 60 ||
       contact.display_name.trim() !== contact.display_name)) {
    throw new Error("Некорректное имя в приглашении.");
  }
  if (typeof contact.message_encryption_public_key !== "string" ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(contact.message_encryption_public_key) ||
      typeof contact.message_encryption_key_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(contact.message_encryption_key_id)) {
    throw new Error("В приглашении отсутствует корректный ключ шифрования. Попросите собеседника создать новое приглашение.");
  }
  if (Object.hasOwn(contact, "message_encryption_generation") &&
      (!Number.isSafeInteger(contact.message_encryption_generation) || contact.message_encryption_generation < 1)) {
    throw new Error("Некорректный номер поколения ключа шифрования в приглашении.");
  }
  const encryptionBytes = fromBase64Url(contact.message_encryption_public_key);
  if (encryptionBytes.length !== 65 || encryptionBytes[0] !== 4) {
    throw new Error("Некорректный открытый ключ шифрования в приглашении.");
  }
  try {
    await crypto.subtle.importKey("raw", encryptionBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    throw new Error("Открытый ключ шифрования в приглашении недействителен.");
  }
  if (toHex(await crypto.subtle.digest("SHA-256", encryptionBytes)) !== contact.message_encryption_key_id) {
    throw new Error("Идентификатор ключа шифрования не совпадает с ключом в приглашении.");
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
    invitation_id: contact.invitation_id,
    message_encryption_public_key: contact.message_encryption_public_key,
    message_encryption_key_id: contact.message_encryption_key_id,
    message_encryption_generation: Number(contact.message_encryption_generation) || 1,
    ...(Object.hasOwn(contact, "display_name") ? { display_name: contact.display_name } : {})
  };
}
