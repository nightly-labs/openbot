import type { AgentProviderStatus } from "@openbot/contracts/ipc";

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
