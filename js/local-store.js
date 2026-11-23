const DB_NAME = "voicelink-local";
const DB_VERSION = 5;
const HISTORY_LIMIT = 10;

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;

  let openingPromise;
  openingPromise = new Promise((resolve, reject) => {
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
      if (!db.objectStoreNames.contains("supabase_outbox")) {
        const outbox = db.createObjectStore("supabase_outbox", { keyPath: "id" });
        outbox.createIndex("peer_id", "peer_id");
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // A browser may close an idle connection (or another tab may request
      // a schema upgrade). Never keep a closed connection in the shared cache.
      const invalidateConnection = () => {
        if (databasePromise === openingPromise) databasePromise = null;
      };
      db.onclose = invalidateConnection;
      db.onversionchange = () => {
        db.close();
        invalidateConnection();
      };
      resolve(db);
    };
    request.onerror = () => {
      if (databasePromise === openingPromise) databasePromise = null;
      reject(request.error || new Error("Could not open local storage."));
    };
    request.onblocked = () => {
      if (databasePromise === openingPromise) databasePromise = null;
      reject(new Error("Local storage upgrade is blocked by another open tab."));
    };
  });

  databasePromise = openingPromise;
  return openingPromise;
}

async function openTransaction(storeNames, mode) {
  // A close/versionchange can land between awaiting openDatabase() and
  // creating the transaction. Retry once with a fresh connection.
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await openDatabase();
    try {
      return db.transaction(storeNames, mode);
    } catch (error) {
      if (error?.name !== "InvalidStateError") throw error;
      lastError = error;
      databasePromise = null;
    }
  }
  throw lastError || new Error("IndexedDB connection is unavailable.");
}


export async function createIssuedInvitation({ id, secret, created_at = Date.now(), max_activations = 1, local_contact_name = "" }) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) ||
      typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
      !Number.isFinite(Number(created_at)) || !Number.isInteger(max_activations) || max_activations < 1 ||
      typeof local_contact_name !== "string") {
    throw new TypeError("A valid invitation ID, 256-bit secret, creation time, activation limit, and local contact name are required.");
  }
  const tx = await openTransaction("invitations", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("invitations").add({
    id, secret, created_at: Number(created_at), max_activations,
    local_contact_name: local_contact_name.trim().slice(0, 60),
    activations: [], revoked: false
  });
  await done;
}

