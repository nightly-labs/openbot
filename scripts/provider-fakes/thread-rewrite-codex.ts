// Deterministic, model-free Codex app-server process for thread-rewrite-service-e2e.ts.
import { appendFileSync, existsSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { RpcMessage } from "../../src/backend/protocol";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\n");
  process.exit(0);
}
const [logPath, controlPath, statePath] = process.argv.slice(2);
if (!logPath || !controlPath || !statePath) throw new Error("Missing fake paths.");
interface Item {
  type: string;
  id: string;
  text?: string;
  phase?: string;
  content?: Array<{ type: string; text: string }>;
  clientId?: string;
}
interface Turn {
  id: string;
  status: string;
  items: Item[];
  startedAt: number;
}
interface State {
  threads: Record<string, Turn[]>;
  nextThread: number;
  nextTurn: number;
}
interface Control {
  holdUnsubscribeThread?: string;
  holdTurnText?: string;
}
interface Request {
  id: number | string;
  method: string;
  params?: {
    threadId?: string;
    turnId?: string;
    input?: Array<{ text?: string }>;
    clientUserMessageId?: string;
  };
}
const state: State = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { threads: {}, nextThread: 0, nextTurn: 0 };
const save = () => writeFileSync(statePath, JSON.stringify(state));
const control = (): Control => JSON.parse(readFileSync(controlPath, "utf8"));
interface ProtocolLogEntry {
  method: string;
  threadId?: string;
  turnId?: string;
  requestId?: string | number;
  requestedMethod?: string;
  text?: string;
  turnIds?: string[];
  itemIds?: string[];
}
const log = (entry: ProtocolLogEntry) => appendFileSync(logPath, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
const write = (entry: RpcMessage) => process.stdout.write(`${JSON.stringify(entry)}\n`);
const held = new Set<() => void>();
const releaseWhen = (blocked: () => boolean, finish: () => void) => {
  const check = () => {
    if (blocked()) return;
    held.delete(check);
    finish();
  };
  held.add(check);
  check();
};
watch(dirname(controlPath), (_event, filename) => {
  if (filename?.toString() === "control.json") for (const check of [...held]) check();
});
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
log({ method: "process/start" });
const config = {
  config: { mcp_servers: {} },
  layers: [
    {
      name: { type: "user", file: `${dirname(statePath)}/config.toml`, profile: null },
      version: "1",
      config: { mcp_servers: {} },
    },
  ],
};
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const request: Request = JSON.parse(line);
    const { id, method, params = {} } = request;
    const { threadId, turnId } = params;
    if (id === undefined || !method) return;
    const reply = <Response>(result: Response) => write({ id, result });
    log({ method, threadId, turnId, requestId: id });
    switch (method) {
      case "initialize":
        return reply({});
      case "account/read":
        return reply({ account: { type: "chatgpt", email: "rewrite@example.test" } });
      case "account/rateLimits/read":
        return reply({ rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null });
      case "model/list":
        return reply({ data: [{ id: "gpt-6-luna", model: "gpt-6-luna", displayName: "Fake deterministic model" }] });
      case "plugin/list":
        return reply({ marketplaces: [] });
      case "config/read":
        return reply(config);
      case "config/batchWrite":
        return reply({});
      case "thread/archive":
        return reply({});
      case "thread/start": {
        const created = `fake-thread-${++state.nextThread}`;
        state.threads[created] = [];
        save();
        log({ method: "thread/created", threadId: created });
        return reply({ thread: { id: created, turns: [] } });
      }
      case "thread/resume":
        return reply({ thread: { id: threadId, turns: state.threads[threadId ?? ""] ?? [] } });
      case "thread/read":
        return reply({ thread: { id: threadId, turns: state.threads[threadId ?? ""] ?? [] } });
      case "thread/turns/list": {
        const data = [...(state.threads[threadId ?? ""] ?? [])]
          .reverse()
          .map(({ id, status, startedAt }) => ({ id, status, startedAt }));
        reply({ data, nextCursor: null });
        return log({ method: "history/turns/replied", threadId, turnIds: data.map((turn) => turn.id) });
      }
      case "thread/items/list": {
        const data = (state.threads[threadId ?? ""]?.find((turn) => turn.id === turnId)?.items ?? []).map((item) => ({
          turnId,
          item,
        }));
        reply({ data, nextCursor: null });
        return log({ method: "history/items/replied", threadId, turnId, itemIds: data.map(({ item }) => item.id) });
      }
      case "thread/unsubscribe": {
        if (control().holdUnsubscribeThread === threadId) log({ method: "unsubscribe/held", threadId });
        return releaseWhen(
          () => control().holdUnsubscribeThread === threadId,
          () => {
            log({ method: "unsubscribe/replied", threadId });
            reply({ status: "Unsubscribed" });
          },
        );
      }
      case "turn/start": {
        if (!threadId || !state.threads[threadId]) throw new Error(`Unknown fake thread: ${threadId}`);
        const text = (params.input ?? []).map((item) => item.text ?? "").join("\n");
        const turn: Turn = {
          id: `fake-turn-${++state.nextTurn}`,
          status: "inProgress",
          startedAt: Date.now() / 1000,
          items: [
            {
              type: "userMessage",
              id: `user-${state.nextTurn}`,
              ...(params.clientUserMessageId ? { clientId: params.clientUserMessageId } : {}),
              content: [{ type: "text", text }],
            },
          ],
        };
        state.threads[threadId].push(turn);
        save();
        log({ method: "turn/input", threadId, turnId: turn.id, text });
        reply({ turn: { id: turn.id, status: turn.status, items: [] } });
        write({ method: "turn/started", params: { threadId, turn: { id: turn.id } } });
        write({
          method: "thread/tokenUsage/updated",
          params: {
            threadId,
            turnId: turn.id,
            tokenUsage: { total: { totalTokens: 1000 }, last: { totalTokens: 1000 }, modelContextWindow: 1000000 },
          },
        });
        const blocked = () => {
          const marker = control().holdTurnText;
          return Boolean(marker && text.includes(marker));
        };
        if (blocked()) log({ method: "turn/held", threadId, turnId: turn.id });
        return releaseWhen(blocked, () => {
          if (turn.status !== "inProgress") return;
          const item = {
            type: "agentMessage",
            id: `answer-${turn.id}`,
            text: `Deterministic answer ${turn.id}.`,
            phase: "final_answer",
          };
          turn.items.push(item);
          turn.status = "completed";
          save();
          write({ method: "item/completed", params: { threadId, turnId: turn.id, item } });
          write({ method: "turn/completed", params: { threadId, turn: { id: turn.id, status: turn.status } } });
          log({ method: "turn/finished", threadId, turnId: turn.id });
        });
      }
      case "turn/interrupt": {
        const turn = state.threads[threadId ?? ""]?.find((candidate) => candidate.id === turnId);
        if (turn) turn.status = "interrupted";
        save();
        reply({});
        return write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "interrupted" } } });
      }
      default:
        log({ method: "unsupported", requestedMethod: method });
        write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  })
  .on("close", () => process.exit(0));
