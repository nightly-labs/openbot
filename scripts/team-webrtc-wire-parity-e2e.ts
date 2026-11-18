// Checks that the WebRTC wire of Team protocols 1-10 does not change when code moves between the
// contracts files (plan 011 item 2, step 2). It runs every WebRTC HTTP codec of protocols 2-10, the
// protocol 2 request and response frames, and the WebRTC framing (frames, file chunks, the
// authentication transcript) on one fixed corpus, and records each result or error.
// - Always: the protocol 4-10 frame of each bodyless request (GET, DELETE, routine test, remote viewer)
//   is the frame of the v3 WebRTC codec, which those protocols used before.
// - With `--before=<git ref>`: the same corpus runs on a `git archive` copy of
//   `packages/contracts/src` at that ref, and each result must be the same, byte for byte.
// Run: `bun run test:team-webrtc-wire-parity` (CI), or add `-- --before=<ref>` for the comparison.
// Writes .openbot-build/team-webrtc-wire-parity-e2e/{after,before,report}.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/team-webrtc-wire-parity-e2e");
const beforeRef = process.argv.find((argument) => argument.startsWith("--before="))?.slice("--before=".length);

type Outcome = { ok: unknown } | { error: string };
/** The exports of one contracts module, by name. */
type ModuleExports = ReadonlyMap<string, unknown>;

const CODEC_MODULES = [
  "v2-adapter",
  "v3-webrtc-adapter",
  "v4-webrtc-adapter",
  "v5-webrtc-adapter",
  "v6-webrtc-adapter",
  "v7-webrtc-adapter",
  "v8-webrtc-adapter",
  "v9-webrtc-adapter",
  "v10-webrtc-adapter",
];
const CODEC_NAME = /^(?:encode|decode)TeamProtocolV\d+(?:WebRtc|Current)Http(?:Request|Response)$/u;

const NO_BODY_GET_PATHS = [
  "/v1/compatibility",
  "/v1/identity",
  "/v1/me",
  "/v1/team/presence",
  "/v1/remote-screen/capabilities",
  "/v1/direct/threads",
  "/v1/messages/search?query=hello",
  "/v1/browser/tabs",
  "/v1/browser/control",
  "/v1/team/members",
  "/v1/team/invites",
  "/v1/team/sessions",
  "/v1/agents/status",
  "/v1/sidebar-layout",
  "/v1/agents/usage",
  "/v1/agents/models",
  "/v1/agents",
  "/v1/agents/conversation-reads",
  "/v1/attachments/att-1",
  "/v1/shared-files",
  "/v1/workspace-files",
  "/v1/direct/conversations/conv-1",
  "/v1/direct/conversations/conv-1/page?before=10",
  "/v1/agents/agent-1/avatar",
  "/v1/agents/agent-1/skills",
  "/v1/agents/agent-1/memories",
  "/v1/agents/agent-1/routines",
  "/v1/agents/agent-1/routines/routine-1/runs",
  "/v1/agents/agent-1/conversation?limit=20",
  "/v1/agents/agent-1/conversation-page?before=msg-1",
  "/v1/agents/agent-1/queue",
];
const REQUEST_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ...NO_BODY_GET_PATHS.map((path) => ["GET", path] as const),
  // GET routes outside the frozen list: the scoped usage and analytics routes, and routes that a newer
  // codec owns (a bodyless frame refuses them).
  ["GET", "/v1/agents/agent-1/analytics"],
  ["GET", "/v1/analytics?range=7d"],
  ["GET", "/v1/agents/agent-1/usage"],
  ["GET", "/v1/channels"],
  ["GET", "/v1/agents/agent-1/unknown"],
  ["GET", "/v1/remote-screen/sessions/session-1/viewer-state"],
  ["DELETE", "/v1/attachments/att-1"],
  ["DELETE", "/v1/remote-screen/sessions/session-1"],
  ["DELETE", "/v1/agents/agent-1"],
  ["DELETE", "/v1/agents/agent-1/avatar"],
  ["DELETE", "/v1/agents/agent-1/memories"],
  ["DELETE", "/v1/agents/agent-1/memories/memory-1"],
  ["DELETE", "/v1/agents/agent-1/routines/routine-1"],
  ["DELETE", "/v1/channels/channel-1"],
  ["POST", "/v1/agents/agent-1/routines/routine-1/test"],
  ["POST", "/v1/remote-screen/sessions/session-1/viewer"],
  ["POST", "/v1/remote-screen/sessions/session-1/authorize"],
  ["POST", "/v1/remote-screen/sessions/session-1/moonlight/pair"],
  // Routes with a body: their codecs did not move, and they must not change either.
  ["POST", "/v1/agents/agent-1/conversation/unread"],
  ["POST", "/v1/agents/agent-1/duplicate"],
  ["POST", "/v1/agents/agent-1/queue/edit"],
  ["POST", "/v1/agents/agent-1/messages"],
];
const REQUEST_VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["empty", {}],
  ["field", { a: 1 }],
  ["botId", { botId: "agent-1" }],
  ["agentId", { agentId: "agent-1" }],
  ["array", []],
  ["string", "text"],
  ["number", 0],
  ["function", () => 1],
  ["message", { text: "hello", attachments: [] }],
  ["queue-edit", { deliveryId: "delivery-1", editId: "edit-1" }],
];
const OPTIONS: ReadonlyArray<readonly [string, Record<string, boolean>]> = [
  ["default", {}],
  ["semantic-tags", { preserveSemanticTags: true }],
];
const RESPONSE_STATUSES = [200, 204, 404];
const RESPONSE_VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["empty", {}],
  ["ok", { ok: true }],
  ["error", { error: "Not found." }],
  ["coded-error", { error: "Not found.", code: "not_found" }],
  ["viewer", { url: "https://viewer.invalid/", token: "viewer-token" }],
];