export async function updateIssuedInvitationLocalName(invitationId, localContactName = "") {
  if (typeof invitationId !== "string" || !/^[0-9a-f-]{36}$/i.test(invitationId) ||
      typeof localContactName !== "string") {
    throw new TypeError("A valid invitation ID and local contact name are required.");
  }
  const tx = await openTransaction("invitations", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("invitations");
  const invitation = await requestValue(store.get(invitationId));
  if (!invitation) {
    tx.abort();
    try { await done; } catch {}
    return null;
  }
  if (localContactName.trim()) invitation.local_contact_name = localContactName.trim().slice(0, 60);
   else delete invitation.local_contact_name;
  store.put(invitation);
  await done;
  return invitation;
}

export async function getIssuedInvitation(invitationId) {
  if (typeof invitationId !== "string" || !/^[0-9a-f-]{36}$/i.test(invitationId)) return null;
  const tx = await openTransaction("invitations", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("invitations").get(invitationId));
  await done;
  return record || null;
}

export async function deleteUnusedIssuedInvitation(invitationId) {
  if (typeof invitationId !== "string" || !/^[0-9a-f-]{36}$/i.test(invitationId)) return false;
  const tx = await openTransaction("invitations", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("invitations");
  const invitation = await requestValue(store.get(invitationId));
  if (invitation && !(Array.isArray(invitation.activations) && invitation.activations.length)) {
    store.delete(invitationId);
  }
  await done;
  return !!invitation && !(Array.isArray(invitation.activations) && invitation.activations.length);
}

export async function listIssuedInvitations() {
  const tx = await openTransaction("invitations", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("invitations").getAll());
  await done;
  return Array.isArray(records) ? records : [];
}

export async function consumeIssuedInvitation({ invitationId, userId, requestId }) {
  if (typeof invitationId !== "string" || !/^[0-9a-f-]{36}$/i.test(invitationId) ||
      typeof userId !== "string" || !/^[a-f0-9]{64}$/.test(userId) ||
      typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) return { accepted: false, reason: "invalid" };
  const tx = await openTransaction("invitations", "readwrite");
  return new Promise((resolve, reject) => {
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
  const tx = await openTransaction("invitations", "readonly");
  const done = transactionDone(tx);
  const invitation = await requestValue(tx.objectStore("invitations").get(invitationId));
  await done;
  return !!invitation && !invitation.revoked && Array.isArray(invitation.activations) &&
    invitation.activations.some(item => item.user_id === userId);
}

export async function getNtfyCursor(userId) {
  if (typeof userId !== "string" || !/^[a-f0-9]{64}$/.test(userId)) {
    throw new TypeError("A valid local identity is required for the ntfy cursor.");
  }
  const tx = await openTransaction("meta", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("meta").get("ntfy_cursor:" + userId));
  await done;
  return typeof record?.value === "string" ? record.value : null;
}

export async function saveNtfyCursor(userId, messageId) {
  if (typeof userId !== "string" || !/^[a-f0-9]{64}$/.test(userId) ||
      typeof messageId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(messageId)) {
    throw new TypeError("A valid local identity and ntfy message ID are required.");
  }
  const tx = await openTransaction("meta", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("meta").put({ key: "ntfy_cursor:" + userId, value: messageId, updated_at: Date.now() });
  await done;
  return messageId;
}

export async function saveMyInvitation(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new TypeError("A valid HTTPS invitation URL is required.");
  }
  const tx = await openTransaction("meta", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("meta").put({
    key: "my_invitation",
    value: { url, updated_at: new Date().toISOString() }
  });
  await done;
}

export async function getMyInvitation() {
  const tx = await openTransaction("meta", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("meta").get("my_invitation"));
  await done;
  return record?.value?.url || "";
}

export async function clearMyInvitation(expectedUrl = "") {
  if (typeof expectedUrl !== "string") throw new TypeError("Expected invitation URL must be a string.");
  const tx = await openTransaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  const record = await requestValue(store.get("my_invitation"));
  const matches = !expectedUrl || record?.value?.url === expectedUrl;
  if (matches && record) store.delete("my_invitation");
  await done;
  return !!(matches && record);
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

// TEMPORARY COMPATIBILITY MIGRATION (remove only after legacy installations are no longer supported).
// Older installations stored one ECDSA public identity key per participant.
// For each saved legacy contact, both devices derive the same shared secret
// and the same pair invitation ID from the two exchanged public identities.
const LEGACY_SHARED_SECRET_MIGRATION = "legacy_public_key_shared_secret_v3";

function decodeLegacyPublicKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Legacy public key is missing or malformed.");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function deriveLegacySharedSecret(identity, contact) {
  if (!identity || !contact ||
      !/^[a-f0-9]{64}$/.test(identity.user_id || "") ||
      !/^[a-f0-9]{64}$/.test(contact.user_id || "")) {
    throw new Error("Legacy participant IDs are invalid.");
  }
  const localBytes = decodeLegacyPublicKey(identity.public_key);
  const peerBytes = decodeLegacyPublicKey(contact.public_key);
  if (toHex(await crypto.subtle.digest("SHA-256", localBytes)) !== identity.user_id ||
      toHex(await crypto.subtle.digest("SHA-256", peerBytes)) !== contact.user_id) {
    throw new Error("Legacy public key fingerprint does not match user_id.");
  }
  const pair = [
    { user_id: identity.user_id, public_key: identity.public_key },
    { user_id: contact.user_id, public_key: contact.public_key }
  ].sort((a, b) => a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0);
  const canonical = "voicelink-legacy-pair-secret-v1|" +
    pair.map(item => item.user_id + ":" + item.public_key).join("|");
  return toBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
}

// The oldest contacts predate invitation IDs. Use one symmetric pair ID,
// rather than depending on which side originally created an invitation.
async function deriveLegacyInvitationId(firstUserId, secondUserId) {
  const pair = [firstUserId, secondUserId].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const input = "voicelink-legacy-invitation-id-v1|" + pair.join("|");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = toHex(hash.slice(0, 16));
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) +
    "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
}

async function migrateLegacyPublicKeyContacts(storedIdentity, storedContacts) {
  let identity = storedIdentity;
  if (!identity?.user_id || !/^[a-f0-9]{64}$/.test(identity.user_id)) {
    const random = crypto.getRandomValues(new Uint8Array(32));
    identity = {
      version: 3,
      user_id: toHex(await crypto.subtle.digest("SHA-256", random)),
      created_at: new Date().toISOString()
    };
    random.fill(0);
  } else {
    // Keep the existing user_id and ECDSA identity material. Changing user_id
    // would change the ntfy topic and disconnect every existing contact.
    identity = { ...identity, version: 3 };
  }

  const migratedContacts = [];
  const migratedInvitations = [];
  for (const contact of Array.isArray(storedContacts) ? storedContacts : []) {
    // New v3 contacts already carry a random invitation secret and have no
    // legacy ECDSA public_key field. Do not alter those records.
    if (typeof contact.public_key !== "string") continue;
    try {
      const secret = await deriveLegacySharedSecret(identity, contact);
      const invitationId = await deriveLegacyInvitationId(identity.user_id, contact.user_id);
      const migrated = {
        ...contact,
        invitation_id: invitationId,
        invitation_secret: secret,
        shared_secret_created_at: Number(contact.shared_secret_created_at) || Date.now()
      };
      migratedContacts.push(migrated);

      // Each device creates the same local grant for this trusted pair.
      // This also upgrades contacts from versions that had no invitations store.
      migratedInvitations.push({
        id: invitationId,
        secret,
        created_at: Date.now(),
        max_activations: 1,
        activations: [{
          user_id: contact.user_id,
          request_id: crypto.randomUUID(),
          activated_at: Date.now(),
          status: "active"
        }],
        revoked: false
      });
    } catch {
      // Keep incomplete contacts and their history intact. They can be paired
      // again by importing a fresh invitation; never invent a secret for them.
    }
  }

  const tx = await openTransaction(["meta", "contacts", "invitations"], "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("meta").put({ key: "identity", value: identity });
  // The saved pre-v3 invitation URL has an obsolete package format; a fresh
  // v3 invitation is generated when push permission is available.
  tx.objectStore("meta").delete("my_invitation");
  for (const contact of migratedContacts) tx.objectStore("contacts").put(contact);

  const invitationStore = tx.objectStore("invitations");
  for (const invitation of migratedInvitations) {
    const request = invitationStore.get(invitation.id);
    request.onsuccess = () => {
      const existing = request.result;
      if (existing?.revoked) return;
      const activations = Array.isArray(existing?.activations) ? [...existing.activations] : [];
      if (!activations.some(item => item.user_id === invitation.activations[0].user_id)) {
        activations.push(invitation.activations[0]);
      }
      invitationStore.put({
        ...existing,
        ...invitation,
        created_at: Number(existing?.created_at) || invitation.created_at,
        activations
      });
    };
  }
  tx.objectStore("meta").put({
    key: LEGACY_SHARED_SECRET_MIGRATION,
    value: {
      version: 3,
      completed_at: new Date().toISOString(),
      migrated_contacts: migratedContacts.length,
      migrated_invitations: migratedInvitations.length
    }
  });
  await done;
  return identity;
}

export async function getOrCreateIdentity() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser does not support the Web Crypto API.");
  }
  const tx = await openTransaction(["meta", "contacts", "invitations"], "readonly");
  const done = transactionDone(tx);
  const [identityRecord, migrationRecord, contacts] = await Promise.all([
    requestValue(tx.objectStore("meta").get("identity")),
    requestValue(tx.objectStore("meta").get(LEGACY_SHARED_SECRET_MIGRATION)),
    requestValue(tx.objectStore("contacts").getAll())
  ]);
  await done;

  if (identityRecord?.value?.version === 3 &&
      migrationRecord?.value?.version === 3 &&
      identityRecord.value.user_id) {
    return identityRecord.value;
  }
  return migrateLegacyPublicKeyContacts(
    identityRecord?.value || null,
    contacts
  );
}

export async function saveContact(contact) {
  if (!contact || typeof contact !== "object" ||
      typeof contact.user_id !== "string" || !/^[a-f0-9]{64}$/.test(contact.user_id) ||
      typeof contact.invitation_id !== "string" || !/^[0-9a-f-]{36}$/i.test(contact.invitation_id) ||
      typeof contact.invitation_secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(contact.invitation_secret) ||
      (contact.supabase_user_id != null && (typeof contact.supabase_user_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contact.supabase_user_id)) ) ||
      (contact.supabase_invitation_id != null && (typeof contact.supabase_invitation_id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(contact.supabase_invitation_id)) ) ||
      (contact.push_subscription_id != null && (typeof contact.push_subscription_id !== "string" || !contact.push_subscription_id.trim())) || !contact.name)
    throw new TypeError("A contact requires a local name, shared 256-bit secret, and invitation ID; push subscription ID is optional.");
  const record={...contact,name:String(contact.name).trim(),updated_at:new Date().toISOString()};
  if(!record.name)throw new TypeError("Contact name cannot be empty.");
  const tx=await openTransaction("contacts","readwrite"),done=transactionDone(tx);
  tx.objectStore("contacts").put(record);await done;return record;
}

export async function listContacts() {
  const tx = await openTransaction("contacts", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("contacts").getAll());
  await done;
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getContact(userId) {
  const tx = await openTransaction("contacts", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("contacts").get(userId));
  await done;
  return record || null;
}

/** Resolve a saved local contact from its independent Supabase Auth routing UUID. */
export async function findContactBySupabaseUserId(supabaseUserId) {
  if (typeof supabaseUserId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supabaseUserId)) return null;
  const tx = await openTransaction("contacts", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("contacts").getAll());
  await done;
  return records.find(record => record.supabase_user_id === supabaseUserId.toLowerCase()) || null;
}

export async function updateContact(userId, updates) {
  if (!userId || !updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new TypeError("A contact ID and an updates object are required.");
  }
  if (Object.hasOwn(updates, "user_id")) {
    throw new TypeError("A contact user_id cannot be changed; save a newly verified identity instead.");
  }

  const tx = await openTransaction("contacts", "readwrite");
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
  const tx = await openTransaction(["contacts", "conversation"], "readwrite");
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
    direction: event.direction, text, created_at: new Date(event.created_at).toISOString(),
    ...(event.type === "text" && event.direction === "outgoing"
      ? { delivery_status: ["sending", "sent", "delivered"].includes(event.delivery_status) ? event.delivery_status : "sent" }
      : {})
  };
  const tx = await openTransaction("conversation", "readwrite");
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

export async function updateConversationMessageDeliveryStatus(contactUserId, messageId, status, updatedAt = new Date().toISOString()) {
  if (typeof contactUserId !== "string" || !/^[a-f0-9]{64}$/.test(contactUserId) ||
      typeof messageId !== "string" || !messageId || !["sent", "delivered"].includes(status) ||
      !Number.isFinite(Date.parse(updatedAt))) {
    throw new TypeError("A valid contact, message ID, delivery status, and timestamp are required.");
  }
  const tx = await openTransaction("conversation", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("conversation");
  const record = await requestValue(store.get(messageId));
  if (record && record.contact_user_id === contactUserId && record.type === "text" && record.direction === "outgoing") {
    if (status === "delivered" || record.delivery_status !== "delivered") {
      record.delivery_status = status;
      if (status === "delivered") record.delivered_at = new Date(updatedAt).toISOString();
      else record.sent_at = new Date(updatedAt).toISOString();
      store.put(record);
    }
  }
  await done;
  return !!record;
}

export async function markConversationMessageDelivered(contactUserId, messageId, deliveredAt = new Date().toISOString()) {
  return updateConversationMessageDeliveryStatus(contactUserId, messageId, "delivered", deliveredAt);
}

export async function listConversationEvents(contactUserId) {
  if (typeof contactUserId !== "string" || !/^[a-f0-9]{64}$/.test(contactUserId)) {
    throw new TypeError("A valid contact ID is required.");
  }
  const tx = await openTransaction("conversation", "readonly");
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

  const tx = await openTransaction("history", "readwrite");
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
  const tx = await openTransaction("history", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("history").getAll());
  await done;
  return records
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, HISTORY_LIMIT);
}

export async function clearCallHistory() {
  const tx = await openTransaction("history", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("history").clear();
  await done;
}

const SUPABASE_UUID_SEQUENCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPABASE_MAX_SEQUENCE = 18446744073709551615n;

function validateSupabasePeerId(peerId) {
  if (typeof peerId !== "string" || !SUPABASE_UUID_SEQUENCE_RE.test(peerId)) {
    throw new TypeError("A valid Supabase peer UUID is required.");
  }
  return peerId.toLowerCase();
}

function validateSupabaseSequence(value) {
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,19})$/.test(text) || BigInt(text) > SUPABASE_MAX_SEQUENCE) {
    throw new TypeError("Supabase sequence is outside uint64 range.");
  }
  return text;
}

