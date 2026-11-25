import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { ANALYTICS_GENERATIONS } from "@openbot/telemetry";
import type { CreditMediaReport } from "../src/backend/agent/credit-media-tools";
import { HostAnalytics, type HostOpenPanelClient } from "../src/main/analytics";

const OUT = resolve(import.meta.dirname, "../.openbot-build/credit-media-analytics-e2e");
const PROMPT = "a secret prompt about the launch";

const AGENT: AgentSummary = {
  id: "agent-1",
  name: "Designer",
  title: "Designer",
  description: "",
  notifications: true,
  provider: "codex",
  model: "gpt-6-luna",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/tmp/agent-1",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

type Sent = { name: string; properties: NonNullable<Parameters<HostOpenPanelClient["track"]>[1]> };
const sent: Sent[] = [];
const globals: Parameters<HostOpenPanelClient["setGlobalProperties"]>[0] = {};
const waiters: { count: number; resolve: () => void }[] = [];
function sentCount(count: number) {
  return new Promise<void>((resolveWait) => {
    if (sent.length >= count) resolveWait();
    else waiters.push({ count, resolve: resolveWait });
  });
}
const client: HostOpenPanelClient = {
  setGlobalProperties: (properties) => Object.assign(globals, properties),
  identify: async () => {},
  clear: () => {},
  track: async (name, properties = {}) => {
    sent.push({ name, properties: { ...properties } });
    for (const waiter of waiters.filter((item) => sent.length >= item.count)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  },
};

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function report(overrides: Partial<CreditMediaReport>): CreditMediaReport {
  return {
    agentId: AGENT.id,
    turnId: "turn-1",
    kind: "video",
    outcome: "generated",
    agentModel: "seedance-2.5",
    model: "kling-3.0",
    modelSource: "agent",
    cost: 56,
    charged: 55.5,
    resolution: "720p",
    durationSeconds: 8,
    audio: true,
    references: 2,
    hold: { reason: "balance", answer: "continued", via: "automatic" },
    approval: { accepted: true, via: "remote", modelChanged: true },
    durationMs: 61_234.4,
    ...overrides,
  };
}

async function run() {
  const analytics = new HostAnalytics(
    {
      enabled: true,
      trackingEnabled: true,
      appVersion: "0.0.0",
      platform: "darwin",
      resolveOwner: () => ({ id: "account-1", email: "owner@example.test" }),
      resolveAgent: (agentId) => (agentId === AGENT.id ? AGENT : null),
    },
    () => client,
  );
  const mediaEvents = () => sent.filter((event) => event.name === "system_credit_media").map((e) => e.properties);

  analytics.handleCreditMedia(report({}));
  await sentCount(1);
  const full = mediaEvents()[0] ?? {};
  check(
    "a generation sends the agent provider and model, the media model, the price and the card answers",
    full.provider === "codex" &&
      full.model === "gpt-6-luna" &&
      full.reasoning_effort === "medium" &&
      full.agent_source === "custom" &&
      full.origin === "unknown" &&
      full.media_kind === "video" &&
      full.outcome === "generated" &&
      full.media_model === "kling-3.0" &&
      full.agent_media_model === "seedance-2.5" &&
      full.model_source === "agent" &&
      full.credits_cost === 56 &&
      full.credits_charged === 55.5 &&
      full.resolution === "720p" &&
      full.duration_seconds === 8 &&
      full.audio === true &&
      full.reference_count === 2 &&
      full.hold_reason === "balance" &&
      full.hold_answer === "continued" &&
      full.hold_via === "automatic" &&
      full.approval === "accepted" &&
      full.approval_via === "remote" &&
      full.model_changed === true &&
      full.duration_ms === 61_234,
    full,
  );
  check(
    "the event uses the current host generation",
    globals.surface === "desktop_host" && globals.event_schema_version === ANALYTICS_GENERATIONS.desktop_host,
    globals,
  );

  analytics.handleCreditMedia(
    report({
      outcome: "declined",
      agentModel: PROMPT,
      model: `${"m".repeat(90)}`,
      resolution: PROMPT,
      cost: 1e9,
      charged: null,
      durationSeconds: null,
      audio: null,
      hold: null,
      approval: { accepted: false, via: "local", modelChanged: false },
      durationMs: 1e12,
    }),
  );
  await sentCount(2);
  const declined = mediaEvents()[1] ?? {};
  check(
    "a decline sends the declined approval, and free text, long names and out-of-range values are dropped",
    declined.outcome === "declined" &&
      declined.approval === "declined" &&
      declined.approval_via === "local" &&
      declined.model_changed === false &&
      !("agent_media_model" in declined) &&
      !("media_model" in declined) &&
      !("resolution" in declined) &&
      !("credits_cost" in declined) &&
      !("credits_charged" in declined) &&
      !("hold_reason" in declined) &&
      !("duration_ms" in declined) &&
      !JSON.stringify(declined).includes("secret"),
    declined,
  );

  analytics.handleCreditMedia(
    report({
      agentId: "gone",
      kind: "image",
      outcome: "muted",
      model: null,
      agentModel: null,
      modelSource: null,
      cost: null,
      charged: null,
      resolution: null,
      durationSeconds: null,
      audio: null,
      references: 0,
      hold: { reason: "agents_off", answer: "muted", via: null },
      approval: null,
    }),
  );
  await sentCount(3);
  const muted = mediaEvents()[2] ?? {};
  check(
    "a muted credits card sends its reason and answer, and no approval or model",
    muted.media_kind === "image" &&
      muted.outcome === "muted" &&
      muted.hold_reason === "agents_off" &&
      muted.hold_answer === "muted" &&
      !("hold_via" in muted) &&
      !("approval" in muted) &&
      !("media_model" in muted) &&
      !("provider" in muted) &&
      muted.reference_count === 0,
    muted,
  );
}

let passed = false;
try {
  await run();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks, sent }, null, 2)}\n`);
}
for (const item of checks) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} ${item.name}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
if (!passed) process.exit(1);