const FRAMES: ReadonlyArray<readonly [string, unknown]> = [
  ["request", { version: 2, type: "request", requestId: "r-1", operation: "http.request", payload: { method: "GET" } }],
  ["response", { version: 2, type: "response", requestId: "r-1", result: { status: 200, body: {} } }],
  [
    "response-error",
    {
      version: 2,
      type: "response",
      requestId: "r-1",
      error: { code: "client_update_required", message: "Update.", retryable: false, status: 426 },
    },
  ],
  [
    "auth-init",
    {
      version: 2,
      type: "auth-init",
      ticket: "ticket-1",
      clientPublicKey: "key",
      clientNonce: "nonce",
      signature: "sig",
    },
  ],
  ["auth-ready", { version: 2, type: "auth-ready", clientNonce: "c", hostNonce: "h", signature: "s" }],
  ["auth-complete", { version: 2, type: "auth-complete", clientNonce: "c", hostNonce: "h" }],
  ["auth-confirmed", { version: 2, type: "auth-confirmed", clientNonce: "c", hostNonce: "h" }],
  ["event", { version: 2, type: "event", sequence: 3, payload: { type: "agent.status" } }],
  ["event-ack", { version: 2, type: "event-ack", throughSequence: 3 }],
  ["event-reset", { version: 2, type: "event-reset", nextSequence: 4 }],
  [
    "event-control",
    { version: 2, type: "event-control", control: { type: "team-typing", botId: "agent-1", typing: true } },
  ],
  [
    "file-open",
    {
      version: 2,
      type: "file-open",
      transferId: "t-1",
      name: "a.txt",
      size: 3,
      mimeType: "text/plain",
      sha256: "a".repeat(64),
    },
  ],
  ["file-ack", { version: 2, type: "file-ack", transferId: "t-1", receivedThrough: 3 }],
  ["file-complete", { version: 2, type: "file-complete", transferId: "t-1" }],
  ["file-cancel", { version: 2, type: "file-cancel", transferId: "t-1", reason: "cancelled" }],
  ["wrong-version", { version: 3, type: "request", requestId: "r-1", operation: "x", payload: null }],
  ["no-request-id", { version: 2, type: "request", operation: "http.request", payload: null }],
];

