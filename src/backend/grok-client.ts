import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClientSideConnection, ContentBlock, InitializeResponse } from "@agentclientprotocol/sdk";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type DynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { parse as parseToml } from "smol-toml";
import { AcpAgentClient, type AcpHistoryPersistence } from "./acp-client";
import { GROK_ACP_FLAVOR } from "./acp-flavor";
import type { ImageFitter } from "./agent/image-reader";
import type { GrokCliInfo } from "./cli";
import { isMissingFileError } from "./file-errors";
import { MCP_STDIO_PROBE_TIMEOUT_MS } from "./mcp-probe";
import type { McpDropReporter, McpEndpointSource, McpServerSource, McpToolRuntimeSource } from "./mcp-provider-shapes";
import { confineSpawnTarget, grokHomeDirectory, grokStatePaths, type ProcessConfinement } from "./process-confinement";
import { type AccountRateLimitsReadResult, getRecord, getString, isRecord } from "./protocol";
import { providerCall } from "./provider-client-effects";

export class GrokAgentClient extends AcpAgentClient {
  constructor(
    cli: GrokCliInfo,
    requestTimeoutMs = 30_000,
    profileGeneration: boolean | "media" = false,
    mcpServers: McpServerSource = () => [],
    reportMcpDrops?: McpDropReporter,
    mcpToolRuntimes?: McpToolRuntimeSource,
    mcpEndpoint?: McpEndpointSource,
    confinement?: ProcessConfinement,
    agentEnvironment?: () => Readonly<Record<string, string>>,
    history?: AcpHistoryPersistence,
    fitImage?: ImageFitter | null,
    discoveryFolder?: () => string,
  ) {
    let usedDiscoveryCwd: string | null = null;
    const discoveryCwd =
      discoveryFolder &&
      (() => {
        const cwd = realpathSync(discoveryFolder());
        usedDiscoveryCwd = cwd;
        return cwd;
      });
    super(cli, requestTimeoutMs, {
      provider: "grok",
      flavor: discoveryCwd
        ? {
            ...GROK_ACP_FLAVOR,
            sessionFiles: (_argv, sessionId) =>
              usedDiscoveryCwd
                ? grokDiscoverySessionFiles(
                    grokHomeDirectory({ ...process.env, ...agentEnvironment?.() }),
                    usedDiscoveryCwd,
                    sessionId,
                  )
                : [],
          }
        : GROK_ACP_FLAVOR,
      ...(discoveryCwd ? { discoveryCwd } : {}),
      ...(confinement
        ? {
            confine: (target) =>
              confineSpawnTarget(target, confinement, grokStatePaths({ ...process.env, ...agentEnvironment?.() })),
          }
        : {}),
      profileGeneration: profileGeneration !== false,
      mediaGeneration: profileGeneration === "media",
      mcpServers: profileGeneration !== false ? () => [] : mcpServers,
      reportMcpDrops,
      mcpToolRuntimes,
      mcpEndpoint,
      fitImage,
      argv: [
        "--no-auto-update",
        ...(profileGeneration === "media"
          ? [
              "--no-subagents",
              "--disable-web-search",
              ...GROK_NON_MEDIA_TOOLS.flatMap((tool) => ["--deny", tool]),
              "--deny",
              "mcp__*",
            ]
          : profileGeneration
            ? ["--tools=", "--deny", "*", "--no-subagents", "--disable-web-search"]
            : // Grok asks OpenBot before a tool that needs approval, and the agent's access decides.
              ["--permission-mode", "default"]),
        "agent",
        "stdio",
      ],
      env: { GROK_OAUTH2_REFERRER: "openbot" },
      extraEnv: () => {
        const environment = { ...agentEnvironment?.() };
        const merged = { ...process.env, ...environment };
        return { ...grokFeatureEnvironment(merged), ...grokMcpStartupEnvironment(merged), ...environment };
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

const GROK_SESSION_ID = /^[\w-]+$/u;

function grokDiscoverySessionFiles(grokHome: string, cwd: string, sessionId: string): string[] {
  if (!GROK_SESSION_ID.test(sessionId)) return [];
  return [join(grokHome, "sessions", encodeURIComponent(cwd), sessionId)];
}

const GROK_NON_MEDIA_TOOLS = [
  "run_terminal_command",
  "read_file",
  "search_replace",
  "write",
  "list_dir",
  "grep",
  "kill_command_or_subagent",
  "get_command_or_subagent_output",
  "todo_write",
  "scheduler_create",
  "scheduler_delete",
  "scheduler_list",
  "monitor",
  "search_tool",
  "use_tool",
  "workflow",
  "enter_plan_mode",
  "exit_plan_mode",
  "ask_user_question",
  "send_feedback",
  "web_search",
  "web_fetch",
] as const;

const GROK_FEATURE_SWITCHES: ReadonlyArray<{ key: string; env: string }> = [
  { key: "features.feedback", env: "GROK_FEEDBACK_ENABLED" },
  { key: "workflows.enabled", env: "GROK_WORKFLOWS" },
  { key: "features.turn_summary", env: "GROK_TURN_SUMMARY" },
  { key: "compat.claude.skills", env: "GROK_CLAUDE_SKILLS_ENABLED" },
];

function grokFeatureEnvironment(env: NodeJS.ProcessEnv, home = homedir()): Record<string, string> {
  const layers = grokConfigLayers(env, grokHomeDirectory(env, home));
  if (!layers) return {};
  return Object.fromEntries(
    GROK_FEATURE_SWITCHES.filter(
      (feature) => !env[feature.env]?.trim() && !layers.some((layer) => hasConfigKey(layer, feature.key)),
    ).map((feature) => [feature.env, "0"]),
  );
}

function grokMcpStartupEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  if (env.MCP_TIMEOUT?.trim() || env.GROK_MCP_STARTUP_TIMEOUT_SECS?.trim()) return {};
  return { GROK_MCP_STARTUP_TIMEOUT_SECS: String(MCP_STDIO_PROBE_TIMEOUT_MS / 1_000) };
}

function grokConfigLayers(env: NodeJS.ProcessEnv, grokHome: string): DynamicRecord[] | null {
  const files = [join(grokHome, "managed_config.toml"), join(grokHome, "config.toml"), env.GROK_CONFIG_PATH?.trim()];
  const inline = env.GROK_CONFIG?.trim();
  try {
    const layers = files.flatMap((file) => {
      const text = file ? readOptionalFile(file) : null;
      if (text === null) return [];
      return [file?.endsWith(".json") ? JSON.parse(text) : parseToml(text)];
    });
    if (inline) layers.push(JSON.parse(inline));
    return layers.every(isRecord) ? layers : null;
  } catch {
    return null;
  }
}

function readOptionalFile(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function hasConfigKey(layer: DynamicRecord, key: string): boolean {
  const [part = "", ...rest] = key.split(".");
  if (!Object.hasOwn(layer, part)) return false;
  if (rest.length === 0) return true;
  const value = layer[part];
  return isRecord(value) && hasConfigKey(value, rest.join("."));
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

const steer = Effect.fn("Grok.steer")(function* (
  connection: ClientSideConnection,
  message: { sessionId: string; messageId: string | null; blocks: ContentBlock[] },
) {
  const text = message.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
  const images = message.blocks.filter((block) => block.type === "image");
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
