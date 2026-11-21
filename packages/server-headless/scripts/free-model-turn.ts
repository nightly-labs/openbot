// free-model-turn: milestone 4 — one full agent turn through the REAL stack under Bun.
//
//   bun packages/server-headless/scripts/free-model-turn.ts
//
// Spawns the headless server on a fresh work dir, pins the first agent to
// opencode/deepseek-v4.1-flash-free (the OpenCode Zen free tier: no key, no account),
// logs in as the headless owner over the loopback team API, sends one message through
// POST /v1/agents/{id}/messages — the same route the mobile app uses — and polls the
// conversation until the model's reply lands. Reports boot, send→reply and memory.
// The turn touches the live free gateway; the deterministic part of milestone 4
// (the real ProviderCredentialStore round-trip) lives in quality-gates.ts gate 11.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";

const BUN = process.execPath;
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "packages", "server-headless", "src");
const WORK = "/tmp/opencode/headless-free-turn";
const USER_DATA = join(WORK, "user");
const CONTROL_DIR = WORK;
const SOCKET = join(CONTROL_DIR, "control.sock");
const FREE_MODEL = process.env.OPENBOT_HEADLESS_MODEL ?? "opencode/deepseek-v4.1-flash-free";
const PROVIDER = process.env.OPENBOT_HEADLESS_PROVIDER ?? "opencode";
const PROMPT =
  process.env.OPENBOT_HEADLESS_TURN_TEXT ??
  "Reply with exactly: headless bun turn ok. Do not use any tools.";

rmSync(WORK, { recursive: true, force: true });
mkdirSync(USER_DATA, { recursive: true });
mkdirSync(CONTROL_DIR, { mode: 0o700, recursive: true });

const bootStart = Date.now();
const child = spawn(
  BUN,
  [join(SRC, "main.ts")],
  {
    env: {
      ...process.env,
      OPENBOT_HEADLESS_USER_DATA: USER_DATA,
      OPENBOT_HEADLESS_CONTROL_DIR: CONTROL_DIR,
      OPENBOT_HEADLESS_MODEL: FREE_MODEL,
      OPENBOT_HEADLESS_PROVIDER: PROVIDER,
    },
    stdio: ["ignore", "pipe", "pipe"],
  } as never,
);
let output = "";
child.stdout.on("data", (chunk: Buffer) => (output += chunk));
child.stderr.on("data", (chunk: Buffer) => (output += chunk));

function waitFor(pattern: RegExp, timeoutMs: number): Promise<string | null> {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const match = pattern.exec(output);
      if (match) {
        clearInterval(timer);
        resolve(match[1] ?? "");
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 150);
  });
}

const modelLine = await waitFor(/^model=(.+)$/m, 120_000);
if (!modelLine) {
  console.error("FAIL boot — the model pin never landed.\n" + output.slice(-2000));
  child.kill("SIGKILL");
  process.exit(1);
}
const bootMs = Date.now() - bootStart;

const port = await waitFor(/team api: http:\/\/localhost:(\d+)/, 5_000);
if (!port) {
  console.error("FAIL — the team API port never appeared.\n" + output.slice(-2000));
  child.kill("SIGKILL");
  process.exit(1);
}
const base = `http://localhost:${port}`;

const ownerPath = join(USER_DATA, "openbot-headless-owner.json");
if (!existsSync(ownerPath)) {
  console.error("FAIL — no owner credentials file.");
  child.kill("SIGKILL");
  process.exit(1);
}
const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { username: string; password: string };

