const DB_NAME = "voicelink-local";
const DB_VERSION = 1;
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

  {
    const tx = db.transaction("meta", "readonly");
    const done = transactionDone(tx);
    const record = await requestValue(tx.objectStore("meta").get("identity"));
    await done;
    if (record?.value?.privateKey && record.value.user_id && record.value.public_key) {
      return record.value;
    }
  }

  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser does not support the Web Crypto API.");
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const publicBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const fingerprint = await crypto.subtle.digest("SHA-256", publicBytes);
  const identity = {
    user_id: toHex(fingerprint),
    public_key: toBase64Url(publicBytes),
    privateKey: keyPair.privateKey,
    created_at: new Date().toISOString()
  };

  // Re-check in a read/write transaction so simultaneous first-run tabs
  // do not overwrite an identity that another tab has just saved.
  const tx = db.transaction("meta", "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore("meta");
  const existing = await requestValue(store.get("identity"));
  if (existing?.value?.privateKey && existing.value.user_id && existing.value.public_key) {
    await done;
    return existing.value;
  }
  store.put({ key: "identity", value: identity });
  await done;
  return identity;
}

export async function signWithIdentity(payload) {
  const identity = await getOrCreateIdentity();
  const data = new TextEncoder().encode(
    typeof payload === "string" ? payload : JSON.stringify(payload)
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    identity.privateKey,
    data
  );
  return toBase64Url(signature);
}

export async function saveContact(contact) {
  if (!contact || typeof contact !== "object" ||
      !contact.user_id || !contact.public_key || !contact.push_subscription_id ||
      !contact.name) {
    throw new TypeError("A contact requires a local name, user_id, public_key, and push_subscription_id.");
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

export async function deleteContact(userId) {
  const db = await openDatabase();
  const tx = db.transaction("contacts", "readwrite");
  const done = transactionDone(tx);
  tx.objectStore("contacts").delete(userId);
  await done;
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
