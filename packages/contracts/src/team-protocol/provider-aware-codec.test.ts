import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as legacy4 from "./legacy-v4-base";
import * as legacy5 from "./legacy-v5-base";
import * as legacy6 from "./legacy-v6-base";
import * as next4 from "./v4-base";
import * as next5 from "./v5-base";
import type { TeamProtocolV6BaseJsonObject, TeamProtocolV6BaseJsonValue } from "./v6-base";
import * as next6 from "./v6-base";

// Differential proof: the parameter files must give the same result as the frozen copies they replace,
// for every input. A result is the returned value or the thrown message.

type Json = TeamProtocolV6BaseJsonValue;

const fixtureRoot = new URL("./fixtures/", import.meta.url);
const fixtures: Json[] = readdirSync(fixtureRoot).flatMap((version) =>
  readdirSync(new URL(`${version}/`, fixtureRoot)).map((file) =>
    JSON.parse(readFileSync(new URL(`${version}/${file}`, fixtureRoot), "utf8")),
  ),
);

const providerValues: Json[] = [
  "codex",
  "chatgpt",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "acp",
  "cursor",
  "cline",
  "gemini",
  "unknown",
  "signed-out",
  "unsupported",
  "",
  "Codex",
  " codex",
  "codex ",
  "cursor\u0000",
  null,
  0,
  true,
  {},
  [],
  ["codex"],
];
const modelValues: Json[] = [
  "a",
  "A0",
  "-a",
  ".a",
  "[1m]",
  "claude-opus-5-5[1m]",
  "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
  "a,b",
  "a=b",
  "a b",
  "a\nb",
  "aä",
  "a/b:c.d_e-f",
  "a\\b",
  "a".repeat(159),
  "a".repeat(160),
  "a".repeat(161),
  `${"a".repeat(159)}]`,
  `${"a".repeat(159)}=`,
  `${"a".repeat(160)},`,
  "",
  null,
  1,
];
const mutations = new Map<string, Json[]>([
  ["provider", providerValues],
  ["id", [...providerValues, "agent-cursor"]],
  ["kind", providerValues],
  ["model", modelValues],
  ["accountType", ["team", "", null]],
  ["email", ["user@example.com", null, 1]],
]);

function nested(value: Json): Json[] {
  if (Array.isArray(value)) return [value, ...value.flatMap(nested)];
  if (value !== null && typeof value === "object") return [value, ...Object.values(value).flatMap(nested)];
  return [];
}

function mutated(value: Json): Json[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      mutated(item).map((variant) => value.map((other, at) => (at === index ? variant : other))),
    );
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, field]) => [
    ...(mutations.get(key) ?? []).map((replacement): Json => ({ ...value, [key]: replacement })),
    ...mutated(field).map((variant): Json => ({ ...value, [key]: variant })),
  ]);
}

const sampleStatus: TeamProtocolV6BaseJsonObject = {
  phase: "ready",
  cliVersion: null,
  auth: { kind: "claude", email: null },
  providers: [{ id: "claude", state: "available", version: "1.0.0", message: null }],
  capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};
const roots: Json[] = [
  ...fixtures,
  sampleStatus,
  { ...sampleStatus, auth: { kind: "unsupported", accountType: "team" } },
  { ...sampleStatus, auth: { kind: "signed-out" }, providers: [] },
];
const bodies: Json[] = [...new Set(roots.flatMap((root) => [...nested(root), ...mutated(root)]))];
const events: Json[] = bodies.flatMap((body) => [
  body,
  { type: "status", status: body },
  { type: "bots-changed", bots: [body] },
  { type: "bots-changed", bots: body },
]);