async function call(
  method: string,
  path: string,
  body: unknown,
  token: string | null,
): Promise<{ status: number; json: any }> {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      // The same negotiation headers the packaged client sends (team-api-server.ts:2838).
      "openbot-protocol-version": "9",
      "openbot-app-version": "0.0.3-headless-cli",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

const login = await call("POST", "/v1/auth/login", owner, null);
if (login.status !== 200 || !login.json?.sessionToken) {
  console.error(`FAIL login — ${login.status} ${JSON.stringify(login.json).slice(0, 300)}`);
  child.kill("SIGKILL");
  process.exit(1);
}
const token = login.json.sessionToken as string;
const myMemberId = (login.json.member?.id ?? null) as string | null;

const listed = await call("GET", "/v1/agents", null, token);
const agents: Array<{ id: string; name?: string; model?: string }> = Array.isArray(listed.json)
  ? listed.json
  : (listed.json?.agents ?? []);
const agent = agents.find((candidate) => candidate.id) ?? null;
if (!agent) {
  console.error(`FAIL — no agent listed (${listed.status}): ${JSON.stringify(listed.json).slice(0, 300)}`);
  child.kill("SIGKILL");
  process.exit(1);
}

function threadMessages(value: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  // Agent thread messages carry {author: "user"|"assistant", id, ...}; the direct-chat
  // shape carries senderMemberId — accept both, match by turn id below.
  if (Array.isArray(value)) {
    for (const item of value) threadMessages(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (("author" in record || "senderMemberId" in record) && "id" in record) out.push(record);
    for (const nested of Object.values(record)) threadMessages(nested, out);
  }
  return out;
}

const clientMessageId = randomUUID();
const sendStart = Date.now();
const receipt = await call(
  "POST",
  `/v1/agents/${agent.id}/messages`,
  { text: PROMPT, clientMessageId },
  token,
);
if (receipt.status !== 202 || !receipt.json?.messageId) {
  console.error(`FAIL send — ${receipt.status} ${JSON.stringify(receipt.json).slice(0, 300)}`);
  child.kill("SIGKILL");
  process.exit(1);
}
// The receipt messageId is the client idempotency id; the thread's turn id — what the
// assistant reply carries — is the delivery id (ipc-queue.ts QueuedMessageReceipt).
const turnId = (receipt.json.deliveries?.[0]?.id as string | undefined) ?? (receipt.json.messageId as string);

// Process tree memory: the Bun server plus its ACP (opencode) child, sampled while the
// turn runs so the idle-released ACP process is still alive at the measurement.
function pssOf(pid: number): number | null {
  try {
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    return Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0) / 1024;
  } catch {
    return null;
  }
}
function childPids(pid: number): number[] {
  const pids: number[] = [];
  try {
    for (const entry of readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/)) {
      const grand = Number(entry);
      if (grand) pids.push(grand, ...childPids(grand));
    }
  } catch {
    /* gone */
  }
  return pids;
}
// The ACP runtime spawns in its own process group (provider-process-group.ts), so the
// opencode child is not always a direct descendant: find it by command line instead.
function opencodePids(): number[] {
  const pids: number[] = [];
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
        if (cmdline.includes("provider-runtimes/opencode") && !cmdline.includes("main.ts")) pids.push(Number(entry));
      } catch {
        /* gone */
      }
    }
  } catch {
    /* gone */
  }
  return pids;
}

let replyText: string | null = null;
let firstReplyMs: number | null = null;
let acpChildren: number[] = [];
for (let elapsed = 0; elapsed < 180_000; elapsed = Date.now() - sendStart) {
  const children = [...new Set([...childPids(child.pid ?? 0), ...opencodePids()])].filter(
    (pid) => (pssOf(pid) ?? 0) > 20,
  );
  if (children.length > 0) acpChildren = children;
  const conversation = (await call("GET", `/v1/agents/${agent.id}/conversation`, null, token)).json;
  const reply = threadMessages(conversation).find(
    (message) =>
      message.author === "assistant" && (message.turnId === turnId || message.id === `${turnId}:assistant`),
  );
  if (reply) {
    firstReplyMs = Date.now() - sendStart;
    replyText = typeof reply.text === "string" ? reply.text : JSON.stringify(reply).slice(0, 200);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}

const serverPid = child.pid ?? 0;
const serverPss = pssOf(serverPid);
const acpPss = acpChildren.reduce((total, pid) => total + (pssOf(pid) ?? 0), 0);

console.log(`model=${modelLine}`);
console.log(`boot=${bootMs} ms (socket + agents ready + model pinned)`);
console.log(`login=ok member=${myMemberId} agents=${agents.length}`);
console.log(
  replyText === null
    ? "reply=NONE (timeout 180 s)"
    : `reply=${firstReplyMs} ms text="${(replyText ?? "").slice(0, 120).replace(/\n/g, " ")}"`,
);
console.log(
  `pss server=${serverPss?.toFixed(1) ?? "?"} MiB acp=${acpPss.toFixed(1)} MiB (${acpChildren.length} child)`,
);

const ok = replyText !== null;
child.kill("SIGTERM");
await new Promise((resolve) => child.on("exit", resolve));
writeFileSync(join(WORK, "turn.log"), output);
console.log(ok ? "TURN PASS" : "TURN FAIL");
process.exit(ok ? 0 : 1);
