import { Effect } from "effect";
// Signing in to a provider, storing the optional provider API keys, and downloading the CLI
// runtimes the providers need.

import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { SetProviderApiKeyInput } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { shell } from "electron";
import { AgentLifecycleFailed, type AgentService } from "../../backend/agent-service";
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
        Effect.runPromise(
          service
            .connectProvider(provider, async (value) => {
              const url = new URL(value);
              if (url.protocol !== "https:") throw new Error("Only HTTPS ChatGPT login links can open in the browser.");
              await shell.openExternal(url.toString());
            })
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      updateProviderCli: payloadHandler(parseManagedProviderId, async (provider) => {
        await Effect.runPromise(
          providerRuntimes.downloadAndWait(provider).pipe(Effect.mapError((error) => error.cause)),
        );
        return service.getStatus();
      }),
      refreshAgentProviders: handler(() =>
        Effect.runPromise(service.refreshProviders().pipe(Effect.mapError((error) => error.cause))),
      ),
      restartProvider: payloadHandler(parseProviderId, (provider) =>
        Effect.runPromise(service.restartProvider(provider).pipe(Effect.mapError((error) => error.cause))),
      ),
      cancelProviderRestart: payloadHandler(parseProviderId, async (provider) =>
        service.cancelProviderRestart(provider),
      ),
      // The code and the page it is typed on come back; nothing the code is later traded for does.
      startProviderCodeLogin: payloadHandler(parseProviderId, (provider) =>
        Effect.runPromise(service.startProviderCodeLogin(provider).pipe(Effect.mapError((error) => error.cause))),
      ),
      cancelProviderCodeLogin: payloadHandler(parseProviderId, (provider) =>
        Effect.runPromise(service.cancelProviderCodeLogin(provider).pipe(Effect.mapError((error) => error.cause))),
      ),
      // The key and the process that uses it change as one step, because the catalog the CLI
      // advertises is decided at spawn time: the service writes the key only when it can restart
      // the provider on it, and reports success only once the new process is up.
      setProviderApiKey: payloadHandler(parseProviderApiKeyInput, ({ provider, key }) =>
        Effect.runPromise(
          service
            .changeProviderCredential(provider, () =>
              credentials
                .set(provider, key)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                  ),
                ),
            )
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      clearProviderApiKey: payloadHandler(parseProviderId, (provider) =>
        Effect.runPromise(
          service
            .changeProviderCredential(provider, () =>
              credentials
                .clear(provider)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                  ),
                ),
            )
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      // A status, never the key: see `setProviderApiKey` in the desktop API contract.
      getProviderApiKeyState: payloadHandler(parseProviderId, async (provider) => ({
        provider,
        status: credentials.status(provider),
      })),
    },
    providerRuntimes: {
      getStatus: handler(() => providerRuntimes.getStatus()),
      download: payloadHandler(parseManagedProviderId, (parsed) =>
        Effect.runPromise(providerRuntimes.download(parsed).pipe(Effect.mapError((error) => error.cause))),
      ),
      cancel: payloadHandler(parseManagedProviderId, (parsed) =>
        Effect.runPromise(providerRuntimes.cancel(parsed).pipe(Effect.mapError((error) => error.cause))),
      ),
      checkForUpdates: handler(() =>
        Effect.runPromise(providerRuntimes.checkForUpdates().pipe(Effect.mapError((error) => error.cause))),
      ),
    },
  };
}

/**
 * The decoder every provider key passes through before it reaches the operating system's cipher.
 *
 * Exported for the test that holds it to its limits: this is the one place a renderer-supplied
 * secret enters the main process, and each rule here decides what `safeStorage` is asked to keep.
 */
export function parseProviderApiKeyInput(value: unknown): SetProviderApiKeyInput {
  if (!isDynamicRecord(value)) throw new Error(sourceText("error.provider.keyRequired"));
  const provider = parseProviderId(value.provider);
  if (!isString(value.key) || !value.key.trim()) throw new Error(sourceText("error.provider.keyRequired"));
  if (value.key.length > MAX_API_KEY_LENGTH) throw new Error(sourceText("error.provider.keyTooLong"));
  return { provider, key: value.key.trim() };
}

export function parseManagedProviderId(value: unknown): ManagedProviderId {
  const provider = parseProviderId(value);
  if (!isManagedRuntimeProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
  return provider;
}
