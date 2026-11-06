#!/usr/bin/env node
// @ts-check
// Runs a task on an agent of the OpenBot app that runs on this computer, through the Local scripts
// API (docs/automation.md). It needs only Node 18 or later. It reads the URL and the token from the
// automation folder each time it runs and sends the token only in a request header, so the token is
// never in a command line, in the output or in a log.
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const USAGE = `Usage:
  openbot-cli list [--json]
  openbot-cli run <agent> <task|-> [--wait] [--timeout 30m] [--id <key>] [--json]
  openbot-cli handoff <agent> <task|-> --id <assignment> [--wait] [--timeout 30m] [--json]
  openbot-cli resume <assignment> [--wait] [--timeout 30m] [--json]
  openbot-cli status <agent> <deliveryId> [--wait] [--timeout 30m] [--json]
  openbot-cli agent set-account <agent> <accountId|default> [--json]
  openbot-cli agent set-model <agent> <model> [--effort <effort>] [--provider <provider>] [--json]
  openbot-cli agent new-chat <agent> [--json]

<agent> is an agent ID or an agent name. Only agents with Local scripts on are found.
A task of "-" is read from standard input.

Exit codes: 0 done, 1 the turn failed or OpenBot refused, 2 wrong command line,
3 the agent waits for a person, 4 timed out (the work continues), 5 OpenBot cannot be reached
or the agent was not found.

When OpenBot restarts during a wait, the CLI reads the new URL and token and continues.`;

const EXIT = { done: 0, failed: 1, usage: 2, needsPerson: 3, timedOut: 4, unreachable: 5 };
const POLL_MS = 2000;
// Leave room for a slow POST and its one connection retry before the server forgets the key.
const HANDOFF_RETRY_MS = (24 * 60 - 2) * 60_000;
const ENDED = new Set(["completed", "failed", "interrupted", "cancelled"]);

class CliError extends Error {
  /** @param {string} message @param {number} exitCode @param {boolean} [stale] */
  constructor(message, exitCode, stale = false) {
    super(message);
    this.exitCode = exitCode;
    /** True when the URL or the token can be old: OpenBot restarted, or Local scripts went off and on. */
    this.stale = stale;
  }
}

/** The automation folder: `OPENBOT_AUTOMATION_DIR`, or the folder of the installed app. */
function automationDir() {
  const override = process.env.OPENBOT_AUTOMATION_DIR;
  if (override) return override;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "OpenBot", "automation");
  if (process.platform === "win32")
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "OpenBot", "automation");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "OpenBot", "automation");
}

/** @returns {Promise<{ url: string, token: string }>} */
async function connection() {
  const dir = automationDir();
  try {
    const [url, token] = await Promise.all([readFile(join(dir, "url"), "utf8"), readFile(join(dir, "token"), "utf8")]);
    return { url: url.trim(), token: token.trim() };
  } catch {
    throw new CliError(
      `OpenBot is not running, or no agent has Local scripts on (no files in ${dir}).`,
      EXIT.unreachable,
    );
  }
}

/**
 * One request. When the URL or the token is old, it reads the automation folder again and tries one
 * more time. Each POST that the CLI sends can be repeated: a message has its retry key.
 * @param {{ url: string, token: string }} target
 * @param {"GET" | "POST"} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<any>}
 */
async function request(target, method, path, body) {
  try {
    return await requestOnce(target, method, path, body);
  } catch (error) {
    if (!(error instanceof CliError) || !error.stale) throw error;
    const fresh = await connection().catch(() => null);
    if (!fresh || (fresh.url === target.url && fresh.token === target.token)) throw error;
    Object.assign(target, fresh);
    return requestOnce(target, method, path, body);
  }
}

/**
 * @param {{ url: string, token: string }} target
 * @param {"GET" | "POST"} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<any>}
 */