/** Atomically reserve a sequence and persist its message body before encryption. */
export async function enqueueSupabaseOutboxMessage(peerId, type, body, dedupeKey = null) {
  const peer = validateSupabasePeerId(peerId);
  if (typeof type !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(type) ||
      !body || typeof body !== "object" || Array.isArray(body) ||
      (dedupeKey !== null && (typeof dedupeKey !== "string" || !dedupeKey || dedupeKey.length > 256))) {
    throw new TypeError("A valid Supabase message type, body and optional deduplication key are required.");
  }
  const bodyCopy = JSON.parse(JSON.stringify(body));
  const tx = await openTransaction(["meta", "supabase_outbox"], "readwrite");
  const done = transactionDone(tx);
  const meta = tx.objectStore("meta");
  const outbox = tx.objectStore("supabase_outbox");
  let queued = null;
  const existingRequest = outbox.index("peer_id").getAll(peer);
  existingRequest.onsuccess = () => {
    const existing = Array.isArray(existingRequest.result) ? existingRequest.result : [];
    const duplicate = dedupeKey ? existing.find(item => item.dedupe_key === dedupeKey) : null;
    if (duplicate) { queued = duplicate; return; }
    const request = meta.get("supabase_sequence:" + peer);
    request.onsuccess = () => {
      const state = request.result || { key: "supabase_sequence:" + peer, outgoing: "0", incoming: "0" };
      const current = BigInt(validateSupabaseSequence(state.outgoing ?? "0"));
      if (current >= SUPABASE_MAX_SEQUENCE) { tx.abort(); return; }
      const sequence = (current + 1n).toString();
      const id = peer + ":" + sequence;
      state.outgoing = sequence;
      state.incoming = validateSupabaseSequence(state.incoming ?? "0");
      state.updated_at = Date.now();
      meta.put(state);
      queued = { id, peer_id: peer, sequence, type, body: bodyCopy, status: "preparing", created_at: Date.now(), ...(dedupeKey ? { dedupe_key: dedupeKey } : {}) };
      outbox.add(queued);
    };
  };
  await done;
  if (!queued) throw new Error("Could not reserve and persist the Supabase outgoing message.");
  return queued;
}

