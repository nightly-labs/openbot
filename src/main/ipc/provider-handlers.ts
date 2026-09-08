// Signing in to Codex, Claude and Grok, and downloading the CLI runtimes they need.

import type { AgentProviderId, AgentStatus } from "@openbot/contracts/ipc";
import { shell } from "electron";
import type { AgentService } from "../../backend/agent-service";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import { parseProviderId } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface ProviderIpcDependencies {
  service: AgentService;
  providerRuntimes: ProviderRuntimeManager;
}

export function providerIpcHandlers({
  service,
  providerRuntimes,
}: ProviderIpcDependencies): Pick<IpcGroupHandlers, "providers" | "providerRuntimes"> {
  return {
    providers: {
      connectProvider: payloadHandler(parseProviderId, (provider) =>
        service.connectProvider(provider, async (value) => {
          const url = new URL(value);
          if (url.protocol !== "https:") throw new Error("Only HTTPS ChatGPT login links can open in the browser.");
          await shell.openExternal(url.toString());
        }),
      ),
      /*
       * The CLI's own updater decides what it installs, and it can finish on the version it started
       * on. The runtime manager owns the offer, so it is told the outcome and can stop repeating one
       * the updater has already turned down.
       */
      updateProviderCli: payloadHandler(parseProviderId, async (provider) => {
        const before = systemCliVersion(service.getStatus(), provider);
        const status = await service.updateProviderCli(provider);
        await providerRuntimes.noteSystemCliUpdate(provider, before, systemCliVersion(status, provider));
        return status;
      }),
      refreshAgentProviders: handler(() => service.refreshProviders()),
    },
    providerRuntimes: {
      getStatus: handler(() => providerRuntimes.getStatus()),
      download: payloadHandler(parseProviderId, (parsed) => providerRuntimes.download(parsed)),
      cancel: payloadHandler(parseProviderId, (parsed) => providerRuntimes.cancel(parsed)),
    },
  };
}

/** The version of a provider CLI the user installed themselves, or `null` for a managed copy. */
function systemCliVersion(status: AgentStatus, provider: AgentProviderId): string | null {
  const entry = status.providers?.find((candidate) => candidate.id === provider);
  return entry?.cliSource === "system" ? (entry.version ?? null) : null;
}