async function requestOnce(target, method, path, body) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(target.url + path, {
      method,
      headers: {
        authorization: `Bearer ${target.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CliError(`OpenBot does not answer at ${target.url}.`, EXIT.unreachable, true);
  }
  const text = await response.text();
  let value = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    // An answer that is not JSON keeps its status as the reason below.
  }
  if (response.ok) return value;
  const reason = value && typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
  // 403 means that the agent has Local scripts off. A 404 after the agent was found is an unknown
  // delivery or an agent that was deleted since, so it is a refusal, not a missing app.
  if (response.status === 401) throw new CliError(reason, EXIT.unreachable, true);
  throw new CliError(reason, response.status === 403 ? EXIT.unreachable : EXIT.failed);
}

/**
 * The agent with this ID, or the one agent with this name (case is ignored).
 * @param {{ url: string, token: string }} target
 * @param {string} reference
 * @returns {Promise<{ id: string, name: string }>}
 */
async function findAgent(target, reference) {
  /** @type {Array<{ id: string, name: string }>} */
  const agents = await request(target, "GET", "/v1/agents");
  const byId = agents.find((agent) => agent.id === reference);
  if (byId) return byId;
  const wanted = reference.trim().toLocaleLowerCase();
  const named = agents.filter((agent) => agent.name.trim().toLocaleLowerCase() === wanted);
  if (named.length === 1 && named[0]) return named[0];
  if (named.length > 1)
    throw new CliError(`${named.length} agents are named "${reference}". Use the agent ID.`, EXIT.usage);
  throw new CliError(`No agent "${reference}" with Local scripts on. Run "openbot-cli list".`, EXIT.unreachable);
}

/** "90", "90s", "5m" or "2h" in milliseconds. @param {string} value */
function duration(value) {
  const match = /^(\d+)(s|m|h)?$/u.exec(value.trim());
  if (!match) throw new CliError(`"${value}" is not a duration such as 90s, 5m or 2h.`, EXIT.usage);
  const unit = match[2] === "h" ? 3_600_000 : match[2] === "m" ? 60_000 : 1000;
  return Number(match[1]) * unit;
}

/**
 * @param {string[]} argv
 * @returns {{ positional: string[], flags: Map<string, string | true> }}
 */
function parse(argv) {
  const valued = new Set(["--timeout", "--id", "--effort", "--provider"]);
  const known = new Set([...valued, "--json", "--wait", "--help"]);
  /** @type {string[]} */
  const positional = [];
  /** @type {Map<string, string | true>} */
  const flags = new Map();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--") || arg === "-") {
      positional.push(arg);
      continue;
    }
    if (!known.has(arg)) throw new CliError(`Unknown option ${arg}.`, EXIT.usage);
    if (!valued.has(arg)) {
      flags.set(arg, true);
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new CliError(`${arg} needs a value.`, EXIT.usage);
    flags.set(arg, value);
  }
  return { positional, flags };
}

async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the delivery until it ends, a person must answer, or the time is up.
 * @param {{ url: string, token: string }} target
 * @param {{ id: string, name: string }} agent
 * @param {string} deliveryId
 * @param {number} timeoutMs
 */
async function waitForDelivery(target, agent, deliveryId, timeoutMs) {
  const base = `/v1/agents/${encodeURIComponent(agent.id)}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let delivery;
    try {
      delivery = await request(target, "GET", `${base}/deliveries/${encodeURIComponent(deliveryId)}`);
      if (ENDED.has(delivery.status)) {
        return { result: delivery, exitCode: delivery.status === "completed" ? EXIT.done : EXIT.failed };
      }
      // A queued delivery can wait behind an earlier turn of the agent that waits for a person.
      if (delivery.status === "running" || delivery.status === "queued") {
        const pending = await request(target, "GET", `${base}/pending`);
        const waiting = pending.prompts.length + pending.approvals.length + pending.browserTakeovers.length;
        if (waiting > 0) return { result: { ...delivery, state: "needs-person", pending }, exitCode: EXIT.needsPerson };
      }
    } catch (error) {
      // OpenBot restarts: its files are gone or name a new port and token. The delivery stays in the
      // database, so the wait continues until the deadline.
      if (!(error instanceof CliError) || !error.stale || Date.now() >= deadline) throw error;
    }
    if (Date.now() >= deadline) return { result: { ...delivery, state: "timed-out" }, exitCode: EXIT.timedOut };
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

/** @param {string} value */
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Receipts belong to the current Codex chat, OpenBot profile and assignment. @param {string} assignment */
function receiptFolder(assignment) {
  const thread = process.env.CODEX_THREAD_ID;
  if (!thread || !assignment.trim() || assignment.length > 128)
    throw new CliError("A Codex chat and a 1–128 character assignment ID are required.", EXIT.usage);
  const state = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(state, "openbot-handoffs", hash(JSON.stringify([thread, resolve(automationDir()), assignment])));
}

/** @param {string} path */
async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new CliError("Cannot read the saved handoff. Inspect it before sending again.", EXIT.failed);
  }
}

/** Publish a complete record only if absent. Concurrent callers use the same winning record.
 * @param {string} folder @param {string} name @param {object} data */
async function remember(folder, name, data) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const temporary = join(folder, randomUUID());
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(data));
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, join(folder, name));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    return await readRecord(join(folder, name));
  } finally {
    await unlink(temporary);
  }
}

