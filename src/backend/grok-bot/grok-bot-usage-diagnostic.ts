import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import type { GrokBotCachedGateway, GrokBotGatewaySession } from "./grok-bot-account";

const BODY_BYTES = 128 * 1024;
const REQUEST_MS = 1500;
const TOTAL_MS = 6000;
const READ_PATH = {
  agents: "/api/listAgents",
  runs: "/api/getAgentRunHistory",
  transcript: "/api/getAgentTranscriptTail",
  acceptance: "/api/promptAcceptanceStatus",
} as const;
type Endpoint = keyof typeof READ_PATH;
const ReadStatus = Schema.Literals([
  "ok",
  "http-error",
  "redirect",
  "body-limit",
  "invalid-json",
  "network-error",
  "timeout",
  "cancelled",
]);
type ReadStatus = typeof ReadStatus.Type;
class DiagnosticReadFailed extends Schema.TaggedError<DiagnosticReadFailed>()("DiagnosticReadFailed", {
  status: ReadStatus,
  httpStatus: Schema.NullOr(Schema.Number),
}) {}

export interface GrokBotUsageDiagnosticReport {
  readonly outcome:
    | "not-opted-in"
    | "no-cached-account"
    | "signed-out"
    | "no-cached-session"
    | "invalid-session"
    | "read-stopped"
    | "invalid-shape"
    | "no-agent"
    | "complete";
  readonly reads: { endpoint: Endpoint; status: ReadStatus; httpStatus: number | null }[];
  readonly runsInspected: number;
  readonly usageFields: { requests: boolean; input: boolean; output: boolean; cacheRead: boolean };
  readonly nonceEchoMatched: boolean | null;
  readonly runHasNonce: boolean;
  readonly runNonceExactMatch: boolean | null;
}

export interface GrokBotUsageDiagnosticOptions {
  readonly optedIn: boolean;
  readonly cachedGateway: () => GrokBotCachedGateway;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

/**
 * One explicitly requested capability check. It has no account store, cipher, refresh, provisioning,
 * arbitrary URL, or mutation callback. Returns only fixed labels, bounded counts and booleans.
 * Raw response text, identifiers, usage values, headers and errors never leave this operation.
 */
export const readGrokBotUsageDiagnostic = Effect.fn("GrokBotUsageDiagnostic.read")(function* (
  options: GrokBotUsageDiagnosticOptions,
) {
  const reads: GrokBotUsageDiagnosticReport["reads"] = [];
  const usageFields = { requests: false, input: false, output: false, cacheRead: false };
  const report = (
    outcome: GrokBotUsageDiagnosticReport["outcome"],
    extra: Partial<
      Pick<GrokBotUsageDiagnosticReport, "runsInspected" | "nonceEchoMatched" | "runHasNonce" | "runNonceExactMatch">
    > = {},
  ): GrokBotUsageDiagnosticReport => ({
    outcome,
    reads,
    runsInspected: 0,
    usageFields,
    nonceEchoMatched: null,
    runHasNonce: false,
    runNonceExactMatch: null,
    ...extra,
  });
  if (!options.optedIn) return report("not-opted-in");
  const cached = options.cachedGateway();
  if (cached.state !== "loaded") return report(cached.state === "signed-out" ? "signed-out" : "no-cached-account");
  const session = cached.session;
  if (!session) return report("no-cached-session");
  if (!validSession(session)) return report("invalid-session");
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(TOTAL_MS)]);
  const read = (
    endpoint: Endpoint,
    body: { id?: string; limit?: number; accountSlot?: "host"; clientNonce?: string },
  ) =>
    request(session, endpoint, body, signal, options.fetchImpl ?? fetch).pipe(
      Effect.tap((result) => Effect.sync(() => reads.push({ endpoint, status: "ok", httpStatus: result.httpStatus }))),
      Effect.catch((error) => {
        reads.push({ endpoint, status: error.status, httpStatus: error.httpStatus });
        return Effect.succeed(null);
      }),
    );
  const agentsRead = yield* read("agents", {});
  if (agentsRead === null) return report("read-stopped");
  const agents = agentsRead.body;
  const rows = Array.isArray(agents)
    ? agents
    : isDynamicRecord(agents) && Array.isArray(agents.agents)
      ? agents.agents
      : null;
  if (!rows) return report("invalid-shape");
  const agent = rows.slice(0, 20).find((row) => isDynamicRecord(row) && boundedId(row.id));
  if (!isDynamicRecord(agent) || !boundedId(agent.id)) return report("no-agent");
  const id = agent.id;
  const historyRead = yield* read("runs", { id, limit: 10 });
  if (historyRead === null) return report("read-stopped");
  const history = historyRead.body;
  if (!isDynamicRecord(history) || history.agentId !== id || !Array.isArray(history.runs))
    return report("invalid-shape");
  const runs = history.runs.slice(-10).filter(isDynamicRecord);
  for (const run of runs) {
    const usage = isDynamicRecord(run.usage) ? run.usage : {};
    usageFields.requests ||= counter(usage.requests);
    usageFields.input ||= counter(usage.inputTokens);
    usageFields.output ||= counter(usage.outputTokens);
    usageFields.cacheRead ||= counter(usage.cacheReadTokens);
  }
  const extra = { runsInspected: runs.length, runHasNonce: runs.some((run) => boundedId(run.clientNonce)) };
  if (runs.length === 0) return report("complete", extra);
  const transcriptRead = yield* read("transcript", { id, limit: 20 });
  if (transcriptRead === null) return report("read-stopped", extra);
  const transcript = transcriptRead.body;
  if (!isDynamicRecord(transcript) || !Array.isArray(transcript.entries)) return report("invalid-shape", extra);
  const entry = transcript.entries
    .slice(-20)
    .findLast((row) => isDynamicRecord(row) && row.role === "user" && boundedId(row.clientNonce) && boundedId(row.id));
  if (!isDynamicRecord(entry) || !boundedId(entry.clientNonce) || !boundedId(entry.id))
    return report("complete", extra);
  const acceptanceRead = yield* read("acceptance", { accountSlot: "host", clientNonce: entry.clientNonce });
  if (acceptanceRead === null) return report("read-stopped", extra);
  const acceptance = acceptanceRead.body;
  if (
    !isDynamicRecord(acceptance) ||
    typeof acceptance.outcome !== "string" ||
    !["found", "not-found", "unknown-durability"].includes(acceptance.outcome)
  )
    return report("invalid-shape", extra);
  const accepted = isDynamicRecord(acceptance.record) ? acceptance.record : null;
  if (acceptance.outcome === "found" && (!accepted || !boundedId(accepted.clientNonce) || !boundedId(accepted.agentId)))
    return report("invalid-shape", extra);
  const nonceEchoMatched =
    acceptance.outcome === "found" && accepted !== null
      ? accepted.clientNonce === entry.clientNonce && accepted.agentId === id && accepted.echoEntryId === entry.id
      : null;
  // This is structural equality only. A matching optional field does not establish billing attribution.
  return report("complete", {
    ...extra,
    nonceEchoMatched,
    runNonceExactMatch: extra.runHasNonce ? runs.some((run) => run.clientNonce === entry.clientNonce) : null,
  });
});