const exactRoutes = [
  ...readFileSync(new URL("./legacy-v6-base.ts", import.meta.url), "utf8").matchAll(
    /"(GET|POST|PATCH|PUT|DELETE) (\/v1\/[^"]*)": "/gu,
  ),
].map((match) => [match[1] ?? "", match[2] ?? ""] as const);
const agentActions = [
  "",
  "/memories",
  "/memories/m1",
  "/routines",
  "/routines/r1",
  "/routines/r1/test",
  "/routines/r1/runs",
  "/avatar",
  "/conversation",
  "/conversation-page",
  "/conversation/read",
  "/messages",
  "/queue",
  "/failures/acknowledge",
  "/reactions",
  "/queue/cancel",
  "/queue/steer",
  "/queue/update",
  "/queue/reorder",
  "/interrupt",
  "/unknown",
];
const patternPaths = [
  "/v1/team/members/m1",
  "/v1/direct/conversations/c1",
  "/v1/direct/conversations/c1/page",
  "/v1/direct/conversations/c1/read",
  "/v1/unknown",
  ...agentActions.map((action) => `/v1/agents/agent-cursor${action}`),
];
const routes = [
  ...exactRoutes,
  ...["GET", "POST", "PATCH", "PUT", "DELETE"].flatMap((method) => patternPaths.map((path) => [method, path] as const)),
];

type Outcome<T> = { value: T } | { error: string };

