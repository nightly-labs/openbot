import {
  MCP_SIGN_IN_TIMEOUT_MS,
  type McpServerConfig,
  type McpSignInState,
  normalizeMcpConfig,
  type ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { type AppTextKey, type AppTranslate, matchingSourceKeys } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";

export type {
  McpServerConfig,
  McpSignInState,
  McpTestResult,
} from "@openbot/contracts/ipc";
export { isMcpHeaderName, mcpConfigErrors, mcpConfigIsValid, normalizeMcpConfig } from "@openbot/contracts/ipc";

export type McpStatusVariant = "success-light" | "destructive-light" | "warning-light" | "secondary";

export type McpFailureKind = "sign-in" | "refused" | "url" | "timeout" | "startup" | "unreachable" | "other";

const FAILURE_KINDS: Partial<Record<string, McpFailureKind>> = {
  "error.backend.mcpSignInRequired": "sign-in",
  "error.backend.mcpSignInOnHost": "sign-in",
  "error.backend.mcpSignInTimedOut": "sign-in",
  "error.backend.mcpSignInRefused": "sign-in",
  "error.mcp.signInOnHost": "sign-in",
  "error.backend.mcpSignInNotAccepted": "refused",
  "error.backend.mcpSignInAccountRefused": "refused",
  "error.backend.mcpServerHttpCredentials": "refused",
  "error.backend.mcpServerBearerKey": "refused",
  "error.backend.mcpRegistrationRefused": "refused",
  "error.backend.mcpSignInAppRefused": "refused",
  "error.backend.mcpSignInNeedsHttps": "url",
  "error.backend.mcpServerHttpUrl": "url",
  "error.backend.mcpServerNoAnswer": "timeout",
  "error.backend.mcpSignInResponseTimedOut": "timeout",
  "error.backend.mcpServerExited": "startup",
  "error.backend.mcpServerExitedWithOutput": "startup",
  "error.backend.mcpCommandNotFound": "startup",
  "error.backend.mcpRemoteBridge": "startup",
  "error.backend.mcpServerUnreachable": "unreachable",
};

const FAILURE_LABELS = {
  "sign-in": "mcp.status.signInNeeded",
  refused: "mcp.status.refused",
  url: "mcp.status.checkUrl",
  timeout: "mcp.status.noAnswer",
  startup: "mcp.status.didNotStart",
  unreachable: "mcp.status.unreachable",
  other: "mcp.status.failed",
} as const satisfies Record<McpFailureKind, AppTextKey>;

export function mcpFailureKind(sourceText: string): McpFailureKind {
  const key = matchingSourceKeys(sourceText)[0];
  return (key && FAILURE_KINDS[key]) || "other";
}

export function isMcpSignInOnHost(sourceText: string): boolean {
  return matchingSourceKeys(sourceText)[0] === "error.backend.mcpSignInOnHost";
}

export function isMcpSignInCancelled(sourceText: string): boolean {
  return matchingSourceKeys(sourceText)[0] === "error.backend.mcpSignInCancelled";
}

export type McpTestState =
  | { status: "testing" }
  | { status: "signing-in" }
  | { status: "passed"; toolCount: number }
  | { status: "failed"; error: string; kind: McpFailureKind };

export function mcpSignInRecord(states: readonly McpSignInState[]): Record<string, McpSignInState> {
  return Object.fromEntries(states.map((state) => [state.mcpServerId, state]));
}

export function mcpTestMessage(test: McpTestState, t: AppTranslate, hostName?: string | undefined): string {
  if (test.status === "testing") return t("common.connecting");
  if (test.status === "signing-in") {
    const count = MCP_SIGN_IN_TIMEOUT_MS / 60_000;
    return hostName
      ? t("mcp.panel.signInWaitingOn", { count, host: hostName })
      : t("mcp.panel.signInWaiting", { count });
  }
  if (test.status === "failed") return test.error;
  return t("mcp.test.connected", { count: test.toolCount });
}

export function emptyMcpConfig(): McpServerConfig {
  return {
    id: "",
    name: "",
    transport: "stdio",
    enabled: true,
    command: "",
    args: [""],
    env: [{ key: "", value: "" }],
    envPassthrough: [""],
    workingDirectory: "",
    url: "",
    headers: [{ key: "", value: "" }],
  };
}

export function mcpConfigDraft(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    args: config.args.length > 0 ? [...config.args] : [""],
    env: config.env.length > 0 ? config.env.map((pair) => ({ ...pair })) : [{ key: "", value: "" }],
    envPassthrough: config.envPassthrough.length > 0 ? [...config.envPassthrough] : [""],
    headers: config.headers.length > 0 ? config.headers.map((pair) => ({ ...pair })) : [{ key: "", value: "" }],
  };
}

export function mcpConfigChanged(draft: McpServerConfig, baseline: McpServerConfig): boolean {
  return JSON.stringify(normalizeMcpConfig(draft)) !== JSON.stringify(normalizeMcpConfig(baseline));
}

export function mcpSaveConnects(draft: McpServerConfig, baseline: McpServerConfig, isNew: boolean): boolean {
  if (draft.transport !== "http") return false;
  if (isNew || baseline.transport !== "http") return true;
  const next = normalizeMcpConfig(draft);
  const stored = normalizeMcpConfig(baseline);
  return next.url !== stored.url || JSON.stringify(next.headers) !== JSON.stringify(stored.headers);
}

export function isMcpHttpAddress(value: string): boolean {
  return /^https?:\/\/\S/i.test(value.trim());
}

export function mcpStatusLabel(config: McpServerConfig, t: AppTranslate, test?: McpTestState): string {
  if (test?.status === "testing") return t("mcp.status.testing");
  if (test?.status === "signing-in") return t("mcp.status.signingIn");
  if (test?.status === "failed") return t(FAILURE_LABELS[test.kind]);
  if (test) return mcpTestMessage(test, t);
  return config.enabled ? t("mcp.status.enabled") : t("mcp.status.disabled");
}

export function mcpStatusVariant(test?: McpTestState): McpStatusVariant {
  if (test?.status === "failed") return test.kind === "sign-in" ? "warning-light" : "destructive-light";
  if (test?.status === "passed") return "success-light";
  return "secondary";
}

export function mcpProviderLimitNote(config: McpServerConfig, t: AppTranslate): string | null {
  if (config.transport !== "stdio" || !config.workingDirectory.trim()) return null;
  return t("mcp.server.providerLimitNote");
}

export function mcpToolRuntimeNote(status: ProviderRuntimeStatus | undefined): string | null {
  const { t } = currentText();
  if (status?.phase === "downloading" || status?.phase === "finishing") {
    if (status.progress === null) return t("mcp.server.runtimeDownloading");
    const percent = Math.round(Math.max(0, Math.min(100, status.progress)));
    return t("mcp.server.runtimeDownloadingProgress", { percent });
  }
  if (status?.phase === "download-error") return t("mcp.server.runtimeDownloadFailed");
  return null;
}