/**
 * @param {string[]} positional
 * @param {Map<string, string | true>} flags
 * @returns {Promise<{ result: any, exitCode: number, text: string }>}
 */
async function main(positional, flags) {
  const [command, ...rest] = positional;
  if (!command || flags.has("--help")) throw new CliError(USAGE, command ? EXIT.done : EXIT.usage);
  // Every flag and argument is checked before the connection is read, so a wrong one never leaves a
  // task queued and is a usage error also when OpenBot is off.
  const timeout = flags.get("--timeout");
  const timeoutMs = duration(typeof timeout === "string" ? timeout : "30m");
  if (command === "list") {
    if (rest.length > 0) throw new CliError(USAGE, EXIT.usage);
    const target = await connection();
    const agents = await request(target, "GET", "/v1/agents");
    return {
      result: { agents },
      exitCode: EXIT.done,
      text: agents.map((/** @type {{ id: string, name: string }} */ agent) => `${agent.id}\t${agent.name}`).join("\n"),
    };
  }
  if (command === "run" || command === "handoff") {
    const [reference, task] = rest;
    if (!reference || task === undefined || rest.length > 2) throw new CliError(USAGE, EXIT.usage);
    const text = task === "-" ? await readStdin() : task;
    if (!text.trim()) throw new CliError("The task is empty.", EXIT.usage);
    const id = flags.get("--id");
    if (command === "handoff" && typeof id !== "string") throw new CliError(USAGE, EXIT.usage);
    const folder = command === "handoff" && typeof id === "string" ? receiptFolder(id) : null;
    const target = await connection();
    let intent = folder ? await readRecord(join(folder, "intent.json")) : null;
    const agent = await findAgent(target, intent?.agentId ?? reference);
    if (folder) {
      intent ??= await remember(folder, "intent.json", {
        agentId: agent.id,
        reference,
        taskHash: hash(text),
        key: randomUUID(),
        createdAt: Date.now(),
      });
      if (intent.taskHash !== hash(text) || (reference !== intent.reference && reference !== intent.agentId))
        throw new CliError("This assignment ID belongs to another task or employee.", EXIT.usage);
      if (agent.id !== intent.agentId || typeof intent.key !== "string" || !intent.key)
        throw new CliError("Cannot verify the original handoff recipient or retry key.", EXIT.failed);
    }
    let saved = folder ? await readRecord(join(folder, "delivery.json")) : null;
    if (!saved) {
      if (intent && !(Date.now() >= intent.createdAt && Date.now() - intent.createdAt < HANDOFF_RETRY_MS))
        throw new CliError(
          "The receipt is missing and the safe retry window has closed. Check the employee chat.",
          EXIT.failed,
        );
      const receipt = await request(target, "POST", `/v1/agents/${encodeURIComponent(agent.id)}/messages`, {
        text,
        clientMessageId: intent?.key ?? (typeof id === "string" ? id : `cli-${randomUUID()}`),
      });
      const delivery = receipt.deliveries.find(
        (/** @type {{ recipientAgentId: string }} */ item) => item.recipientAgentId === agent.id,
      );
      if (!delivery?.id || !receipt.messageId)
        throw new CliError("OpenBot did not return a delivery receipt.", EXIT.failed);
      saved = { messageId: receipt.messageId, deliveryId: delivery.id };
      if (folder) {
        const stored = await remember(folder, "delivery.json", saved);
        if (saved.messageId !== stored.messageId || saved.deliveryId !== stored.deliveryId)
          throw new CliError("OpenBot returned conflicting receipts for this assignment.", EXIT.failed);
      }
      if (!flags.has("--wait"))
        return {
          result: { agent, ...saved, status: delivery.status },
          exitCode: EXIT.done,
          text: `Queued for ${agent.name}: delivery ${delivery.id} (${delivery.status}).`,
        };
    }
    return readDelivery(target, agent, saved.deliveryId, flags.has("--wait"), timeoutMs, saved);
  }
  if (command === "status" || command === "resume") {
    let [reference, deliveryId] = rest;
    let receipt;
    if (command === "resume") {
      if (rest.length !== 1) throw new CliError(USAGE, EXIT.usage);
      const folder = receiptFolder(reference);
      const intent = await readRecord(join(folder, "intent.json"));
      if (!intent) throw new CliError("No such assignment in this Codex chat and OpenBot profile.", EXIT.failed);
      receipt = await readRecord(join(folder, "delivery.json"));
      if (!receipt)
        throw new CliError(
          "No delivery receipt yet. Repeat the original handoff with the same ID and text.",
          EXIT.failed,
        );
      reference = intent.agentId;
      deliveryId = receipt.deliveryId;
    } else if (!reference || !deliveryId || rest.length !== 2) throw new CliError(USAGE, EXIT.usage);
    const target = await connection();
    const agent = await findAgent(target, reference);
    if (command === "resume" && agent.id !== reference)
      throw new CliError("The original handoff recipient is no longer available.", EXIT.failed);
    return readDelivery(target, agent, deliveryId, flags.has("--wait"), timeoutMs, receipt);
  }
  if (command === "agent") {
    const [action, reference, value] = rest;
    if (action === "new-chat") {
      if (!reference || rest.length > 2) throw new CliError(USAGE, EXIT.usage);
      const target = await connection();
      const agent = await findAgent(target, reference);
      await request(target, "POST", `/v1/agents/${encodeURIComponent(agent.id)}/context/clear`);
      return {
        result: { agent, cleared: true },
        exitCode: EXIT.done,
        text: `${agent.name}: new chat started. The agent forgets the chat above; its setup stays.`,
      };
    }
    if (!reference || !value || rest.length > 3) throw new CliError(USAGE, EXIT.usage);
    /** @type {Record<string, string>} */
    let body;
    if (action === "set-account") body = { providerAccountId: value };
    else if (action === "set-model") {
      const effort = flags.get("--effort");
      const provider = flags.get("--provider");
      body = {
        model: value,
        ...(typeof effort === "string" ? { reasoningEffort: effort } : {}),
        ...(typeof provider === "string" ? { provider } : {}),
      };
    } else throw new CliError(USAGE, EXIT.usage);
    const target = await connection();
    const agent = await findAgent(target, reference);
    const updated = await request(target, "POST", `/v1/agents/${encodeURIComponent(agent.id)}/settings`, body);
    return {
      result: { agent: updated },
      exitCode: EXIT.done,
      text: `${updated.name}: ${updated.provider} ${updated.model} (${updated.reasoningEffort}), account ${updated.providerAccountId ?? "default"}.`,
    };
  }
  throw new CliError(USAGE, EXIT.usage);
}

