// Runs the real Live Activity push service with synthetic unread replies and a local relay adapter.
// Run: bun scripts/live-activity-autolink-e2e.ts --phase=before
// Phase selects only the report folder. A lost URL always fails, including on the unfixed source.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type AgentEvent, type AgentRuntimeSnapshot, isAgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { LIVE_ACTIVITY_SEALED_LIMIT, type LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentLiveActivityProps } from "@openbot/team-client/live-activity-props";
import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import { LiveActivityPushService } from "../src/main/live-activity-push";

const ROOT = resolve(import.meta.dirname, "..");
const DEADLINE_MS = 10_000;
const CASES = [
  { name: "autolink", input: "See <https://example.com> today.", expected: "See https://example.com today." },
  { name: "http-autolink", input: "See <http://example.com> today.", expected: "See http://example.com today." },
  {
    name: "code-span",
    input: "See `<https://example.com>` today.",
    expected: "See `<https://example.com>` today.",
  },
  { name: "plain-url", input: "See https://example.com today.", expected: "See https://example.com today." },
  { name: "labeled-link", input: "See [the guide](https://example.com) today.", expected: "See the guide today." },
  { name: "html", input: "See <b>the guide</b><br>today.", expected: "See the guide today." },
];
const SOURCES = [
  "scripts/live-activity-autolink-e2e.ts",
  "src/main/live-activity-push.ts",
  "packages/team-client/src/dynamic-island-coordinator.ts",
  "packages/team-client/src/dynamic-island-presentation.ts",
  "packages/team-client/src/agent-message-text.ts",
  "packages/team-client/src/live-activity-props.ts",
  "packages/team-client/src/live-activity-text.ts",
  "packages/team-client/src/message-summary.ts",
  "packages/team-client/src/live-activity-seal.ts",
  "apps/mobile/src/features/live-activity/model/live-activity-open.ts",
];

interface CaseResult {
  name: string;
  input: string;
  expected: string;
  observedDetail: string | null;
  stage: string;
  passed: boolean;
  relayPushes: number;
  snapshotReads: number;
  readStateReads: number;
  relay: { event: string; sealedLength: number; priority: number } | null;
  cleanup: {
    disposeCompleted: boolean;
    registrationRemoved: boolean;
    listenersRemaining: number;
    listenerAdds: number;
    listenerRemoves: number;
    deadlineCleared: boolean;
  };
}

interface Report {
  phase: string;
  surface: string;
  transport: string;
  sourceHashes: Record<string, string>;
  cases: CaseResult[];
  passed: boolean;
  status: string;
}

type DisplayedProps = Pick<AgentLiveActivityProps, "mode" | "title" | "compact" | "detailMarkdown" | "detail">;

function decodeDisplayedProps(value: unknown): DisplayedProps {
  assert.ok(isDynamicRecord(value), "The opened content must be a props object.");
  assert.ok(value.mode === "message");
  assert.ok(typeof value.title === "string");
  assert.ok(typeof value.compact === "string");
  assert.ok(typeof value.detailMarkdown === "boolean");
  assert.ok(typeof value.detail === "string");
  return {
    mode: value.mode,
    title: value.title,
    compact: value.compact,
    detailMarkdown: value.detailMarkdown,
    detail: value.detail,
  };
}

