import {
  getOrCreateIdentity,
  getContact
} from "./local-store.js";

const encoder = new TextEncoder();

function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Invalid base64url public key.");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toBase64Url(value) {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function toHex(value) {
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprint(publicKeyBytes) {
  return toHex(await crypto.subtle.digest("SHA-256", publicKeyBytes));
}

async function importPublicKey(publicKeyBytes) {
  return crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  );
}

export function isUserId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export async function getNtfyTopic(userId) {
  if (!isUserId(userId)) throw new TypeError("A valid anonymous user_id is required.");
  const namespace = encoder.encode("voice-link-user-v1|" + userId);
  const hash = await crypto.subtle.digest("SHA-256", namespace);
  return "vl-user-" + toHex(hash).slice(0, 40);
}

export async function getCurrentSignalingIdentity() {
  const identity = await getOrCreateIdentity();
  if (!isUserId(identity.user_id)) throw new Error("The local anonymous identity is invalid.");

  const publicBytes = fromBase64Url(identity.public_key);
  const actualFingerprint = await fingerprint(publicBytes);
  if (actualFingerprint !== identity.user_id) {
    throw new Error("The stored public key does not match the local user_id.");
  }

  const publicKey = await importPublicKey(publicBytes);
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  return {
    user_id: identity.user_id,
    public_key: identity.public_key,
    privateKey: identity.privateKey,
    publicJwk
  };
}

export async function getPeerSignalingIdentity(userId) {
  if (!isUserId(userId)) throw new TypeError("A valid contact user_id is required.");
  const contact = await getContact(userId);
  if (!contact) throw new Error("This contact is not saved on this device.");

  const publicBytes = fromBase64Url(contact.public_key);
  const actualFingerprint = await fingerprint(publicBytes);
  if (actualFingerprint !== contact.user_id) {
    throw new Error("The saved contact public key does not match its user_id.");
  }

  const publicKey = await importPublicKey(publicBytes);
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  return {
    user_id: contact.user_id,
    public_key: contact.public_key,
    publicJwk,
    name: contact.name
  };
}


export function encodePublicKey(publicKeyBytes) {
  return toBase64Url(publicKeyBytes);
}