function validSession(session: GrokBotGatewaySession): boolean {
  try {
    const url = new URL(session.url);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "1340" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      session.token.length > 0 &&
      session.token.length <= 8192 &&
      (session.headers["x-anyrun-network-token"]?.length ?? 0) <= 8192
    );
  } catch {
    return false;
  }
}
function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}
function counter(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const request = Effect.fn("GrokBotUsageDiagnostic.request")(function* (
  session: GrokBotGatewaySession,
  endpoint: Endpoint,
  body: { id?: string; limit?: number; accountSlot?: "host"; clientNonce?: string },
  parentSignal: AbortSignal,
  fetchImpl: typeof fetch,
) {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(REQUEST_MS)]);
  return yield* Effect.tryPromise({
    try: async (interrupted) => {
      const controller = new AbortController();
      try {
        signal.throwIfAborted();
        interrupted.throwIfAborted();
        const headers = new Headers({ Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" });
        const network = session.headers["x-anyrun-network-token"];
        if (network) headers.set("x-anyrun-network-token", network);
        const response = await fetchImpl(new URL(READ_PATH[endpoint], session.url), {
          method: "POST",
          body: JSON.stringify(body),
          headers,
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: AbortSignal.any([signal, interrupted, controller.signal]),
        });
        const fail = (status: ReadStatus): never => {
          throw new DiagnosticReadFailed({ status, httpStatus: response.status });
        };
        if (response.status >= 300 && response.status < 400) fail("redirect");
        if (!response.ok) fail("http-error");
        if (Number(response.headers.get("content-length")) > BODY_BYTES) fail("body-limit");
        const reader = response.body?.getReader();
        if (!reader) return fail("invalid-json");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.byteLength;
            if (size > BODY_BYTES) fail("body-limit");
            chunks.push(item.value);
          }
        } finally {
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        const bytes = Buffer.concat(chunks, size);
        let parsed: unknown;
        try {
          parsed = JSON.parse(bytes.toString("utf8"));
        } catch {
          return fail("invalid-json");
        }
        return { httpStatus: response.status, body: parsed };
      } finally {
        controller.abort();
      }
    },
    catch: (cause) =>
      cause instanceof DiagnosticReadFailed
        ? cause
        : new DiagnosticReadFailed({
            status: signal.aborted
              ? parentSignal.aborted && parentSignal.reason?.name !== "TimeoutError"
                ? "cancelled"
                : "timeout"
              : "network-error",
            httpStatus: null,
          }),
  });
});