function outcome(run: () => unknown): Outcome {
  try {
    const value = run();
    return { ok: value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

async function loadModule(source: string, name: string): Promise<ModuleExports> {
  return new Map(Object.entries(await import(join(source, "team-protocol", `${name}.ts`))));
}

/** A codec function of a module that this script loads by path, so its signature is not known here. */
function exported(module: ModuleExports, name: string): (...input: unknown[]) => unknown {
  const fn = module.get(name);
  if (typeof fn !== "function") throw new Error(`${name} is not exported.`);
  return (...input) => fn(...input);
}

function call(module: ModuleExports, name: string, ...input: unknown[]): Outcome {
  return outcome(() => exported(module, name)(...input));
}

async function runCorpus(source: string): Promise<Record<string, Outcome>> {
  const results: Record<string, Outcome> = {};
  for (const moduleName of CODEC_MODULES) {
    const module = await loadModule(source, moduleName);
    for (const name of [...module.keys()].filter((key) => CODEC_NAME.test(key)).sort()) {
      const isResponse = name.endsWith("Response");
      for (const [method, path] of REQUEST_ROUTES) {
        if (isResponse) {
          for (const status of RESPONSE_STATUSES)
            for (const [label, value] of RESPONSE_VALUES)
              results[`${moduleName}.${name} ${method} ${path} ${status} ${label}`] = call(
                module,
                name,
                method,
                path,
                status,
                value,
              );
          continue;
        }
        for (const [label, value] of REQUEST_VALUES)
          for (const [optionLabel, options] of OPTIONS)
            results[`${moduleName}.${name} ${method} ${path} ${label} ${optionLabel}`] = call(
              module,
              name,
              method,
              path,
              value,
              options,
            );
      }
    }
  }
  const adapter = await loadModule(source, "v2-adapter");
  for (const [method, path] of REQUEST_ROUTES)
    for (const [label, value] of REQUEST_VALUES)
      results[`v2-adapter.createTeamProtocolV2Request ${method} ${path} ${label}`] = call(
        adapter,
        "createTeamProtocolV2Request",
        "request-1",
        "http.request",
        { method, path, body: value },
      );
  for (const [label, value] of RESPONSE_VALUES)
    results[`v2-adapter.createTeamProtocolV2Response ${label}`] = call(
      adapter,
      "createTeamProtocolV2Response",
      "request-1",
      { status: 200, body: value },
    );

  // The framing is in `v2.ts` before the move and re-exported from it after the move.
  const framing = await loadModule(source, "v2");
  for (const name of [
    "TEAM_PROTOCOL_V2",
    "TEAM_PROTOCOL_V2_CHANNELS",
    "TEAM_PROTOCOL_V2_MAX_FILE_BYTES",
    "TEAM_PROTOCOL_V2_MAX_FILE_SET_BYTES",
    "TEAM_PROTOCOL_V2_MAX_BINARY_FRAME_BYTES",
    "TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES",
    "TEAM_PROTOCOL_V2_BUFFERED_AMOUNT_HIGH_WATER",
    "TEAM_PROTOCOL_V2_BUFFERED_AMOUNT_LOW_WATER",
  ])
    results[`framing.${name}`] = { ok: framing.get(name) };
  for (const [label, frame] of FRAMES) {
    results[`framing.encodeTeamProtocolV2Frame ${label}`] = call(framing, "encodeTeamProtocolV2Frame", frame);
    for (const decoder of [
      "decodeTeamProtocolV2RpcFrame",
      "decodeTeamProtocolV2AuthFrame",
      "decodeTeamProtocolV2EventFrame",
      "decodeTeamProtocolV2FileControlFrame",
    ])
      results[`framing.${decoder} ${label}`] = call(framing, decoder, JSON.stringify(frame));
  }
  results["framing.encodeTeamProtocolV2Frame oversize"] = call(framing, "encodeTeamProtocolV2Frame", {
    version: 2,
    type: "response",
    requestId: "r-1",
    result: "x".repeat(2 * 1024 * 1024),
  });
  const chunk = { transferId: "t-1", offset: 65_536, bytes: new Uint8Array([1, 2, 3, 250]) };
  results["framing.encodeTeamProtocolV2FileChunk"] = call(framing, "encodeTeamProtocolV2FileChunk", chunk);
  results["framing.encodeTeamProtocolV2FileChunk limit"] = call(framing, "encodeTeamProtocolV2FileChunk", chunk, 8);
  results["framing.decodeTeamProtocolV2FileChunk"] = outcome(() => {
    const encoded = exported(framing, "encodeTeamProtocolV2FileChunk")(chunk);
    const decoded = exported(framing, "decodeTeamProtocolV2FileChunk")(encoded);
    return JSON.parse(
      JSON.stringify(decoded, (_key, value) =>
        value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value,
      ),
    );
  });
  results["framing.decodeTeamProtocolV2FileChunk bad"] = call(
    framing,
    "decodeTeamProtocolV2FileChunk",
    new Uint8Array([3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 97, 1]),
  );
  results["framing.teamProtocolV2AuthenticationTranscript"] = call(framing, "teamProtocolV2AuthenticationTranscript", {
    hostId: "host-1",
    sessionId: "session-1",
    ticket: "ticket-1",
    clientPublicKey: "key",
    clientNonce: "c",
    hostNonce: "h",
    clientFingerprint: "cf",
    hostFingerprint: "hf",
  });
  results["framing.decodeTeamProtocolV2Json nested"] = call(framing, "decodeTeamProtocolV2Json", {
    a: [1, "b", null, { c: true }],
  });
  results["framing.decodeTeamProtocolV2Json NaN"] = call(framing, "decodeTeamProtocolV2Json", Number.NaN);
  return results;
}

function isBodylessRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return (
    method === "GET" ||
    method === "DELETE" ||
    (method === "POST" && /^\/v1\/agents\/[^/]+\/routines\/[^/]+\/test$/u.test(pathname)) ||
    /^\/v1\/remote-screen\/sessions\/[^/]+\/(?:viewer|authorize|viewer-state|moonlight(?:\/.*)?)$/u.test(pathname)
  );
}

/** The protocol 4-10 frame of a bodyless request must be the frame of the v3 WebRTC codec. */
function bodylessMismatches(results: Record<string, Outcome>): string[] {
  const mismatches: string[] = [];
  let compared = 0;
  for (const [key, value] of Object.entries(results)) {
    const match = /^v(\d+)-webrtc-adapter\.(encode|decode)TeamProtocolV\d+WebRtcHttpRequest (\S+) (\S+) (.+)$/u.exec(
      key,
    );
    if (!match) continue;
    const [, version, direction, method, path, rest] = match;
    if (Number(version) < 4 || !method || !path || !isBodylessRoute(method, path)) continue;
    // The browser display and view session routes have their own empty frame since protocol 4.
    if (path.startsWith("/v1/browser/display") || path.includes("/browser/view")) continue;
    const v3 = results[`v3-webrtc-adapter.${direction}TeamProtocolV3WebRtcHttpRequest ${method} ${path} ${rest}`];
    compared += 1;
    if (JSON.stringify(value) !== JSON.stringify(v3)) mismatches.push(key);
  }
  if (compared === 0) throw new Error("No bodyless request was compared.");
  process.stdout.write(`bodyless frames compared with the v3 codec: ${compared}\n`);
  return mismatches;
}

mkdirSync(OUT, { recursive: true });
const after = await runCorpus(join(ROOT, "packages/contracts/src"));
writeFileSync(join(OUT, "after.json"), `${JSON.stringify(after, null, 2)}\n`);
const bodyless = bodylessMismatches(after);

let before: { ref: string; commit: string; compared: number; mismatches: string[] } | null = null;
if (beforeRef) {
  const commit = execFileSync("git", ["rev-parse", "--verify", `${beforeRef}^{commit}`], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const tree = join(OUT, "before-tree");
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(tree, { recursive: true });
  const archive = join(OUT, "before-tree.tar");
  execFileSync("git", ["archive", `--output=${archive}`, commit, "packages/contracts/src"], { cwd: ROOT });
  execFileSync("tar", ["-x", "-f", archive, "-C", tree]);
  rmSync(archive);
  const source = join(tree, "packages/contracts/src");
  if (!existsSync(join(source, "team-protocol/v2.ts"))) throw new Error(`No contracts tree at ${commit}.`);
  const results = await runCorpus(source);
  writeFileSync(join(OUT, "before.json"), `${JSON.stringify(results, null, 2)}\n`);
  const keys = [...new Set([...Object.keys(results), ...Object.keys(after)])].sort();
  before = {
    ref: beforeRef,
    commit,
    compared: keys.length,
    mismatches: keys.filter((key) => JSON.stringify(results[key]) !== JSON.stringify(after[key])),
  };
  rmSync(tree, { recursive: true, force: true });
}

const report = {
  cases: Object.keys(after).length,
  errors: Object.values(after).filter((value) => "error" in value).length,
  bodylessMismatches: bodyless,
  before,
};
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const summary = { ...report, before: before && { ...before, mismatches: before.mismatches.slice(0, 20) } };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (bodyless.length > 0 || (before && before.mismatches.length > 0)) process.exit(1);