/** @param {{url:string,token:string}} target @param {{id:string,name:string}} agent
 * @param {string} id @param {boolean} wait @param {number} timeout @param {object} [receipt] */
async function readDelivery(target, agent, id, wait, timeout, receipt) {
  const result = wait ? await waitForDelivery(target, agent, id, timeout) : null;
  const delivery = result
    ? result.result
    : await request(target, "GET", `/v1/agents/${encodeURIComponent(agent.id)}/deliveries/${encodeURIComponent(id)}`);
  if (delivery.id !== undefined && delivery.id !== id)
    throw new CliError("The delivery ID does not match.", EXIT.failed);
  const exitCode =
    result?.exitCode ?? (!ENDED.has(delivery.status) || delivery.status === "completed" ? EXIT.done : EXIT.failed);
  return { result: { agent, ...receipt, ...delivery }, exitCode, text: describeDelivery(agent, delivery) };
}

/**
 * @param {{ id: string, name: string }} agent
 * @param {{ id: string, status: string, state?: string, error?: string | null, answer?: string | null }} delivery
 */
function describeDelivery(agent, delivery) {
  if (delivery.state === "needs-person")
    return `${agent.name} waits for a person: answer in OpenBot, then run "openbot-cli status ${agent.id} ${delivery.id}".`;
  if (delivery.state === "timed-out")
    return `Timed out while ${agent.name} works (${delivery.status}). Delivery ${delivery.id} continues.`;
  if (delivery.status === "completed") return delivery.answer ?? `${agent.name} finished with no answer.`;
  if (ENDED.has(delivery.status))
    return `${agent.name}: ${delivery.status}${delivery.error ? `: ${delivery.error}` : ""}${delivery.answer ? `\n${delivery.answer}` : ""}`;
  return `${agent.name}: ${delivery.status}.`;
}

let json = false;
try {
  const { positional, flags } = parse(process.argv.slice(2));
  json = flags.has("--json");
  const { result, exitCode, text } = await main(positional, flags);
  process.stdout.write(json ? `${JSON.stringify({ ok: exitCode === EXIT.done, exitCode, ...result })}\n` : `${text}\n`);
  process.exitCode = exitCode;
} catch (error) {
  const exitCode = error instanceof CliError ? error.exitCode : EXIT.failed;
  const message = error instanceof Error ? error.message : String(error);
  if (json) process.stdout.write(`${JSON.stringify({ ok: exitCode === EXIT.done, exitCode, error: message })}\n`);
  else (exitCode === EXIT.done ? process.stdout : process.stderr).write(`${message}\n`);
  process.exitCode = exitCode;
}
