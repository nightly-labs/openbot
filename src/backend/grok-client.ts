import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClientSideConnection, ContentBlock, InitializeResponse } from "@agentclientprotocol/sdk";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type DynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { AcpAgentClient, type AcpHistoryPersistence } from "./acp-client";
import { GROK_ACP_FLAVOR } from "./acp-flavor";
import type { GrokCliInfo } from "./cli";
import type { McpDropReporter, McpEndpointSource, McpServerSource, McpToolRuntimeSource } from "./mcp-provider-shapes";
import { confineSpawnTarget, grokStatePaths, type ProcessConfinement } from "./process-confinement";
import { type AccountRateLimitsReadResult, getRecord, getString } from "./protocol";
import { providerCall } from "./provider-client-effects";

export class GrokAgentClient extends AcpAgentClient {
  constructor(
    cli: GrokCliInfo,
    requestTimeoutMs = 30_000,
    profileGeneration = false,
    mcpServers: McpServerSource = () => [],
    reportMcpDrops?: McpDropReporter,
    mcpToolRuntimes?: McpToolRuntimeSource,
    mcpEndpoint?: McpEndpointSource,
    confinement?: ProcessConfinement,
    agentEnvironment?: () => Readonly<Record<string, string>>,
    history?: AcpHistoryPersistence,
  ) {
    super(cli, requestTimeoutMs, {
      provider: "grok",
      flavor: GROK_ACP_FLAVOR,
      ...(confinement
        ? {
            confine: (target) =>
              confineSpawnTarget(target, confinement, grokStatePaths({ ...process.env, ...agentEnvironment?.() })),
          }
        : {}),
      profileGeneration,
      // A profile-generation client asks one question and must not act, so it is given none.
      mcpServers: profileGeneration ? () => [] : mcpServers,
      reportMcpDrops,
      mcpToolRuntimes,
      mcpEndpoint,
      argv: [
        "--no-auto-update",
        ...(profileGeneration ? ["--tools=", "--deny", "*", "--no-subagents", "--disable-web-search"] : []),
        "agent",
        "stdio",
      ],
      env: { GROK_OAUTH2_REFERRER: "openbot" },
      // Read at each spawn, so a change to the user's `config.toml` applies to the next process.
      extraEnv: () => {
        const environment = { ...agentEnvironment?.() };
        return { ...grokFeatureEnvironment({ ...process.env, ...environment }), ...environment };
      },
      history,
      signInMessage: sourceText("error.provider.grokSignIn"),
      authenticate,
      readAccount: (connection) =>
        providerCall(() => connection.extMethod("_x.ai/auth/info", {})).pipe(Effect.map(grokAccount)),
      readRateLimits: (connection) =>
        providerCall(() => connection.extMethod("_x.ai/billing", {})).pipe(Effect.map(grokRateLimits)),
      steer,
    });
  }
}

/**
 * Grok features that OpenBot agents do not use, each with its `config.toml` key and the environment
 * value that turns it off. Grok `agent stdio` ignores `--tools` and `--disallowed-tools`, so only
 * these switches remove a tool. Measured with `bun run bench:grok-prompt-settings` on Grok CLI 1.0.70
 * and Grok Build Fast, in prompt tokens:
 * - `send_feedback` and `workflow`: 1,707 in each request. Feedback goes to xAI, and a workflow runs
 *   a background agent fleet that OpenBot does not show. Without workflows Grok declares `update_goal`.
 * - The turn summary: one more request of about 1,600 after each turn, for a line that OpenBot does
 *   not show.
 * - The skills of `~/.claude/skills`: 2,811 in each request with one developer's skills. OpenBot runs
 *   Claude agents without the user's Claude Code setup by default, too.
 * The image, video, search, subagent and question tools stay (2026-11-07 user decision): together
 * they cost 6,104, but an agent can use each of them.
 */
const GROK_FEATURE_SWITCHES: ReadonlyArray<{ key: string; env: string }> = [
  { key: "features.feedback", env: "GROK_FEEDBACK_ENABLED" },
  { key: "workflows.enabled", env: "GROK_WORKFLOWS" },
  { key: "features.turn_summary", env: "GROK_TURN_SUMMARY" },
  { key: "compat.claude.skills", env: "GROK_CLAUDE_SKILLS_ENABLED" },
];

/**
 * The environment values that turn off `GROK_FEATURE_SWITCHES`. An environment value wins over the
 * user's `config.toml`, so OpenBot sets one only for a feature that neither the user's environment
 * nor their `config.toml` sets.
 */
function grokFeatureEnvironment(env: NodeJS.ProcessEnv, home = homedir()): Record<string, string> {
  const grokHome = env.GROK_HOME?.trim() || join(home, ".grok");
  let config = "";
  try {
    config = readFileSync(join(grokHome, "config.toml"), "utf8");
  } catch {
    // No `config.toml`: Grok uses its defaults.
  }
  const keys = tomlKeys(config);
  return Object.fromEntries(
    GROK_FEATURE_SWITCHES.filter((feature) => env[feature.env] === undefined && !keys.has(feature.key)).map(
      (feature) => [feature.env, "0"],
    ),
  );
}

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/u;

/** The parts of a dotted TOML key, such as `features."turn_summary"`, or null for one that does not parse. */
function tomlKeyParts(text: string): string[] | null {
  const parts = text.split(".").map((part) => part.trim().replace(/^"(.*)"$|^'(.*)'$/u, "$1$2"));
  return parts.every((part) => TOML_BARE_KEY.test(part)) ? parts : null;
}

