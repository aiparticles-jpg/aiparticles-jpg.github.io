import { performance } from "node:perf_hooks";

const role = process.argv[2] || "peer";
const offsetMs = Number(process.argv[3] || 0);
let driftPpm = Number(process.argv[4] || 0);
const origin = performance.now();

process.on("message", (message) => {
  if (message?.type === "set-drift") {
    driftPpm = Number(message.driftPpm);
    process.send?.({ type: "set-drift-result", id: message.id, role, driftPpm });
    return;
  }
  if (message?.type !== "clock-now") return;
  const elapsed = performance.now() - origin;
  const now = offsetMs + elapsed * (1 + driftPpm / 1_000_000);
  process.send?.({ type: "clock-now-result", id: message.id, role, now, driftPpm });
});
