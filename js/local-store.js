const DB_NAME = "voicelink-local";
const DB_VERSION = 3;
const HISTORY_LIMIT = 10;

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("contacts")) {
        db.createObjectStore("contacts", { keyPath: "user_id" });
      }
      if (!db.objectStoreNames.contains("history")) {
        const history = db.createObjectStore("history", { keyPath: "id" });
        history.createIndex("created_at", "created_at");
      }
      if (!db.objectStoreNames.contains("invitations")) db.createObjectStore("invitations", { keyPath: "id" });
      if (!db.objectStoreNames.contains("conversation")) {
        const conversation = db.createObjectStore("conversation", { keyPath: "id" });
        conversation.createIndex("contact_user_id", "contact_user_id");
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("Could not open local storage."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Local storage upgrade is blocked by another open tab."));
    };
  });

  return databasePromise;
}


export async function createIssuedInvitation({ id, secret, created_at = Date.now(), max_activations = 1 }) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) ||
      typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
      !Number.isFinite(Number(created_at)) || !Number.isInteger(max_activations) || max_activations < 1) {
    throw new TypeError("A valid invitation ID, 256-bit secret, creation time, and activation limit are required.");
  }
  const db = await openDatabase();
  const tx = db.transaction("invitations", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("invitations").add({ id, secret, created_at: Number(created_at), max_activations, activations: [], revoked: false });
  await done;
}

export async function getIssuedInvitation(invitationId) {
  if (typeof invitationId !== "string" || !/^[0-9a-f-]{36}$/i.test(invitationId)) return null;
  const db = await openDatabase();
  const tx = db.transaction("invitations", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("invitations").get(invitationId));
  await done;
  return record || null;
}

export async function listIssuedInvitations() {
  const db = await openDatabase();
  const tx = db.transaction("invitations", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("invitations").getAll());
  await done;
  return Array.isArray(records) ? records : [];
}

export async function consumeIssuedInvitation({ invitationId, userId, requestId }) {
  if (typeof invitationId !== "string" || !/^[0-9a-f-]{36}$/i.test(invitationId) ||
      typeof userId !== "string" || !/^[a-f0-9]{64}$/.test(userId) ||
      typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) return { accepted: false, reason: "invalid" };
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("invitations", "readwrite");
    const store = tx.objectStore("invitations");
    let result = { accepted: false, reason: "unknown" };
    const get = store.get(invitationId);
    get.onsuccess = () => {
      const invitation = get.result;
      if (!invitation) { result = { accepted: false, reason: "unknown" }; return; }
      if (invitation.revoked) { result = { accepted: false, reason: "revoked" }; return; }
      const activations = Array.isArray(invitation.activations) ? invitation.activations : [];
      const existing = activations.find(item => item.user_id === userId);
      if (existing) { result = { accepted: true, duplicate: true, activation: existing, created_at: Number(invitation.created_at) }; return; }
      if (activations.length >= Number(invitation.max_activations || 1)) { result = { accepted: false, reason: "used" }; return; }
      const activation = { user_id: userId, request_id: requestId, activated_at: Date.now(), status: "pending" };
      invitation.activations = [...activations, activation];
      store.put(invitation);
      result = { accepted: true, duplicate: false, activation, created_at: Number(invitation.created_at) };
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error("Invitation activation transaction aborted."));
    tx.onerror = () => reject(tx.error || new Error("Invitation activation transaction failed."));
  });
}

export async function hasActiveInvitationGrant(invitationId, userId) {
  if (typeof invitationId !== "string" || typeof userId !== "string") return false;
  const db = await openDatabase();
  const tx = db.transaction("invitations", "readonly");
  const done = transactionDone(tx);
  const invitation = await requestValue(tx.objectStore("invitations").get(invitationId));
  await done;
  return !!invitation && !invitation.revoked && Array.isArray(invitation.activations) &&
    invitation.activations.some(item => item.user_id === userId);
}

export async function saveMyInvitation(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new TypeError("A valid HTTPS invitation URL is required.");
  }
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("meta").put({
    key: "my_invitation",
    value: { url, updated_at: new Date().toISOString() }
  });
  await done;
}