/** Read pending messages in numeric sequence order for one recipient. */
export async function listSupabaseOutboxMessages(peerId) {
  const peer = validateSupabasePeerId(peerId);
  const tx = await openTransaction("supabase_outbox", "readonly");
  const done = transactionDone(tx);
  const records = await requestValue(tx.objectStore("supabase_outbox").index("peer_id").getAll(peer));
  await done;
  return (Array.isArray(records) ? records : []).sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0
  );
}

/** Save the stable encrypted envelope; plaintext body is no longer needed. */
export async function saveSupabaseOutboxEnvelope(messageId, payload) {
  if (typeof messageId !== "string" || !payload || typeof payload !== "object" ||
      Array.isArray(payload) || payload.v !== 1 || typeof payload.data !== "string") {
    throw new TypeError("A valid outbox message ID and encrypted Supabase envelope are required.");
  }
  const tx = await openTransaction("supabase_outbox", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("supabase_outbox");
  const record = await requestValue(store.get(messageId));
  if (!record) { tx.abort(); try { await done; } catch {} throw new Error("Supabase outbox reservation no longer exists."); }
  record.payload = payload;
  delete record.body;
  record.status = "pending";
  record.encrypted_at = Date.now();
  store.put(record);
  await done;
  return record;
}

/** Remove a message only after submit_message confirms it was accepted. */
export async function deleteSupabaseOutboxMessage(messageId) {
  if (typeof messageId !== "string" || !messageId) return false;
  const tx = await openTransaction("supabase_outbox", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("supabase_outbox");
  const exists = await requestValue(store.getKey(messageId));
  if (exists !== undefined) store.delete(messageId);
  await done;
  return exists !== undefined;
}

/** Read durable per-peer counters. Counters are strings to preserve uint64 precision. */
export async function getSupabaseSequenceState(peerId) {
  const peer = validateSupabasePeerId(peerId);
  const tx = await openTransaction("meta", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("meta").get("supabase_sequence:" + peer));
  await done;
  return {
    outgoing: validateSupabaseSequence(record?.outgoing ?? "0"),
    incoming: validateSupabaseSequence(record?.incoming ?? "0")
  };
}

/** Reserve the next outgoing number atomically across tabs sharing this IndexedDB. */
export async function allocateSupabaseOutgoingSequence(peerId) {
  const peer = validateSupabasePeerId(peerId);
  const tx = await openTransaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  let allocated = null;
  const request = store.get("supabase_sequence:" + peer);
  request.onsuccess = () => {
    const record = request.result || { key: "supabase_sequence:" + peer, outgoing: "0", incoming: "0" };
    const current = BigInt(validateSupabaseSequence(record.outgoing ?? "0"));
    if (current >= SUPABASE_MAX_SEQUENCE) {
      tx.abort();
      return;
    }
    allocated = (current + 1n).toString();
    record.outgoing = allocated;
    record.incoming = validateSupabaseSequence(record.incoming ?? "0");
    record.updated_at = Date.now();
    store.put(record);
  };
  await done;
  if (allocated === null) throw new Error("Could not reserve a Supabase outgoing sequence.");
  return allocated;
}

/** Persist a known first outgoing sequence after the one-time contact acceptance. */
export async function ensureSupabaseOutgoingSequence(peerId, minimumValue) {
  const peer = validateSupabasePeerId(peerId);
  const minimum = validateSupabaseSequence(minimumValue);
  const tx = await openTransaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  const request = store.get("supabase_sequence:" + peer);
  request.onsuccess = () => {
    const record = request.result || { key: "supabase_sequence:" + peer, outgoing: "0", incoming: "0" };
    if (BigInt(validateSupabaseSequence(record.outgoing ?? "0")) < BigInt(minimum)) record.outgoing = minimum;
    record.incoming = validateSupabaseSequence(record.incoming ?? "0");
    record.updated_at = Date.now();
    store.put(record);
  };
  await done;
  return minimum;
}

/** Advance incoming state only when the next expected sequence was processed. */
export async function advanceSupabaseIncomingSequence(peerId, sequenceValue) {
  const peer = validateSupabasePeerId(peerId);
  const sequence = validateSupabaseSequence(sequenceValue);
  if (sequence === "0") throw new TypeError("Incoming sequence must start at one.");
  const target = BigInt(sequence);
  const tx = await openTransaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  let result = "gap";
  const request = store.get("supabase_sequence:" + peer);
  request.onsuccess = () => {
    const record = request.result || { key: "supabase_sequence:" + peer, outgoing: "0", incoming: "0" };
    const current = BigInt(validateSupabaseSequence(record.incoming ?? "0"));
    if (target <= current) result = "duplicate";
    else if (target === current + 1n) {
      record.incoming = sequence;
      record.outgoing = validateSupabaseSequence(record.outgoing ?? "0");
      record.updated_at = Date.now();
      store.put(record);
      result = "advanced";
    }
  };
  await done;
  return result;
}



const SUPABASE_INBOX_CURSOR_RE = /^(0|[1-9][0-9]*)$/;

/** Read the last durably scanned global message_id for this local inbox. */
export async function getSupabaseInboxCursor(userId) {
  const peer = validateSupabasePeerId(userId);
  const tx = await openTransaction("meta", "readonly");
  const done = transactionDone(tx);
  const record = await requestValue(tx.objectStore("meta").get("supabase_inbox_cursor:" + peer));
  await done;
  const value = String(record?.message_id ?? "0");
  if (!SUPABASE_INBOX_CURSOR_RE.test(value)) {
    throw new Error("Stored Supabase inbox cursor is invalid.");
  }
  return value;
}

/** Persist a monotonically increasing inbox cursor after a row was processed. */
export async function setSupabaseInboxCursor(userId, messageIdValue) {
  const peer = validateSupabasePeerId(userId);
  const messageId = String(messageIdValue);
  if (!SUPABASE_INBOX_CURSOR_RE.test(messageId)) {
    throw new TypeError("A valid global Supabase message_id is required.");
  }
  const tx = await openTransaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  const key = "supabase_inbox_cursor:" + peer;
  const request = store.get(key);
  request.onsuccess = () => {
    const record = request.result || { key, message_id: "0" };
    if (BigInt(messageId) > BigInt(String(record.message_id ?? "0"))) {
      record.message_id = messageId;
      record.updated_at = Date.now();
      store.put(record);
    }
  };
  await done;
  return messageId;
}