function outcome<T>(run: () => T): Outcome<T> {
  try {
    return { value: run() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function v4(m: typeof legacy4) {
  return {
    decodeEvent: m.decodeTeamProtocolV4BaseEvent,
    encodeEvent: m.encodeTeamProtocolV4BaseEvent,
    decodeClientEvent: m.decodeTeamProtocolV4BaseClientEvent,
    encodeClientEvent: m.encodeTeamProtocolV4BaseClientEvent,
    decodeSupport: m.decodeTeamProtocolSupportV4Base,
    decodeHttpRequest: m.decodeTeamProtocolV4BaseHttpRequest,
    decodeHttpResponse: m.decodeTeamProtocolV4BaseHttpResponse,
    httpRoute: m.teamProtocolV4BaseHttpRoute,
  };
}

function v5(m: typeof legacy5): ReturnType<typeof v4> {
  return {
    decodeEvent: m.decodeTeamProtocolV5BaseEvent,
    encodeEvent: m.encodeTeamProtocolV5BaseEvent,
    decodeClientEvent: m.decodeTeamProtocolV5BaseClientEvent,
    encodeClientEvent: m.encodeTeamProtocolV5BaseClientEvent,
    decodeSupport: m.decodeTeamProtocolSupportV5Base,
    decodeHttpRequest: m.decodeTeamProtocolV5BaseHttpRequest,
    decodeHttpResponse: m.decodeTeamProtocolV5BaseHttpResponse,
    httpRoute: m.teamProtocolV5BaseHttpRoute,
  };
}

function v6(m: typeof legacy6): ReturnType<typeof v4> {
  return {
    decodeEvent: m.decodeTeamProtocolV6BaseEvent,
    encodeEvent: m.encodeTeamProtocolV6BaseEvent,
    decodeClientEvent: m.decodeTeamProtocolV6BaseClientEvent,
    encodeClientEvent: m.encodeTeamProtocolV6BaseClientEvent,
    decodeSupport: m.decodeTeamProtocolSupportV6Base,
    decodeHttpRequest: m.decodeTeamProtocolV6BaseHttpRequest,
    decodeHttpResponse: m.decodeTeamProtocolV6BaseHttpResponse,
    httpRoute: m.teamProtocolV6BaseHttpRoute,
  };
}

const pairs = [
  { version: 4, legacy: v4(legacy4), next: v4(next4) },
  { version: 5, legacy: v5(legacy5), next: v5(next5) },
  { version: 6, legacy: v6(legacy6), next: v6(next6) },
];

describe("provider-aware codec factory", () => {
  it("keeps the exported names and constants of each frozen base", () => {
    expect(Object.keys(next4).sort()).toEqual(Object.keys(legacy4).sort());
    expect(Object.keys(next5).sort()).toEqual(Object.keys(legacy5).sort());
    expect(Object.keys(next6).sort()).toEqual(Object.keys(legacy6).sort());
    for (const [legacy, next] of [
      [legacy4.TEAM_PROTOCOL_V4Base, next4.TEAM_PROTOCOL_V4Base],
      [legacy5.TEAM_PROTOCOL_V5Base, next5.TEAM_PROTOCOL_V5Base],
      [legacy6.TEAM_PROTOCOL_V6Base, next6.TEAM_PROTOCOL_V6Base],
      [legacy4.TEAM_PROTOCOL_V4Base_WEBSOCKET, next4.TEAM_PROTOCOL_V4Base_WEBSOCKET],
      [legacy5.TEAM_PROTOCOL_V5Base_WEBSOCKET, next5.TEAM_PROTOCOL_V5Base_WEBSOCKET],
      [legacy6.TEAM_PROTOCOL_V6Base_WEBSOCKET, next6.TEAM_PROTOCOL_V6Base_WEBSOCKET],
      [legacy4.TEAM_PROTOCOL_VERSION_HEADER, next4.TEAM_PROTOCOL_VERSION_HEADER],
      [legacy5.TEAM_APP_VERSION_HEADER, next5.TEAM_APP_VERSION_HEADER],
      [legacy6.TEAM_CAPABILITIES_HEADER, next6.TEAM_CAPABILITIES_HEADER],
    ]) {
      expect(next).toBe(legacy);
    }
    expect(next4.TEAM_PROTOCOL_V4Base_CAPABILITIES).toEqual(legacy4.TEAM_PROTOCOL_V4Base_CAPABILITIES);
    expect(next5.TEAM_PROTOCOL_V5Base_CAPABILITIES).toEqual(legacy5.TEAM_PROTOCOL_V5Base_CAPABILITIES);
    expect(next6.TEAM_PROTOCOL_V6Base_CAPABILITIES).toEqual(legacy6.TEAM_PROTOCOL_V6Base_CAPABILITIES);
  });

  for (const { version, legacy, next } of pairs) {
    it(`decodes and encodes the corpus as protocol ${version} did`, { timeout: 300_000 }, () => {
      // Count what the legacy codec accepts, so that a corpus that never reaches the checks fails.
      const accepted = { events: 0, clientEvents: 0, requests: 0, responses: 0 };
      const mismatches: string[] = [];
      const compare = <T>(label: string, before: Outcome<T>, after: Outcome<T>): void => {
        const expected = JSON.stringify(before);
        if (JSON.stringify(after) !== expected) mismatches.push(`${label}: ${expected} != ${JSON.stringify(after)}`);
      };
      for (const event of events) {
        const decoded = outcome(() => legacy.decodeEvent(event));
        compare(
          "event",
          decoded,
          outcome(() => next.decodeEvent(event)),
        );
        if ("value" in decoded && decoded.value.kind === "known") {
          accepted.events += 1;
          const known = decoded.value.event;
          compare(
            "encode event",
            outcome(() => legacy.encodeEvent(known)),
            outcome(() => next.encodeEvent(known)),
          );
        }
      }
      for (const body of bodies) {
        const clientEvent = outcome(() => legacy.decodeClientEvent(body));
        compare(
          "client event",
          clientEvent,
          outcome(() => next.decodeClientEvent(body)),
        );
        if ("value" in clientEvent) {
          accepted.clientEvents += 1;
          const known = clientEvent.value;
          compare(
            "encode client event",
            outcome(() => legacy.encodeClientEvent(known)),
            outcome(() => next.encodeClientEvent(known)),
          );
        }
        compare(
          "support",
          outcome(() => legacy.decodeSupport(body)),
          outcome(() => next.decodeSupport(body)),
        );
        for (const [method, path] of routes) {
          const request = outcome(() => legacy.decodeHttpRequest(method, path, body));
          if ("value" in request) accepted.requests += 1;
          compare(
            `request ${method} ${path}`,
            request,
            outcome(() => next.decodeHttpRequest(method, path, body)),
          );
          for (const status of [200, 201, 404]) {
            const response = outcome(() => legacy.decodeHttpResponse(method, path, status, body));
            if ("value" in response) accepted.responses += 1;
            compare(
              `response ${status} ${method} ${path}`,
              response,
              outcome(() => next.decodeHttpResponse(method, path, status, body)),
            );
          }
        }
      }
      for (const [method, path] of routes) {
        compare(
          `route ${method} ${path}`,
          outcome(() => legacy.httpRoute(method, path)),
          outcome(() => next.httpRoute(method, path)),
        );
      }
      process.stdout.write(
        `${JSON.stringify({ version, events: events.length, bodies: bodies.length, routes: routes.length, accepted })}\n`,
      );
      expect(mismatches.slice(0, 20)).toEqual([]);
      expect(accepted.events).toBeGreaterThan(0);
      expect(accepted.requests).toBeGreaterThan(0);
      expect(accepted.responses).toBeGreaterThan(0);
    });
  }
});
