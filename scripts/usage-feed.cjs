// usage-feed.cjs — plan rings for providers OpenBot does not read itself, for the "All workflows"
// page and the rail. It polls the providers' own usage endpoints every 2 minutes and serves the
// readings on a loopback WebSocket, ws://127.0.0.1:47831 (the renderer CSP allows
// ws://127.0.0.1:*, not plain http). Read-only toward the providers, nothing written, no key on
// the wire or in the log. Runs outside the app: the user starts it, with their own credentials.
//   node scripts/usage-feed.cjs            serve (keep it running)
//   node scripts/usage-feed.cjs --once     one reading, print the payload, exit
// Sources:
//   - every `zai-coding-plan*` account in the OpenCode auth file (default
//     ~/.local/share/opencode/auth.json, override with USAGE_FEED_AUTH), named "Z.ai Plan 1..N"
//   - MiniMax, when MINIMAX_API_KEY is set (or present in the file USAGE_FEED_ENV points to)
// Payload, one JSON text per message and on connect:
//   { type: "usage", at, rows: [{ id, name, ok, error?, stale?,
//       windows: [{ durationMins, usedPercent, resetsAt }] }] }
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.USAGE_FEED_PORT) || 47831;
const EVERY_MS = 2 * 60 * 1000;
const ONCE = process.argv.includes("--once");
const AUTH_PATH = process.env.USAGE_FEED_AUTH || path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
const ZAI_SHAPE = /^zai-coding-plan/;

/** The OpenCode auth file holds one entry per provider account, `key` being the plan token. */
function zaiAccounts() {
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  } catch {
    return [];
  }
  return Object.keys(auth)
    .filter((id) => ZAI_SHAPE.test(id))
    .sort()
    .map((id, index) => ({ id, name: `Z.ai Plan ${index + 1}` }));
}

/** MiniMax key: the environment first, then a dotenv-style file, one `KEY=value` per line. */
function minimaxKey() {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY.trim();
  const file = process.env.USAGE_FEED_ENV;
  if (!file) return null;
  try {
    const match = /^MINIMAX_API_KEY=(.+)$/m.exec(fs.readFileSync(file, "utf8"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Z.ai: limits[] of TOKENS_LIMIT / CREDIT_LIMIT. unit 3 = hours, 6 = weeks (number = how many);
// `percentage` = used. TIME_LIMIT is the monthly MCP/search allowance, not the model quota, so it
// is left out.
const ZAI_UNIT_MINS = { 3: 60, 6: 7 * 24 * 60 };
async function readZai(account) {
  const { id, name } = account;
  const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  const key = auth[id]?.key || null;
  if (!key) return { id, name, ok: false, error: "no key", windows: [] };
  const body = await getJson("https://api.z.ai/api/monitor/usage/quota/limit", {
    Authorization: key,
    "Accept-Language": "en-US,en",
  });
  const windows = (body?.data?.limits || [])
    .filter((limit) => (limit.type === "TOKENS_LIMIT" || limit.type === "CREDIT_LIMIT") && ZAI_UNIT_MINS[limit.unit])
    .map((limit) => ({
      durationMins: ZAI_UNIT_MINS[limit.unit] * (limit.number || 1),
      usedPercent: Math.max(0, Math.min(100, Number(limit.percentage) || 0)),
      resetsAt: limit.nextResetTime ? Math.round(limit.nextResetTime / 1000) : null,
    }))
    .sort((a, b) => a.durationMins - b.durationMins);
  return { id, name, ok: windows.length > 0, error: windows.length ? undefined : "no quota windows", windows };
}

// MiniMax coding plan: model_remains[] — the "general" entry is the text-model quota (5 h interval
// plus a weekly window).
async function readMinimax() {
  const id = "minimax";
  const name = "MiniMax";
  const key = minimaxKey();
  if (!key) return { id, name, ok: false, error: "no key", windows: [] };
  const body = await getJson("https://api.minimax.io/v1/api/openplatform/coding_plan/remains", {
    Authorization: `Bearer ${key}`,
  });
  const entry =
    (body?.model_remains || []).find((item) => item.model_name === "general") || (body?.model_remains || [])[0];
  if (!entry) return { id, name, ok: false, error: "no model quota", windows: [] };
  const windows = [];
  if (typeof entry.current_interval_remaining_percent === "number") {
    windows.push({
      durationMins: Math.round((entry.end_time - entry.start_time) / 60000) || 300,
      usedPercent: 100 - entry.current_interval_remaining_percent,
      resetsAt: entry.end_time ? Math.round(entry.end_time / 1000) : null,
    });
  }
  if (typeof entry.current_weekly_remaining_percent === "number") {
    windows.push({
      durationMins: 7 * 24 * 60,
      usedPercent: 100 - entry.current_weekly_remaining_percent,
      resetsAt: entry.weekly_end_time ? Math.round(entry.weekly_end_time / 1000) : null,
    });
  }
  return { id, name, ok: windows.length > 0, error: windows.length ? undefined : "no windows", windows };
}

function sources() {
  const found = zaiAccounts().map((account) => ({ id: account.id, name: account.name, read: () => readZai(account) }));
  if (minimaxKey()) found.push({ id: "minimax", name: "MiniMax", read: readMinimax });
  return found;
}

let last = { type: "usage", at: 0, rows: [] };
async function refresh() {
  const rows = await Promise.all(
    sources().map(async (source) => {
      try {
        return await source.read();
      } catch (error) {
        // keep the last good reading of this source, marked stale, so one failed poll does not
        // blank the ring
        const previous = last.rows.find((row) => row.id === source.id && row.windows.length);
        return previous
          ? { ...previous, ok: true, stale: true }
          : {
              id: source.id,
              name: source.name,
              ok: false,
              error: String(error.message || error).slice(0, 80),
              windows: [],
            };
      }
    }),
  );
  last = { type: "usage", at: Date.now(), rows };
  return last;
}

(async () => {
  if (ONCE) {
    console.log(JSON.stringify(await refresh(), null, 1));
    return;
  }
  const server = new WebSocketServer({ host: "127.0.0.1", port: PORT });
  server.on("connection", (client) => {
    if (last.at) client.send(JSON.stringify(last));
    client.on("error", () => {});
  });
  server.on("error", (error) => {
    console.error("[usage-feed] server error:", error.code || error.message);
    process.exit(1);
  });
  const tick = async () => {
    const payload = JSON.stringify(await refresh());
    for (const client of server.clients) if (client.readyState === 1) client.send(payload);
    console.log(
      `[usage-feed] ${last.rows
        .map(
          (row) =>
            `${row.name}:${row.ok ? row.windows.map((w) => 100 - Math.round(w.usedPercent) + "%").join("/") : "ERR " + row.error}`,
        )
        .join(" · ")} → ${server.clients.size} client(s)`,
    );
  };
  await tick();
  setInterval(() => tick().catch((error) => console.error("[usage-feed] tick failed:", error.message)), EVERY_MS);
  console.log(`[usage-feed] ws://127.0.0.1:${PORT} — every ${EVERY_MS / 60000} min`);
})();
