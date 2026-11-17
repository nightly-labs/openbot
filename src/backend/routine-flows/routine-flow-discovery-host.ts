// A killable, read-only connection to canonical openbot.db. No application imports or migrations.
import { basename, isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import type { RoutineFlowDiscoveryMessage, RoutineFlowDiscoveryRequest } from "./routine-flow-discovery-protocol";

const PAGE_SIZE = 128;
interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(message: RoutineFlowDiscoveryMessage): void;
  start(): void;
}
function record(value: unknown): value is DynamicRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parentPort(value: unknown): value is ParentPort {
  return record(value) && typeof value.postMessage === "function" && typeof value.start === "function";
}
function cursor(value: unknown): value is { updatedAt: string; runId: string } {
  return record(value) && typeof value.updatedAt === "string" && typeof value.runId === "string";
}
function request(value: unknown): value is RoutineFlowDiscoveryRequest {
  if (
    !record(value) ||
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    typeof value.since !== "string" ||
    !Number.isFinite(Date.parse(value.since)) ||
    value.since.length > 64 ||
    Object.keys(value).some((key) => !["id", "kind", "since", "after"].includes(key))
  )
    return false;
  return value.kind === "owners" || value.kind === "results"
    ? value.after === null || cursor(value.after)
    : value.kind === "handoffs" && (value.after === null || typeof value.after === "string");
}

const port = process.parentPort;
const utility = parentPort(port) ? port : null;
const send = (message: RoutineFlowDiscoveryMessage) => {
  if (utility) utility.postMessage(message);
  // Machine-readable: the isolated Node process uses the same fixed protocol over stdio.
  else process.stdout.write(`${JSON.stringify(message)}\n`);
};
const path = process.argv[2];
let database: DatabaseSync;
try {
  if (!path || !isAbsolute(path) || basename(path) !== "openbot.db") throw new Error("Invalid database path.");
  database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  database.exec("PRAGMA query_only = ON");
  database.exec("PRAGMA busy_timeout = 750");
} catch {
  send({ kind: "startup-failed" });
  process.exit(1);
}

function discover(input: unknown): void {
  if (!request(input)) {
    if (record(input) && typeof input.id === "number") send({ id: input.id, kind: "failed" });
    return;
  }
  try {
    if (input.kind === "owners") {
      const rows = database
        .prepare(
          `SELECT run.run_id, run.updated_at FROM projection_routine_runs AS run
         WHERE run.status IN ('succeeded','failed','interrupted','cancelled') AND run.updated_at >= ?
           ${input.after ? "AND (run.updated_at, run.run_id) > (?, ?)" : ""}
           AND NOT EXISTS (SELECT 1 FROM routine_flow_steps AS step
             WHERE step.run_id = run.run_id AND step.agent_id = run.agent_id)
         ORDER BY run.updated_at, run.run_id LIMIT ?`,
        )
        .all(input.since, ...(input.after ? [input.after.updatedAt, input.after.runId] : []), PAGE_SIZE + 1);
      const selected = rows.slice(0, PAGE_SIZE);
      const last = selected.at(-1);
      send({
        id: input.id,
        kind: "owners",
        runIds: selected.map((row) => String(row.run_id)),
        after:
          rows.length > PAGE_SIZE && last ? { updatedAt: String(last.updated_at), runId: String(last.run_id) } : null,
      });
    } else if (input.kind === "results") {
      const rows = database
        .prepare(
          `SELECT run.run_id, run.updated_at FROM projection_routine_runs AS run
         JOIN routine_result_destinations AS destination ON destination.routine_id = run.routine_id
         WHERE (run.status = 'succeeded'
           OR (run.status = 'failed' AND EXISTS (SELECT 1 FROM projection_deliveries AS queued
             WHERE queued.delivery_id = run.delivery_id AND queued.status = 'completed')))
           AND run.updated_at >= ? AND run.updated_at >= destination.updated_at
           ${input.after ? "AND (run.updated_at, run.run_id) > (?, ?)" : ""}
           AND NOT EXISTS (SELECT 1 FROM routine_result_deliveries AS delivery WHERE delivery.run_id = run.run_id)
         ORDER BY run.updated_at, run.run_id LIMIT ?`,
        )
        .all(input.since, ...(input.after ? [input.after.updatedAt, input.after.runId] : []), PAGE_SIZE + 1);
      const selected = rows.slice(0, PAGE_SIZE);
      const last = selected.at(-1);
      send({
        id: input.id,
        kind: "results",
        runIds: selected.map((row) => String(row.run_id)),
        after:
          rows.length > PAGE_SIZE && last ? { updatedAt: String(last.updated_at), runId: String(last.run_id) } : null,
      });
    } else {
      const rows = database
        .prepare(
          `SELECT DISTINCT run.run_id FROM routine_flow_steps AS source
         CROSS JOIN projection_routine_runs AS run ON run.run_id = source.run_id
         JOIN routine_flow_links AS link ON link.routine_id = run.routine_id
           AND link.from_agent_id = source.agent_id AND link.created_at <= run.created_at
         WHERE source.updated_at >= ? AND source.status <> 'running'
           ${input.after ? "AND run.run_id > ?" : ""}
           AND NOT EXISTS (SELECT 1 FROM routine_flow_steps AS target
             WHERE target.run_id = run.run_id AND target.agent_id = link.to_agent_id)
         ORDER BY run.run_id LIMIT ?`,
        )
        .all(input.since, ...(input.after ? [input.after] : []), PAGE_SIZE + 1);
      const selected = rows.slice(0, PAGE_SIZE);
      send({
        id: input.id,
        kind: "handoffs",
        runIds: selected.map((row) => String(row.run_id)),
        after: rows.length > PAGE_SIZE ? String(selected.at(-1)?.run_id) : null,
      });
    }
  } catch {
    send({ id: input.id, kind: "failed" });
  }
}

if (utility) {
  utility.on("message", (message) => discover(message.data));
  utility.start();
} else {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    try {
      discover(JSON.parse(line));
    } catch {
      /* Malformed transport input executes nothing. */
    }
  });
  lines.on("close", () => {
    database.close();
    process.exit(0);
  });
}
send({ kind: "ready" });
