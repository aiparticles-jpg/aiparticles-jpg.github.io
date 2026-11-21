#!/usr/bin/env node
/**
 * Stage B browser-store probe.
 * Runs from GitHub Actions (one runner / one egress IP).
 * It verifies HTTP API behavior, not browser CORS enforcement.
 */
import { randomBytes, createHash } from "node:crypto";

const results = [];
const timeoutMs = 20000;

function report(name, status, details = {}) {
  results.push({ name, status, ...details });
  console.log(JSON.stringify(results.at(-1)));
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 300); }
  return { response, body, text };
}

async function probeOneJSONFile() {
  const name = "OneJSONFile";
  let token;
  try {
    const created = await request("https://onejsonfile.com/api/v1/anonymous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!created.response.ok || !created.body?.token) {
      throw new Error(`create returned HTTP ${created.response.status}`);
    }
    token = created.body.token;
    console.log(`::add-mask::${token}`);
    const url = `https://onejsonfile.com/api/v1/files/${encodeURIComponent(token)}`;

    // 32 KiB binary payload, transported as base64 inside JSON.
    const bytes = randomBytes(32 * 1024);
    const expectedHash = createHash("sha256").update(bytes).digest("hex");
    const payload = { probe: "voicelink", binaryBase64: bytes.toString("base64"), expectedHash };

    const put = await request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!put.response.ok) throw new Error(`PUT returned HTTP ${put.response.status}`);

    const get = await request(url);
    if (!get.response.ok || get.body?.binaryBase64 !== payload.binaryBase64) {
      throw new Error(`GET mismatch / HTTP ${get.response.status}`);
    }
    const received = Buffer.from(get.body.binaryBase64, "base64");
    const actualHash = createHash("sha256").update(received).digest("hex");
    if (actualHash !== expectedHash) throw new Error("binary SHA-256 mismatch");

    const patch = await request(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver: { ack: true } }),
    });
    if (!patch.response.ok) throw new Error(`PATCH returned HTTP ${patch.response.status}`);

    const verify = await request(url);
    if (!verify.response.ok || verify.body?.receiver?.ack !== true) {
      throw new Error("PATCH verification failed");
    }

    const cors = await request(url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://aiparticles-jpg.github.io",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    const h = cors.response.headers;
    report(name, "PASS", {
      binaryBytes: bytes.length,
      sha256: actualHash,
      patch: "PASS",
      cors: {
        optionsStatus: cors.response.status,
        allowOrigin: h.get("access-control-allow-origin"),
        allowMethods: h.get("access-control-allow-methods"),
        allowHeaders: h.get("access-control-allow-headers"),
      },
      expiresAt: created.body.expiresAt ?? null,
    });

    await request(url, { method: "DELETE" }).catch(() => {});
  } catch (error) {
    report(name, "FAIL", { error: String(error).replace(token ?? /$^/, "[redacted]") });
    if (token) {
      await request(`https://onejsonfile.com/api/v1/files/${encodeURIComponent(token)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }
}

async function probeMantleDB() {
  const name = "MantleDB";
  const ns = `vl-probe-${randomBytes(8).toString("hex")}`;
  const path = `https://mantledb.sh/v2/${ns}/probe`;
  try {
    const bytes = randomBytes(24 * 1024);
    const expectedHash = createHash("sha256").update(bytes).digest("hex");
    const payload = { probe: "voicelink", binaryBase64: bytes.toString("base64"), expectedHash };

    const post = await request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!post.response.ok) throw new Error(`POST returned HTTP ${post.response.status}`);

    const get = await request(path, {
      headers: { Origin: "https://aiparticles-jpg.github.io" },
    });
    if (!get.response.ok || get.body?.binaryBase64 !== payload.binaryBase64) {
      throw new Error(`GET mismatch / HTTP ${get.response.status}`);
    }
    const actualHash = createHash("sha256")
      .update(Buffer.from(get.body.binaryBase64, "base64")).digest("hex");
    if (actualHash !== expectedHash) throw new Error("binary SHA-256 mismatch");

    const patch = await request(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver: { ack: true } }),
    });
    if (!patch.response.ok) throw new Error(`PATCH returned HTTP ${patch.response.status}`);

    const verify = await request(path);
    if (!verify.response.ok || verify.body?.receiver?.ack !== true) {
      throw new Error("PATCH verification failed");
    }

    const options = await request(path, {
      method: "OPTIONS",
      headers: {
        Origin: "https://aiparticles-jpg.github.io",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    const h = options.response.headers;
    report(name, "PASS", {
      binaryBytes: bytes.length,
      sha256: actualHash,
      patch: "PASS",
      cors: {
        optionsStatus: options.response.status,
        allowOrigin: h.get("access-control-allow-origin"),
        allowMethods: h.get("access-control-allow-methods"),
        allowHeaders: h.get("access-control-allow-headers"),
      },
      namespace: ns,
      cleanup: "not attempted: public unclaimed namespace has no documented delete route",
    });
  } catch (error) {
    report(name, "FAIL", { namespace: ns, error: String(error) });
  }
}

await probeOneJSONFile();
await probeMantleDB();

const failed = results.filter(r => r.status !== "PASS").length;
console.log(JSON.stringify({ summary: { passed: results.length - failed, failed, note: "Single GitHub Actions runner; not a two-client or browser-enforced CORS test." } }, null, 2));
if (failed) process.exitCode = 1;
