// Transcript parsing and the disposable Claude history index run outside Electron main.
// The parent acknowledges each consumed fragment before this process can advance its cursor.
import { createInterface } from "node:readline";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { claudeHistoryReader } from "./claude-history";
import type { ClaudeHistoryHostMessage, ClaudeHistoryHostRequest } from "./claude-history-host-protocol";
import { LineTooLongError } from "./jsonl";

interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(value: unknown): void;
  start(): void;
}
function isParentPort(value: unknown): value is ParentPort {
  return typeof value === "object" && value !== null && "postMessage" in value && "start" in value;
}
const parentPort = isParentPort(process.parentPort) ? process.parentPort : undefined;
const send = (message: ClaudeHistoryHostMessage): void => {
  if (parentPort) parentPort.postMessage(message);
  else process.stdout.write(`${JSON.stringify(message)}\n`);
};
interface ActiveScan {
  id: number;
  sequence: number;
  acknowledge?: ((proceed: boolean) => void) | undefined;
}
let active: ActiveScan | null = null;

function isRequest(value: unknown): value is ClaudeHistoryHostRequest {
  if (!isDynamicRecord(value) || !Number.isSafeInteger(value.id)) return false;
  if (value.kind === "ack") return Number.isSafeInteger(value.sequence) && typeof value.continue === "boolean";
  if (value.kind !== "scan" || !isDynamicRecord(value.options) || !isDynamicRecord(value.request)) return false;
  return typeof value.request.threadId === "string" && ["none", "full"].includes(String(value.request.items));
}

function lineTooLong(failure: unknown): boolean {
  const seen = new Set<unknown>();
  for (let cause = failure; cause && !seen.has(cause); ) {
    if (cause instanceof LineTooLongError) return true;
    seen.add(cause);
    cause = isDynamicRecord(cause) && "cause" in cause ? cause.cause : undefined;
  }
  return false;
}

async function scan(request: Extract<ClaudeHistoryHostRequest, { kind: "scan" }>): Promise<void> {
  const current: ActiveScan = { id: request.id, sequence: 0 };
  active = current;
  try {
    const result = await Effect.runPromise(
      Effect.result(
        claudeHistoryReader(request.options)(request.request, (fragment) =>
          Effect.callback<boolean>((resume) => {
            const sequence = ++current.sequence;
            current.acknowledge = (proceed) => resume(Effect.succeed(proceed));
            send({ kind: "fragment", id: current.id, sequence, fragment });
          }),
        ),
      ),
    );
    if (Result.isFailure(result))
      send({ kind: "failed", id: request.id, failure: lineTooLong(result.failure) ? "line-too-long" : "scan" });
    else send({ kind: "complete", id: request.id });
  } catch {
    // A failure can contain transcript text or private paths. Only its safe class crosses the port.
    send({ kind: "failed", id: request.id, failure: "scan" });
  } finally {
    if (active === current) active = null;
  }
}

function accept(value: unknown): void {
  if (!isRequest(value)) return;
  if (value.kind === "scan") {
    if (active) {
      send({ kind: "failed", id: value.id, failure: "scan" });
      return;
    }
    void scan(value);
  } else if (active?.id === value.id && active.sequence === value.sequence) {
    const acknowledge = active.acknowledge;
    active.acknowledge = undefined;
    acknowledge?.(value.continue);
  }
}

if (parentPort) {
  parentPort.on("message", (message) => accept(message.data));
  parentPort.start();
} else {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    try {
      accept(JSON.parse(line));
    } catch {
      /* An invalid transport record is not a scan. */
    }
  });
  lines.on("close", () => process.exit(0));
}
send({ kind: "ready", pid: process.pid });