export async function getMyInvitation() {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("meta").get("my_invitation"));
  await done;
  return record?.value?.url || "";
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function getOrCreateIdentity() {
  const db = await openDatabase();
  const read = db.transaction("meta", "readonly");
  const readDone = transactionDone(read);
  const record = await requestValue(read.objectStore("meta").get("identity"));
  await readDone;
  if (record?.value?.version === 2 && typeof record.value.user_id === "string" && /^[a-f0-9]{64}$/.test(record.value.user_id)) return record.value;

  // One-time protocol migration: old ECDSA identities and their contact trust
  // records cannot be mixed with the capability/HMAC protocol.
  if (record?.value) {
    const tx = db.transaction(["meta", "contacts", "history", "conversation", "invitations"], "readwrite");
    const done = transactionDone(tx);
    const meta = tx.objectStore("meta");
    meta.delete("identity");
    meta.delete("my_invitation");
    meta.delete("message_encryption_identity");
    meta.delete("message_encryption_pending_identity");
    meta.delete("message_encryption_previous_identity");
    tx.objectStore("contacts").clear();
    tx.objectStore("history").clear();
    tx.objectStore("conversation").clear();
    tx.objectStore("invitations").clear();
    await done;
  }
  if (!globalThis.crypto?.subtle) throw new Error("This browser does not support the Web Crypto API.");
  const random = crypto.getRandomValues(new Uint8Array(32));
  const userId = toHex(await crypto.subtle.digest("SHA-256", random));
  random.fill(0);
  const identity = { version: 2, user_id: userId, created_at: new Date().toISOString() };
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  const current = await requestValue(store.get("identity"));
  if (current?.value?.version === 2 && current.value.user_id) { await done; return current.value; }
  store.put({ key: "identity", value: identity });
  await done;
  return identity;
}

