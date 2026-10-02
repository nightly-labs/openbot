import type { ClientSideConnection, InitializeResponse } from "@agentclientprotocol/sdk";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type DynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { AcpAgentClient } from "./acp-client";
import type { GrokCliInfo } from "./cli";
import type {
  McpAuthorizationSource,
  McpDropReporter,
  McpServerSource,
  McpToolRuntimeSource,
} from "./mcp-provider-shapes";
import { confineSpawnTarget, grokStatePaths, type ProcessConfinement } from "./process-confinement";
import { type AccountRateLimitsReadResult, getRecord, getString } from "./protocol";

export class GrokAgentClient extends AcpAgentClient {
  constructor(
    cli: GrokCliInfo,
    requestTimeoutMs = 30_000,
    profileGeneration = false,
    mcpServers: McpServerSource = () => [],
    reportMcpDrops?: McpDropReporter,
    mcpToolRuntimes?: McpToolRuntimeSource,
    mcpAuthorization?: McpAuthorizationSource,
    confinement?: ProcessConfinement,
    agentEnvironment?: () => Readonly<Record<string, string>>,
  ) {
    super(cli, requestTimeoutMs, {
      provider: "grok",
      ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, grokStatePaths()) } : {}),
      profileGeneration,
      // A profile-generation client asks one question and must not act, so it is given none.
      mcpServers: profileGeneration ? () => [] : mcpServers,
      reportMcpDrops,
      mcpToolRuntimes,
      mcpAuthorization,
      argv: [
        "--no-auto-update",
        ...(profileGeneration ? ["--tools=", "--deny", "*", "--no-subagents", "--disable-web-search"] : []),
        "agent",
        "stdio",
      ],
      env: { GROK_OAUTH2_REFERRER: "openbot" },
      ...(agentEnvironment ? { extraEnv: () => ({ ...agentEnvironment() }) } : {}),
      signInMessage: sourceText("error.provider.grokSignIn"),
      authenticate,
      readAccount: async (connection) => grokAccount(await connection.extMethod("_x.ai/auth/info", {})),
      readRateLimits: async (connection) => grokRateLimits(await connection.extMethod("_x.ai/billing", {})),
    });
  }
}

async function authenticate(connection: ClientSideConnection, initialization: InitializeResponse): Promise<void> {
  const authMethod = process.env.XAI_API_KEY?.trim() ? "xai.api_key" : "cached_token";
  const advertised = initialization.authMethods ?? [];
  const selected =
    advertised.find((method) => method.id === authMethod) ?? advertised.find((method) => method.id === "cached_token");
  if (selected) await connection.authenticate({ methodId: selected.id });
}

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
 * current period with neither the percentage nor the deprecated `monthlyLimit` means 0% used.
 */
function grokCreditUsagePercent(config: DynamicRecord): number | null {
  if (config.creditUsagePercent !== undefined) {
    return isNumber(config.creditUsagePercent) && Number.isFinite(config.creditUsagePercent)
      ? Math.max(0, Math.min(100, config.creditUsagePercent))
      : null;
  }
  const limit = grokCentValue(config, "monthlyLimit");
  if (limit === undefined) return 0;
  const used = grokCentValue(config, "used");
  if (limit === null || limit <= 0 || used === null) return null;
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
