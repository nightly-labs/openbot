import type { AgentProviderStatus } from "@openbot/contracts/ipc";

/**
 * What "Copy diagnostics" puts on the clipboard: the provider's status row as JSON, for a bug report
 * or an agent that maintains the installation. The host redacted the text fields. The email is left
 * out, because a report is often pasted where other people read it.
 */
export function providerDiagnosticsText(status: AgentProviderStatus): string {
  return JSON.stringify(
    {
      provider: status.id,
      state: status.state,
      version: status.version,
      cliSource: status.cliSource ?? null,
      message: status.message,
      checkError: status.checkError ?? null,
      lastError: status.lastError ?? null,
      lastErrorAt: status.lastErrorAt === undefined ? null : new Date(status.lastErrorAt).toISOString(),
    },
    null,
    2,
  );
}
