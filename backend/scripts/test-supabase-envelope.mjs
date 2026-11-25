#!/usr/bin/env node
"use strict";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createInvitationId, encryptSupabaseMessage, decryptSupabaseMessage } from "../../js/supabase-protocol.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const senderId = "00000000-0000-4000-8000-000000000001";
const recipientId = "00000000-0000-4000-8000-000000000002";
const otherRecipientId = "00000000-0000-4000-8000-000000000003";
const toBase64Url = bytes => Buffer.from(bytes).toString("base64url");

async function main() {
  const invitationId = createInvitationId();
  assert.match(invitationId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(invitationId, "base64url").length, 32);
  console.log("PASS: invitation ID is raw 32-byte Base64URL; no browser-side hash.");

  const sharedSecret = toBase64Url(webcrypto.getRandomValues(new Uint8Array(32)));
  const message = { type: "hello", seq: "1", body: { sid: "test-call-id", offer: { type: "offer", sdp: "test-sdp" } } };
  const envelope = await encryptSupabaseMessage({ sharedSecret, senderId, recipientId, message });
  assert.deepEqual(Object.keys(envelope).sort(), ["data", "v"]);
  assert.equal(envelope.v, 1);
  assert.equal(typeof envelope.data, "string");
  assert.equal(envelope.data.includes("hello"), false);
  assert.equal(envelope.data.includes(senderId), false);
  assert.equal(envelope.data.includes(recipientId), false);
  assert.ok(Buffer.from(envelope.data, "base64url").length > 28);
  console.log("PASS: clear envelope contains only v and encrypted data; IV/ciphertext/tag framing is present.");

  const decrypted = await decryptSupabaseMessage({ sharedSecret, senderId, recipientId, envelope });
  assert.deepEqual(decrypted, message);
  console.log("PASS: sender and recipient derive the same directional AES-256-GCM key and decrypt.");

  await assert.rejects(decryptSupabaseMessage({ sharedSecret, senderId, recipientId: otherRecipientId, envelope }));
  await assert.rejects(decryptSupabaseMessage({ sharedSecret, senderId: otherRecipientId, recipientId, envelope }));
  console.log("PASS: changing either authenticated routing UUID causes AES-GCM authentication failure.");

  await assert.rejects(decryptSupabaseMessage({ sharedSecret, senderId, recipientId, envelope: { ...envelope, v: 2 } }));
  const tampered = { ...envelope, data: (envelope.data[0] === "A" ? "B" : "A") + envelope.data.slice(1) };
  await assert.rejects(decryptSupabaseMessage({ sharedSecret, senderId, recipientId, envelope: tampered }));
  console.log("PASS: unsupported versions and modified ciphertext are rejected.");

  await assert.rejects(encryptSupabaseMessage({
    sharedSecret, senderId, recipientId,
    message: { type: "data", seq: "18446744073709551616", body: {} }
  }));
  await assert.rejects(encryptSupabaseMessage({
    sharedSecret, senderId, recipientId,
    message: { type: "data", seq: "1", from: senderId, to: recipientId, body: {} }
  }));
  console.log("PASS: uint64 sequence bounds and prohibition of from/to fields are enforced.");

  const messageTypes = [
    ["contact_accept", { user_id: "a".repeat(64), invitation_id: "00000000-0000-4000-8000-000000000004", request_id: "00000000-0000-4000-8000-000000000005" }],
    ["hello", { sid: "00000000-0000-4000-8000-000000000006", expiresAt: 1900000000000, invitation_id: "00000000-0000-4000-8000-000000000004" }],
    ["answer", { sid: "00000000-0000-4000-8000-000000000006", invitation_id: "00000000-0000-4000-8000-000000000004" }],
    ["cancel", { sid: "00000000-0000-4000-8000-000000000006", expiresAt: 1900000000000, invitation_id: "00000000-0000-4000-8000-000000000004" }],
    ["reject", { sid: "00000000-0000-4000-8000-000000000006", expiresAt: 1900000000000, invitation_id: "00000000-0000-4000-8000-000000000004" }],
    ["rotation_response", { rotation_id: "00000000-0000-4000-8000-000000000007", encrypted_key: "ciphertext", invitation_id: "00000000-0000-4000-8000-000000000004" }],
    ["data", { sid: "00000000-0000-4000-8000-000000000006", signal: { type: "signal", payload: { candidate: "candidate:1" } }, invitation_id: "00000000-0000-4000-8000-000000000004" }],
    ["text", { message_id: "00000000-0000-4000-8000-000000000008", created_at: 1800000000000, text: "hello", invitation_id: "00000000-0000-4000-8000-000000000004" }],
    ["delivered", { message_id: "00000000-0000-4000-8000-000000000008", created_at: 1800000000001, invitation_id: "00000000-0000-4000-8000-000000000004" }]
  ];
  for (const [type, body] of messageTypes) {
    const candidate = { type, seq: "2", body };
    const encrypted = await encryptSupabaseMessage({ sharedSecret, senderId, recipientId, message: candidate });
    assert.deepEqual(await decryptSupabaseMessage({ sharedSecret, senderId, recipientId, envelope: encrypted }), candidate);
    assert.equal(JSON.stringify(encrypted).includes(type), false);
    assert.equal(Object.hasOwn(body, "from"), false);
    assert.equal(Object.hasOwn(body, "to"), false);
  }
  console.log("PASS: contact bootstrap, call signaling, WebRTC data, chat and receipts all use the same v1 envelope.");

  console.log("ALL SUPABASE ENVELOPE TESTS PASSED.");
}
main().catch(error => { console.error("Supabase envelope test failed:", error); process.exitCode = 1; });
