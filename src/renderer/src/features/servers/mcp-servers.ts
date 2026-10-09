/**
 * What the MCP settings panel needs beyond the shared contract: a blank draft, a reopened draft,
 * the dirty check, and the badge text and variant.
 *
 * The types and the rules the main process also applies - validation, normalization, the id - live
 * in `@openbot/contracts/ipc` so that a saved row can never hold something the form never previewed.
 */

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
export { mcpConfigErrors, mcpConfigIsValid, normalizeMcpConfig } from "@openbot/contracts/ipc";

/** The badge variants this panel uses, narrowed from the shared `Badge` set. */
export type McpStatusVariant = "success-light" | "destructive-light" | "warning-light" | "secondary";

/**
 * What kind of failure a test answered, so the badge can tell a sign-in to finish from a server
 * that refused, never answered, never started, or could not be reached.
 */
export type McpFailureKind = "sign-in" | "refused" | "url" | "timeout" | "startup" | "unreachable" | "other";

/**
 * The failure kind of each sentence main or a host sends. Read from the English before it is
 * translated: the key is the contract, and text from an older host matches none and reads `other`.
 */
const FAILURE_KINDS: Partial<Record<string, McpFailureKind>> = {
  "error.backend.mcpSignInRequired": "sign-in",
  "error.backend.mcpSignInOnHost": "sign-in",
  "error.backend.mcpSignInTimedOut": "sign-in",
  "error.mcp.signInOnHost": "sign-in",
  "error.backend.mcpSignInNotAccepted": "refused",
  "error.backend.mcpServerHttpCredentials": "refused",
  "error.backend.mcpRegistrationRefused": "refused",
  "error.backend.mcpSignInNeedsHttps": "url",
  "error.backend.mcpServerHttpUrl": "url",
  "error.backend.mcpServerNoAnswer": "timeout",
  "error.backend.mcpSignInResponseTimedOut": "timeout",
  "error.backend.mcpServerExited": "startup",
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

/** Whether a test answered that the user cancelled a sign-in, which is not a failure to show. */
export function isMcpSignInCancelled(sourceText: string): boolean {
  return matchingSourceKeys(sourceText)[0] === "error.backend.mcpSignInCancelled";
}

/**
 * What the panel knows about one server's test, for as long as the panel is open.
 *
 * A test is a question the user asked once, not a state the app keeps: OpenBot connects only when
 * asked, and an answer from a minute ago is not a claim about now. Leaving the panel drops these.
 */
export type McpTestState =
  | { status: "testing" }
  /** A sign-in the user started, waiting for the browser to come back. */
  | { status: "signing-in" }
  | { status: "passed"; toolCount: number }
  | { status: "failed"; error: string; kind: McpFailureKind };

/** The sign-in states main answers with, as the lookup by row id the panel reads. */
export function mcpSignInRecord(states: readonly McpSignInState[]): Record<string, boolean> {
  return Object.fromEntries(states.map((state) => [state.mcpServerId, state.signedIn]));
}

/** The whole sentence a test produced, for the form. The row shows the short badge instead. */
export function mcpTestMessage(test: McpTestState, t: AppTranslate): string {
  if (test.status === "testing") return t("common.connecting");
  if (test.status === "signing-in") return t("mcp.panel.signInWaiting", { count: MCP_SIGN_IN_TIMEOUT_MS / 60_000 });
  if (test.status === "failed") return test.error;
  return t("mcp.test.connected", { count: test.toolCount });
}

/**
 * A blank draft. Each repeatable list starts with one empty row so the form opens showing the row
 * shape rather than only an "Add" button.
 */
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

/**
 * An existing configuration reopened for editing. Saving strips the empty rows, so a stored
 * configuration has none; put one back in each list to give the user somewhere to type.
 */
export function mcpConfigDraft(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    args: config.args.length > 0 ? [...config.args] : [""],
    env: config.env.length > 0 ? config.env.map((pair) => ({ ...pair })) : [{ key: "", value: "" }],
    envPassthrough: config.envPassthrough.length > 0 ? [...config.envPassthrough] : [""],
    headers: config.headers.length > 0 ? config.headers.map((pair) => ({ ...pair })) : [{ key: "", value: "" }],
  };
}

/**
 * Whether the form holds a change worth saving. The comparison is between the normalized values, so
 * adding an empty row, or typing a trailing space, does not count as an edit.
 */
export function mcpConfigChanged(draft: McpServerConfig, baseline: McpServerConfig): boolean {
  return JSON.stringify(normalizeMcpConfig(draft)) !== JSON.stringify(normalizeMcpConfig(baseline));
}

/**
 * The badge on a row. Without a test it says only what the user set, because that is all OpenBot
 * knows: a server is offered to this server's agents, or it is not. A test answers for itself, and
 * that answer is shown even on a server that is turned off, because the user asked for it.
 */
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

/**
 * The provider limit this configuration already carries, or `null`.
 *
 * Not a health claim, and so not the stored state the note above rules out: it is read from the
 * saved row alone, it needs no connection, and it is the same answer every time until the user
 * edits the field. A server that names a working directory reaches Claude and the test and no
 * other provider, which the user should be able to see without starting an agent to find out.
 */
export function mcpProviderLimitNote(config: McpServerConfig, t: AppTranslate): string | null {
  if (config.transport !== "stdio" || !config.workingDirectory.trim()) return null;
  return t("mcp.server.providerLimitNote");
}

/**
 * What the panel says about the runtime a local stdio server is started with, or `null` when there
 * is nothing to say.
 *
 * Silent while it is ready or has not started, because a working computer needs no sentence about
 * it. It is a property of this computer, not of any row, so the caller passes it only for the local
 * server; a remote host downloads its own.
 */
export function mcpToolRuntimeNote(status: ProviderRuntimeStatus | undefined): string | null {
  const { t } = currentText();
  if (status?.phase === "downloading" || status?.phase === "finishing") {
    if (status.progress === null) return t("mcp.server.runtimeDownloading");
    const percent = Math.round(Math.max(0, Math.min(100, status.progress)));
    return t("mcp.server.runtimeDownloadingProgress", { percent });
  }
  // The download failed and nothing retries it on its own, so the sentence has to say what is left:
  // a computer with its own Node keeps working, because the managed runtime is the floor under that
  // and not a replacement for it.
  if (status?.phase === "download-error") return t("mcp.server.runtimeDownloadFailed");
  return null;
}
