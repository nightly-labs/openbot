// Signing in to Codex, Claude and Grok, and downloading the CLI runtimes they need.

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
      refreshAgentProviders: handler(() => service.refreshProviders()),
    },
    providerRuntimes: {
      getStatus: handler(() => providerRuntimes.getStatus()),
      download: payloadHandler(parseProviderId, (parsed) => providerRuntimes.download(parsed)),
      cancel: payloadHandler(parseProviderId, (parsed) => providerRuntimes.cancel(parsed)),
    },
  };
}