/**
 * The full dotted names of the keys that a TOML file sets: `key = value` lines under `[table]` and
 * `[[table]]` headers, and the keys of a one-line inline table. A line that does not parse sets
 * nothing, as Grok then also refuses the file.
 */
function tomlKeys(text: string): Set<string> {
  const keys = new Set<string>();
  let table: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/u.exec(line);
    if (header?.[1]) {
      table = tomlKeyParts(header[1]) ?? [];
      continue;
    }
    const assignment = /^([^=]+)=\s*(.*)$/u.exec(line);
    const parts = assignment?.[1] ? tomlKeyParts(assignment[1]) : null;
    if (!parts) continue;
    const name = [...table, ...parts].join(".");
    keys.add(name);
    const inline = /^\{(.*)\}/u.exec(assignment?.[2] ?? "");
    if (inline?.[1])
      for (const entry of inline[1].split(",")) {
        const inner = /^([^=]+)=/u.exec(entry.trim());
        const innerParts = inner?.[1] ? tomlKeyParts(inner[1]) : null;
        if (innerParts) keys.add([name, ...innerParts].join("."));
      }
  }
  return keys;
}

const authenticate = Effect.fn("Grok.authenticate")(function* (
  connection: ClientSideConnection,
  initialization: InitializeResponse,
) {
  const authMethod = process.env.XAI_API_KEY?.trim() ? "xai.api_key" : "cached_token";
  const advertised = initialization.authMethods ?? [];
  const selected =
    advertised.find((method) => method.id === authMethod) ?? advertised.find((method) => method.id === "cached_token");
  if (selected) yield* providerCall(() => connection.authenticate({ methodId: selected.id }));
});

/**
 * Grok's `x.ai/interject` puts a message in the running turn, and the agent reads it after its
 * current tool call or model step. Grok reads only the first text block and the images.
 */
const steer = Effect.fn("Grok.steer")(function* (
  connection: ClientSideConnection,
  message: { sessionId: string; messageId: string | null; blocks: ContentBlock[] },
) {
  const text = message.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
  const images = message.blocks.filter((block) => block.type === "image");
  // Grok refuses with an error, and it always answers `{ result: { status: "queued" } }` when it keeps
  // the message. Another check of the answer would put a message that Grok kept back in the queue.
  yield* providerCall(() =>
    connection.extMethod("_x.ai/interject", {
      sessionId: message.sessionId,
      text,
      ...(message.messageId ? { interjectionId: message.messageId } : {}),
      content: [{ type: "text", text }, ...images],
    }),
  );
});

function grokAccount(value: unknown): { email: string | null } {
  const email = getString(value, "email");
  return { email: email && email.length <= INPUT_LIMITS.email ? email : null };
}

function grokRateLimits(value: unknown): AccountRateLimitsReadResult {
  const config = getRecord(value, "config");
  const period = getRecord(config, "currentPeriod");
  if (!config || !period) return { rateLimits: null, rateLimitsByLimitId: null };
  const usedPercent = grokCreditUsagePercent(config);
  if (usedPercent === null) return { rateLimits: null, rateLimitsByLimitId: null };
  const start = Date.parse(getString(period, "start") ?? "");
  const end = Date.parse(getString(period, "end") ?? "");
  const durationMins = Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 60_000 : Number.NaN;
  const periodType = getString(period, "type") ?? getString(period, "periodType");
  const weekly = periodType ? periodType.toLowerCase().includes("weekly") : nearWeeklyDuration(durationMins);
  return {
    rateLimits: {
      limitId: "grok",
      primary: null,
      secondary: {
        usedPercent,
        windowDurationMins: Number.isFinite(durationMins) ? durationMins : weekly ? 10_080 : null,
        resetsAt: Number.isFinite(end) ? end / 1_000 : null,
      },
    },
    rateLimitsByLimitId: null,
  };
}

/**
 * Grok's billing service writes proto3 JSON, which omits a zero scalar: a period with no usage yet
 * has no `creditUsagePercent`, and a `$0` Cent arrives as `{}`. The Grok CLI reads both as 0, so a
 * current period with no percentage and no deprecated `monthlyLimit` above $0 means 0% used.
 */
function grokCreditUsagePercent(config: DynamicRecord): number | null {
  if (config.creditUsagePercent !== undefined) {
    return isNumber(config.creditUsagePercent) && Number.isFinite(config.creditUsagePercent)
      ? Math.max(0, Math.min(100, config.creditUsagePercent))
      : null;
  }
  const limit = grokCentValue(config, "monthlyLimit");
  if (limit === undefined || limit === 0) return 0;
  const used = grokCentValue(config, "used");
  if (limit === null || limit < 0 || used === null) return null;
  return Math.max(0, Math.min(100, ((used ?? 0) / limit) * 100));
}

/** `undefined` when the field is absent, `null` when it is malformed. */
function grokCentValue(config: DynamicRecord, key: string): number | null | undefined {
  if (config[key] === undefined) return undefined;
  const cent = getRecord(config, key);
  if (!cent) return null;
  if (cent.val === undefined) return 0;
  return isNumber(cent.val) && Number.isFinite(cent.val) ? cent.val : null;
}

function nearWeeklyDuration(durationMins: number): boolean {
  return Number.isFinite(durationMins) && Math.abs(durationMins - 10_080) <= 10_080 * 0.05;
}