function snapshot(text: string): AgentRuntimeSnapshot {
  return {
    agents: [
      {
        id: "fixture-agent",
        name: "Fixture agent",
        notifications: true,
        preview: text,
        updatedAt: "2026-10-17T00:00:00.000Z",
        avatarSeed: "fixture-agent",
        avatarHue: null,
        avatarUrl: null,
      },
    ],
    activeTurns: [],
    work: [],
    latestMessages: [{ agentId: "fixture-agent", id: "fixture-message", text, createdAt: "2026-10-17T00:00:00.000Z" }],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
}

async function runCase(fixture: (typeof CASES)[number]): Promise<CaseResult> {
  const result: CaseResult = {
    ...fixture,
    observedDetail: null,
    stage: "setup",
    passed: false,
    relayPushes: 0,
    snapshotReads: 0,
    readStateReads: 0,
    relay: null,
    cleanup: {
      disposeCompleted: false,
      registrationRemoved: false,
      listenersRemaining: 0,
      listenerAdds: 0,
      listenerRemoves: 0,
      deadlineCleared: false,
    },
  };
  const events = new EventEmitter<{ event: [AgentEvent] }>();
  const secret = randomBytes(LIVE_ACTIVITY_SECRET_BYTES);
  const keys = liveActivityKeys(secret);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let service: LiveActivityPushService | undefined;
  try {
    const runtime = snapshot(fixture.input);
    assert.ok(isAgentRuntimeSnapshot(runtime), "The fixture must be a valid runtime snapshot.");
    let receive: (push: LiveActivityRelayPush) => void = () => {};
    const received = new Promise<LiveActivityRelayPush>((resolvePush, reject) => {
      receive = resolvePush;
      deadline = setTimeout(() => reject(new Error("No local relay push before the deadline.")), DEADLINE_MS);
    });
    service = new LiveActivityPushService({
      agents: {
        on: (event, listener) => {
          result.cleanup.listenerAdds += 1;
          events.on(event, listener);
        },
        off: (event, listener) => {
          result.cleanup.listenerRemoves += 1;
          events.off(event, listener);
        },
        getRuntimeSnapshot: () => {
          result.snapshotReads += 1;
          return runtime;
        },
        listConversationReads: () => {
          result.readStateReads += 1;
          return {
            "fixture-agent": { unreadCount: 1, firstUnreadMessageId: "fixture-message", throughMessageId: null },
          };
        },
      },
      send: (push) =>
        Effect.sync(() => {
          result.relayPushes += 1;
          receive(push);
          return "sent" as const;
        }),
      memberActive: (memberId) => memberId === "fixture-member",
      randomBytes,
    });
    // The connected registration must not send. Disconnect starts the real service update timer.
    service.register(
      "fixture-session",
      {
        memberId: "fixture-member",
        hiddenAgentIds: () => new Set<string>(),
        readOptions: {
          excludeRoutineEvents: true,
          excludeRoutineRunEvents: true,
          excludeHostedSiteEvents: true,
          excludeRoutineQuietAnswers: true,
        },
      },
      {
        serverId: "fixture-server",
        token: "ab".repeat(32),
        environment: "development",
        secret: encodeLiveActivityBytes(secret),
        locale: "en",
        away: false,
        photos: [],
      },
    );
    assert.equal(result.relayPushes, 0);
    assert.equal(events.listenerCount("event"), 1);
    service.disconnected("fixture-session");
    assert.equal(service.showsEvent("fixture-session", { agentId: "fixture-agent", kind: "reply" }, null, null), true);
    result.stage = "relay";
    const push = await received;
    result.relay = { event: push.event, sealedLength: push.sealed?.length ?? 0, priority: push.priority };
    assert.equal(push.event, "update");
    assert.equal(push.environment, "development");
    assert.ok(push.sealed && push.sealed.length <= LIVE_ACTIVITY_SEALED_LIMIT);
    assert.ok(result.snapshotReads > 0 && result.readStateReads > 0);
    result.stage = "decrypt";
    const opened = openSealedLiveActivity(
      push.sealed,
      encodeLiveActivityBytes(keys.seal),
      encodeLiveActivityBytes(keys.tag),
    );
    assert.ok(opened, "The widget must open the real service seal.");
    const props = decodeDisplayedProps(JSON.parse(opened));
    assert.equal(props.mode, "message");
    assert.equal(props.title, "Fixture agent");
    assert.equal(props.compact, "1");
    assert.equal(props.detailMarkdown, true);
    result.observedDetail = props.detail;
    result.stage = "displayed-detail";
    assert.equal(props.detail, fixture.expected, "The decrypted display detail must keep the expected text.");
    result.stage = "complete";
    result.passed = true;
  } catch {
    // Stage and synthetic observations describe the failure without exporting errors or push data.
    result.passed = false;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    result.cleanup.deadlineCleared = true;
    try {
      if (service) {
        // dispose closes the send scope and clears the registration's retry/keepalive timer.
        await Effect.runPromise(service.dispose());
        result.cleanup.disposeCompleted = true;
        result.cleanup.registrationRemoved = !service.showsEvent(
          "fixture-session",
          { agentId: "fixture-agent", kind: "reply" },
          null,
          null,
        );
      }
    } catch {
      result.passed = false;
      result.stage = "cleanup";
    }
    result.cleanup.listenersRemaining = events.listenerCount("event");
    if (
      !result.cleanup.disposeCompleted ||
      !result.cleanup.registrationRemoved ||
      result.cleanup.listenersRemaining !== 0 ||
      result.cleanup.listenerAdds !== 1 ||
      result.cleanup.listenerRemoves !== 1
    ) {
      result.passed = false;
      result.stage = "cleanup";
    }
  }
  return result;
}

const phaseArgument = process.argv.slice(2);
const phase = phaseArgument[0]?.replace(/^--phase=/u, "") ?? "before";
const validArguments =
  phaseArgument.length <= 1 &&
  (phaseArgument.length === 0 || phaseArgument[0]?.startsWith("--phase=")) &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(phase);
const output = join(ROOT, ".openbot-build/live-activity-autolink-e2e", validArguments ? phase : "invalid-arguments");
const report: Report = {
  phase: validArguments ? phase : "invalid-arguments",
  surface:
    "LiveActivityPushService -> DynamicIslandCoordinator -> liveActivityView -> seal -> local relay -> widget open",
  transport: "injected local send adapter; no account, APNs, provider, or model",
  sourceHashes: {},
  cases: [],
  passed: false,
  status: "setup",
};
try {
  assert.ok(validArguments, "Use one --phase=<folder-name> argument.");
  for (const file of SOURCES) {
    report.sourceHashes[file] = createHash("sha256")
      .update(readFileSync(join(ROOT, file)))
      .digest("hex");
  }
  for (const fixture of CASES) report.cases.push(await runCase(fixture));
  report.passed = report.cases.length === CASES.length && report.cases.every((result) => result.passed);
  report.status = report.passed ? "pass" : "fail";
} catch {
  report.status = validArguments ? "setup-failure" : "invalid-arguments";
} finally {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${report.passed ? "PASS" : "FAIL"}: ${join(output, "report.json")}\n`);
if (!report.passed) process.exitCode = 1;
