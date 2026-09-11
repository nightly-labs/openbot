import type { ClientSideConnection, InitializeResponse } from "@agentclientprotocol/sdk";
import { type DynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { AcpAgentClient } from "./acp-client";
import type { GrokCliInfo } from "./cli";
import type { CustomMcpSource } from "./custom-mcp";
import { type AccountRateLimitsReadResult, getRecord, getString } from "./protocol";

export class GrokAgentClient extends AcpAgentClient {
  constructor(
    cli: GrokCliInfo,
    requestTimeoutMs = 30_000,
    profileGeneration = false,
    userMcpServers?: CustomMcpSource,
    mcpFullAccess?: () => boolean,
  ) {
    super(cli, requestTimeoutMs, {
      provider: "grok",
      profileGeneration,
      argv: [
        "--no-auto-update",
        ...(profileGeneration ? ["--tools=", "--deny", "*", "--no-subagents", "--disable-web-search"] : []),
        "agent",
        "stdio",
      ],
      env: { GROK_OAUTH2_REFERRER: "openbot" },
      signInMessage: "Run `grok login` or set XAI_API_KEY to use Grok.",
      authenticate,
      readRateLimits: async (connection) => grokRateLimits(await connection.extMethod("_x.ai/billing", {})),
      userMcpServers,
      mcpFullAccess,
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
  if (!weekly) return { rateLimits: null, rateLimitsByLimitId: null };
  return {
    rateLimits: {
      limitId: "grok",
      primary: null,
      secondary: {
        usedPercent,
        windowDurationMins: Number.isFinite(durationMins) ? durationMins : 10_080,
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
  const used = grokCentValue(config, "used");
  if (limit === null || limit <= 0 || used === null) return null;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function grokCentValue(config: DynamicRecord, key: string): number | null {
  const cent = getRecord(config, key);
  if (!cent) return null;
  return isNumber(cent.val) && Number.isFinite(cent.val) ? cent.val : null;
}

function nearWeeklyDuration(durationMins: number): boolean {
  return Number.isFinite(durationMins) && Math.abs(durationMins - 10_080) <= 10_080 * 0.05;
}
