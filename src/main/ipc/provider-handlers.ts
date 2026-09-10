// Signing in to a provider, storing the optional provider API keys, and downloading the CLI
// runtimes the providers need.

import { isManagedRuntimeProvider } from "@openbot/contracts/agent-providers";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { shell } from "electron";
import type { AgentService } from "../../backend/agent-service";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import { parseProviderId } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

/** Long enough for any key a provider issues, short enough that nothing large reaches the cipher. */
const MAX_API_KEY_LENGTH = 512;

export interface ProviderIpcDependencies {
  service: AgentService;
  providerRuntimes: ProviderRuntimeManager;
  credentials: ProviderCredentialStore;
}

export function providerIpcHandlers({
  service,
  providerRuntimes,
  credentials,
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
      updateProviderCli: payloadHandler(parseManagedProviderId, async (provider) => {
        await providerRuntimes.downloadAndWait(provider);
        return service.getStatus();
      }),
      refreshAgentProviders: handler(() => service.refreshProviders()),
      // The key and the process that uses it change as one step, because the catalog the CLI
      // advertises is decided at spawn time: the service writes the key only when it can restart
      // the provider on it, and reports success only once the new process is up.
      setProviderApiKey: payloadHandler(parseProviderApiKeyInput, ({ provider, key }) =>
        service.changeProviderCredential(provider, () => credentials.set(provider, key)),
      ),
      clearProviderApiKey: payloadHandler(parseProviderId, (provider) =>
        service.changeProviderCredential(provider, () => credentials.clear(provider)),
      ),
      // A status, never the key: see `setProviderApiKey` in the desktop API contract.
      getProviderApiKeyState: payloadHandler(parseProviderId, async (provider) => ({
        provider,
        status: credentials.status(provider),
      })),
    },
    providerRuntimes: {
      getStatus: handler(() => providerRuntimes.getStatus()),
      download: payloadHandler(parseManagedProviderId, (parsed) => providerRuntimes.download(parsed)),
      cancel: payloadHandler(parseManagedProviderId, (parsed) => providerRuntimes.cancel(parsed)),
    },
  };
}

/**
 * The decoder every provider key passes through before it reaches the operating system's cipher.
 *
 * Exported for the test that holds it to its limits: this is the one place a renderer-supplied
 * secret enters the main process, and each rule here decides what `safeStorage` is asked to keep.
 */
export function parseProviderApiKeyInput(value: unknown): { provider: AgentProviderId; key: string } {
  if (!isDynamicRecord(value)) throw new Error("A provider key is required.");
  const provider = parseProviderId(value.provider);
  if (!isString(value.key) || !value.key.trim()) throw new Error("A provider key is required.");
  if (value.key.length > MAX_API_KEY_LENGTH) throw new Error("The provider key is too long.");
  return { provider, key: value.key.trim() };
}

function parseManagedProviderId(value: unknown) {
  const provider = parseProviderId(value);
  if (!isManagedRuntimeProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
  return provider;
}