export async function getOrCreateMessageEncryptionIdentity() {
  const db = await openDatabase();
  const read = db.transaction("meta", "readonly");
  const readDone = transactionDone(read);
  const existing = await requestValue(read.objectStore("meta").get("message_encryption_identity"));
  await readDone;
  if (existing?.value?.privateKey && existing.value.public_key && existing.value.key_id) return existing.value;
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto API is required.");
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicBytes = await crypto.subtle.exportKey("raw", pair.publicKey);
  const privateBytes = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const privateKey = await crypto.subtle.importKey("pkcs8", privateBytes, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  new Uint8Array(privateBytes).fill(0);
  const value = { privateKey, public_key: toBase64Url(publicBytes), key_id: toHex(await crypto.subtle.digest("SHA-256", publicBytes)), created_at: new Date().toISOString() };
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  const current = await requestValue(store.get("message_encryption_identity"));
  if (current?.value?.privateKey) { await done; return current.value; }
  store.put({ key: "message_encryption_identity", value });
  await done;
  return value;
}


export async function getMessageEncryptionKeyRing() {
  const fallback = await getOrCreateMessageEncryptionIdentity();
  const db = await openDatabase();
  const tx = db.transaction("meta", "readonly");
  const done = transactionDone(tx);
  const meta = tx.objectStore("meta");
  const [activeRecord, pending, previous] = await Promise.all([
    requestValue(meta.get("message_encryption_identity")),
    requestValue(meta.get("message_encryption_pending_identity")),
    requestValue(meta.get("message_encryption_previous_identity"))
  ]);
  await done;
  const active = activeRecord?.value || fallback;
  let previousValue = previous?.value || null;
  if (previousValue?.peer_switched_at && Date.now() - Number(previousValue.peer_switched_at) >= 12 * 60 * 60 * 1000) {
    await clearPreviousMessageEncryptionIdentity(previousValue.key_id);
    previousValue = null;
  }
  return { active: { ...active, generation: Number(active.generation) || 1 }, pending: pending?.value || null, previous: previousValue };
}

export async function createPendingMessageEncryptionIdentity() {
  const ring = await getMessageEncryptionKeyRing();
  if (ring.pending) return ring.pending;
  if (ring.previous) return null;
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicBytes = await crypto.subtle.exportKey("raw", pair.publicKey);
  const privateBytes = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const privateKey = await crypto.subtle.importKey("pkcs8", privateBytes, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  new Uint8Array(privateBytes).fill(0);
  const value = { privateKey, public_key: toBase64Url(publicBytes), key_id: toHex(await crypto.subtle.digest("SHA-256", publicBytes)), generation: ring.active.generation + 1, created_at: new Date().toISOString() };
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const meta = tx.objectStore("meta");
  const [activeRecord, pendingRecord, previousRecord] = await Promise.all([
    requestValue(meta.get("message_encryption_identity")),
    requestValue(meta.get("message_encryption_pending_identity")),
    requestValue(meta.get("message_encryption_previous_identity"))
  ]);
  if (pendingRecord?.value) { await done; return pendingRecord.value; }
  if (previousRecord?.value || activeRecord?.value?.key_id !== ring.active.key_id) { await done; return null; }
  meta.put({ key: "message_encryption_pending_identity", value });
  await done;
  return value;
}

export async function activatePendingMessageEncryptionIdentity(keyId, generation) {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const meta = tx.objectStore("meta");
  const [activeRecord, pendingRecord, previousRecord] = await Promise.all([
    requestValue(meta.get("message_encryption_identity")),
    requestValue(meta.get("message_encryption_pending_identity")),
    requestValue(meta.get("message_encryption_previous_identity"))
  ]);
  const active = activeRecord?.value, pending = pendingRecord?.value;
  if (!active || !pending || pending.key_id !== keyId || Number(pending.generation) !== Number(generation) || previousRecord?.value) { await done; return false; }
  meta.put({ key: "message_encryption_previous_identity", value: { ...active, generation: Number(active.generation) || 1 } });
  meta.put({ key: "message_encryption_identity", value: { ...pending, activated_at: new Date().toISOString() } });
  meta.delete("message_encryption_pending_identity");
  await done;
  return true;
}


export async function acknowledgePendingMessageEncryptionIdentity(keyId, generation, peerId, requiredPeerIds) {
  if (typeof keyId !== "string" || typeof peerId !== "string" || !Array.isArray(requiredPeerIds)) return false;
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const meta = tx.objectStore("meta");
  const record = await requestValue(meta.get("message_encryption_pending_identity"));
  const pending = record?.value;
  if (!pending || pending.key_id !== keyId || Number(pending.generation) !== Number(generation)) { await done; return false; }
  const acknowledged = new Set(Array.isArray(pending.acknowledged_peers) ? pending.acknowledged_peers : []);
  acknowledged.add(peerId);
  meta.put({ key: "message_encryption_pending_identity", value: { ...pending, acknowledged_peers: [...acknowledged] } });
  await done;
  const required = [...new Set(requiredPeerIds.filter(id => typeof id === "string" && id))];
  return required.includes(peerId) && required.every(id => acknowledged.has(id));
}


export async function markPreviousMessageEncryptionIdentityForDeletion(keyId) {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const meta = tx.objectStore("meta");
  const record = await requestValue(meta.get("message_encryption_previous_identity"));
  if (record?.value?.key_id === keyId && !record.value.peer_switched_at) {
    meta.put({ key: "message_encryption_previous_identity", value: { ...record.value, peer_switched_at: Date.now() } });
  }
  await done;
  return record?.value?.key_id === keyId;
}

export async function clearPreviousMessageEncryptionIdentity(keyId) {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const meta = tx.objectStore("meta");
  const record = await requestValue(meta.get("message_encryption_previous_identity"));
  if (record?.value?.key_id === keyId) meta.delete("message_encryption_previous_identity");
  await done;
  return record?.value?.key_id === keyId;
}

export async function saveContact(contact) {
  if (!contact || typeof contact !== "object" ||
      !contact.user_id || !contact.message_encryption_public_key || !contact.message_encryption_key_id ||
      !contact.invitation_secret || !contact.push_subscription_id || !contact.name) {
    throw new TypeError("A contact requires a local name, ECDH key, invitation secret, and push subscription ID.");
  }

  const record = {
    ...contact,
    name: String(contact.name).trim(),
    updated_at: new Date().toISOString()
  };
  if (!record.name) throw new TypeError("Contact name cannot be empty.");

  const db = await openDatabase();
  const tx = db.transaction("contacts", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("contacts").put(record);
  await done;
  return record;
}

export async function listContacts() {
  const db = await openDatabase();
  const tx = db.transaction("contacts", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("contacts").getAll());
  await done;
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getContact(userId) {
  const db = await openDatabase();
  const tx = db.transaction("contacts", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("contacts").get(userId));
  await done;
  return record || null;
}

export async function updateContact(userId, updates) {
  if (!userId || !updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new TypeError("A contact ID and an updates object are required.");
  }
  if (Object.hasOwn(updates, "user_id")) {
    throw new TypeError("A contact user_id cannot be changed; save a newly verified identity instead.");
  }

  const db = await openDatabase();
  const tx = db.transaction("contacts", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("contacts");
  const existing = await requestValue(store.get(userId));
  if (!existing) {
    tx.abort();
    try { await done; } catch {}
    return null;
  }

  const updated = {
    ...existing,
    ...updates,
    user_id: existing.user_id,
    updated_at: new Date().toISOString()
  };
  if (typeof updated.name !== "string" || !updated.name.trim()) {
    tx.abort();
    try { await done; } catch {}
    throw new TypeError("Contact name cannot be empty.");
  }
  updated.name = updated.name.trim();
  store.put(updated);
  await done;
  return updated;
}

export async function deleteContact(userId) {
  const db = await openDatabase();
  const tx = db.transaction(["contacts", "conversation"], "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("contacts").delete(userId);
  const conversationStore = tx.objectStore("conversation");
  const request = conversationStore.index("contact_user_id").getAll(IDBKeyRange.only(userId));
  request.onsuccess = () => {
    for (const event of request.result) conversationStore.delete(event.id);
  };
  await done;
}


export async function addConversationEvent(event) {
  if (!event || typeof event !== "object" ||
      typeof event.id !== "string" || !event.id ||
      typeof event.contact_user_id !== "string" || !/^[a-f0-9]{64}$/.test(event.contact_user_id) ||
      !["hello", "request", "answer", "reject", "text"].includes(event.type) ||
      !["incoming", "outgoing"].includes(event.direction) ||
      !Number.isFinite(Date.parse(event.created_at))) {
    throw new TypeError("A conversation event requires a contact, type, direction, and valid timestamp.");
  }
  const text = event.type === "text" ? String(event.text || "").trim() : "";
  if (event.type === "text" && (!text || text.length > 2000)) {
    throw new TypeError("A text message must contain between 1 and 2000 characters.");
  }
  const record = {
    id: event.id, contact_user_id: event.contact_user_id, type: event.type,
    direction: event.direction, text, created_at: new Date(event.created_at).toISOString()
  };
  const db = await openDatabase();
  const tx = db.transaction("conversation", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("conversation");
  const request = store.index("contact_user_id").getAll(IDBKeyRange.only(record.contact_user_id));
  request.onsuccess = () => {
    const records = request.result.filter(item => item.id !== record.id);
    records.push(record);
    records.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const retained = records.slice(-100);
    const retainedIds = new Set(retained.map(item => item.id));
    for (const oldRecord of request.result) if (!retainedIds.has(oldRecord.id)) store.delete(oldRecord.id);
    if (retainedIds.has(record.id)) store.put(record);
  };
  await done;
  return record;
}

export async function listConversationEvents(contactUserId) {
  if (typeof contactUserId !== "string" || !/^[a-f0-9]{64}$/.test(contactUserId)) {
    throw new TypeError("A valid contact ID is required.");
  }
  const db = await openDatabase();
  const tx = db.transaction("conversation", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(
    tx.objectStore("conversation").index("contact_user_id").getAll(IDBKeyRange.only(contactUserId))
  );
  await done;
  return records.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(-100);
}

export async function addCallHistoryEntry(entry) {
  if (!entry || !entry.outcome || !entry.created_at || !Number.isFinite(Date.parse(entry.created_at))) {
    throw new TypeError("A call-history entry requires an outcome and a valid created_at timestamp.");
  }

  const record = {
    id: entry.id || crypto.randomUUID(),
    contact_user_id: entry.contact_user_id || null,
    contact_name: String(entry.contact_name || "Unknown contact"),
    outcome: String(entry.outcome),
    created_at: entry.created_at
  };

  const db = await openDatabase();
  const tx = db.transaction("history", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("history");
  const getAll = store.getAll();

  getAll.onsuccess = () => {
    const records = [...getAll.result, record]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const retainedIds = new Set(records.slice(0, HISTORY_LIMIT).map(item => item.id));
    if (retainedIds.has(record.id)) store.put(record);
    for (const oldRecord of records) {
      if (!retainedIds.has(oldRecord.id)) store.delete(oldRecord.id);
    }
  };

  await done;
  return record;
}

export async function listCallHistory() {
  const db = await openDatabase();
  const tx = db.transaction("history", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("history").getAll());
  await done;
  return records
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, HISTORY_LIMIT);
}

export async function clearCallHistory() {
  const db = await openDatabase();
  const tx = db.transaction("history", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("history").clear();
  await done;
}
