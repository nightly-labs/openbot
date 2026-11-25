import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createTeamProtocolV2Event,
  decodeTeamProtocolSupportV1,
  decodeTeamProtocolSupportV9,
  decodeTeamProtocolSupportV10,
  decodeTeamProtocolV1Event,
  decodeTeamProtocolV1HttpRequest,
  decodeTeamProtocolV2CurrentEvent,
  decodeTeamProtocolV3CurrentHttpRequest,
  TEAM_PROTOCOL_V1,
  TEAM_PROTOCOL_V3,
} from "@openbot/contracts/team-protocol";
import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "@openbot/contracts/team-protocol/capability-limits";
import { decodeTeamProtocolV4BaseCurrentHttpRequest } from "../packages/contracts/src/team-protocol/v4-base-adapter";
import { decodeTeamProtocolV5BaseCurrentHttpRequest } from "../packages/contracts/src/team-protocol/v5-base-adapter";
import {
  decodeTeamProtocolV6BaseEvent,
  decodeTeamProtocolV6BaseHttpRequest,
} from "../packages/contracts/src/team-protocol/v6-base";
import {
  decodeTeamProtocolV7BaseEvent,
  decodeTeamProtocolV7BaseHttpRequest,
} from "../packages/contracts/src/team-protocol/v7-base";
import {
  decodeTeamProtocolV8BaseEvent,
  decodeTeamProtocolV8BaseHttpRequest,
} from "../packages/contracts/src/team-protocol/v8-base";
import {
  decodeTeamCapabilitiesV10,
  TEAM_PROTOCOL_V10,
  TEAM_PROTOCOL_V10_ABSENT_LIMIT,
} from "../packages/contracts/src/team-protocol/v10";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE_PATH = resolve(ROOT, "packages/contracts/src/team-protocol/fixtures/decoder-edge-cases.json");
const REPORT_PATH = resolve(ROOT, ".openbot-build/team-protocol-decoder-e2e/report.json");
const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));

const steps: { name: string; passed: boolean; error?: string }[] = [];

function step(name: string, run: () => void): void {
  try {
    run();
    steps.push({ name, passed: true });
  } catch (error) {
    steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function oversized(length: number): string[] {
  return Array.from({ length }, (_, index) => `capability-${index}`);
}

step("all released protocols are represented", () => {
  const released = Object.keys(TEAM_PROTOCOL_CAPABILITY_LIMITS).map(Number);
  assert.equal(released[0], TEAM_PROTOCOL_V1);
  assert.ok(released.includes(TEAM_PROTOCOL_V3));
  assert.equal(Math.max(...released), TEAM_PROTOCOL_V10);
  assert.deepEqual(
    released,
    Array.from({ length: TEAM_PROTOCOL_V10 }, (_, index) => index + 1),
  );
});

step("protocol 1 event ignores unknown optional fields", () => {
  assert.deepEqual(decodeTeamProtocolV1Event(fixture.event), {
    kind: "known",
    event: { type: "conversation-invalidated", botId: "agent-1", revision: 7 },
  });
});

step("protocol 2 event round trips", () => {
  const frame = createTeamProtocolV2Event(42, fixture.event);
  assert.equal(decodeTeamProtocolV2CurrentEvent(frame).status, "known");
});

step("protocol 3 rejects malformed duplicate requests", () => {
  assert.throws(() => decodeTeamProtocolV3CurrentHttpRequest("POST", "/v1/agents/agent-1/duplicate", {}));
});

step("provider-aware protocols round trip a valid request", () => {
  const route = "PATCH";
  const path = "/v1/agents/agent-1";
  assert.deepEqual(decodeTeamProtocolV4BaseCurrentHttpRequest(route, path, { provider: "codex" }), {
    provider: "codex",
  });
  assert.deepEqual(decodeTeamProtocolV5BaseCurrentHttpRequest(route, path, { provider: "codex" }), {
    provider: "codex",
  });
  assert.deepEqual(decodeTeamProtocolV6BaseHttpRequest(route, path, { provider: "cursor" }), { provider: "cursor" });
  assert.deepEqual(decodeTeamProtocolV7BaseHttpRequest(route, path, { provider: "pi" }), { provider: "pi" });
  assert.deepEqual(
    decodeTeamProtocolV8BaseHttpRequest(route, path, fixture.providerAwareRequest),
    fixture.providerAwareRequest,
  );
});

step("provider-aware event keeps unknown event optional data compatible", () => {
  assert.deepEqual(decodeTeamProtocolV6BaseEvent(fixture.event), {
    kind: "known",
    event: { type: "conversation-invalidated", botId: "agent-1", revision: 7 },
  });
  assert.deepEqual(decodeTeamProtocolV7BaseEvent(fixture.unknownEvent), { kind: "unknown", type: "future-event" });
  assert.deepEqual(decodeTeamProtocolV8BaseEvent(fixture.providerAwareEvent), {
    kind: "known",
    event: { type: "team-direct-typing", senderMemberId: "member-1", recipientMemberId: "member-2", typing: true },
  });
});

step("protocol 9 and 10 support responses decode", () => {
  assert.deepEqual(decodeTeamProtocolSupportV9(fixture.support).protocol, { minimum: 1, maximum: 10 });
  const decoded = decodeTeamProtocolSupportV10({ ...fixture.support, ...fixture.v10 });
  assert.deepEqual(decoded.absent, fixture.v10.absent);
});

step("malformed known fields fail closed", () => {
  assert.deepEqual(decodeTeamProtocolV1Event(fixture.malformedEvent), {
    kind: "invalid",
    type: "conversation-invalidated",
  });
  assert.throws(() => decodeTeamProtocolV1HttpRequest("POST", "/v1/invitations/preview", { inviteToken: 7 }));
  assert.throws(() => decodeTeamProtocolSupportV1({ ...fixture.support, protocol: { minimum: "1", maximum: 10 } }));
});

step("capability and absent lists enforce released limits", () => {
  assert.throws(() =>
    decodeTeamProtocolSupportV1({
      ...fixture.support,
      capabilities: oversized(TEAM_PROTOCOL_CAPABILITY_LIMITS[1] + 1),
    }),
  );
  assert.throws(() =>
    decodeTeamProtocolSupportV9({
      ...fixture.support,
      capabilities: oversized(TEAM_PROTOCOL_CAPABILITY_LIMITS[9] + 1),
    }),
  );
  assert.equal(
    decodeTeamCapabilitiesV10(fixture.v10.capabilities, oversized(TEAM_PROTOCOL_V10_ABSENT_LIMIT)).absent.length,
    TEAM_PROTOCOL_V10_ABSENT_LIMIT,
  );
  assert.throws(() =>
    decodeTeamCapabilitiesV10(fixture.v10.capabilities, oversized(TEAM_PROTOCOL_V10_ABSENT_LIMIT + 1)),
  );
});

await mkdir(resolve(ROOT, ".openbot-build/team-protocol-decoder-e2e"), { recursive: true });
const failed = steps.filter((entry) => !entry.passed);
await writeFile(REPORT_PATH, `${JSON.stringify({ passed: failed.length === 0, steps }, null, 2)}\n`);
for (const entry of failed) process.stderr.write(`FAIL ${entry.name}: ${entry.error}\n`);
if (failed.length > 0) process.exitCode = 1;
