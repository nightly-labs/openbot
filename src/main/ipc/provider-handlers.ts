import {
  agentProviderDescriptor,
  agentProviderName,
  type DownloadableProviderId,
  isDownloadableProvider,
  isManagedRuntimeProvider,
  type ManagedProviderId,
} from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type ConnectProviderAccountInput,
  type ConnectProviderAccountKeyInput,
  isProviderAccountId,
  isProviderAccountPoolStrategy,
  MAX_PROVIDER_ACCOUNTS,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type RemoveProviderAccountInput,
  type RenameProviderAccountInput,
  type ResetProviderUsageInput,
  type SetLiveVoiceAccountInput,
  type SetProviderAccountPoolInput,
  type SetProviderApiKeyInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { decodeLiveVoiceAccount } from "@openbot/contracts/team-protocol/live-voice-account-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { AgentLifecycleFailed, type AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { SignInRegion } from "../../backend/kimi-region";
import type { LocalSignInPages } from "../local-sign-in-pages";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import { parseProviderId } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { optionalPayload, requireString } from "./validation";

const MAX_API_KEY_LENGTH = 512;

export interface ProviderIpcDependencies {
  service: AgentService;
  providerRuntimes: ProviderRuntimeManager;
  credentials: ProviderCredentialStore;
  openLink: (url: string) => Promise<void>;
  signInPages: Pick<LocalSignInPages, "opened" | "forget">;
}

export function providerIpcHandlers({
  service,
  providerRuntimes,
  credentials,
  openLink,
  signInPages,
}: ProviderIpcDependencies): Pick<IpcGroupHandlers, "providers" | "providerRuntimes"> {
  async function connect(provider: AgentProviderId, region: SignInRegion) {
    await runCauseEffect(providerRuntimes.ensureKeyProviderCli(provider));
    signInPages.forget(provider);
    return runCauseEffect(
      service.connectProvider(
        provider,
        async (value) => {
          const url = new URL(value);
          if (url.protocol !== "https:") throw new Error(sourceText("error.provider.httpsSignInLinkOnly"));
          signInPages.opened(provider, url.toString());
          await openLink(url.toString());
        },
        region,
      ),
    );
  }

  return {
    providers: {
      setProviderOn: payloadHandler(parseProviderUseInput, ({ provider, on }) =>
        runCauseEffect(service.setProviderOn(provider, on)),
      ),
      connectProvider: payloadHandler(parseProviderId, (provider) => connect(provider, "global")),
      connectProviderInMainlandChina: payloadHandler(parseProviderId, (provider) => {
        if (!agentProviderDescriptor(provider).mainlandChinaSignInSite) {
          throw new Error(
            sourceText("error.provider.noMainlandChinaSignIn", { provider: agentProviderName(provider) }),
          );
        }
        return connect(provider, "mainland-cn");
      }),
      cancelProviderSignIn: payloadHandler(parseProviderId, (provider) => {
        signInPages.forget(provider);
        return runCauseEffect(service.cancelProviderSignIn(provider));
      }),
      updateProviderCli: payloadHandler(parseManagedProviderId, async (provider) => {
        await runCauseEffect(providerRuntimes.downloadAndWait(provider));
        return service.getStatus();
      }),
      refreshAgentProviders: payloadHandler(optionalPayload(parseRefreshProvidersInput), (input) =>
        runCauseEffect(service.refreshProviders({ automatic: input?.automatic === true })),
      ),
      restartProvider: payloadHandler(parseProviderId, (provider) => runCauseEffect(service.restartProvider(provider))),
      cancelProviderRestart: payloadHandler(parseProviderId, async (provider) =>
        service.cancelProviderRestart(provider),
      ),
      chooseInstalledCli: payloadHandler(parseInstalledCliChoice, ({ provider, installed }) =>
        runCauseEffect(service.chooseInstalledCli(provider, installed)),
      ),
      startProviderCodeLogin: payloadHandler(parseProviderId, (provider) =>
        runCauseEffect(service.startProviderCodeLogin(provider, true)),
      ),
      cancelProviderCodeLogin: payloadHandler(parseProviderId, (provider) =>
        runCauseEffect(service.cancelProviderCodeLogin(provider)),
      ),
      setProviderApiKey: payloadHandler(parseProviderApiKeyInput, async ({ provider, key }) => {
        if (provider === "codex") return signInCodexWithApiKey(service, key);
        await runCauseEffect(providerRuntimes.ensureKeyProviderCli(provider));
        return runCauseEffect(
          service.changeProviderCredential(provider, () =>
            credentials
              .set(provider, key)
              .pipe(
                Effect.mapError(
                  (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                ),
              ),
          ),
        );
      }),
      clearProviderApiKey: payloadHandler(parseProviderId, (provider) =>
        runCauseEffect(
          service.clearProviderCredential(provider, () =>
            credentials
              .clear(provider)
              .pipe(
                Effect.mapError(
                  (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                ),
              ),
          ),
        ),
      ),
      connectProviderAccount: payloadHandler(parseConnectProviderAccountInput, ({ provider, accountId }) =>
        runCauseEffect(
          service.connectProviderAccount(provider, accountId, async (value) => {
            const url = new URL(value);
            if (url.protocol !== "https:") throw new Error(sourceText("error.provider.httpsSignInLinkOnly"));
            await openLink(url.toString());
          }),
        ),
      ),
      connectProviderAccountKey: payloadHandler(parseConnectProviderAccountKeyInput, ({ provider, accountId, key }) =>
        runCauseEffect(service.connectProviderAccountKey(provider, accountId, key)),
      ),
      cancelProviderAccountSignIn: payloadHandler(parseRemoveProviderAccountInput, ({ provider, accountId }) =>
        runCauseEffect(service.cancelProviderAccountSignIn(provider, accountId)),
      ),
      renameProviderAccount: payloadHandler(parseRenameProviderAccountInput, ({ provider, accountId, label }) =>
        runCauseEffect(service.renameProviderAccount(provider, accountId, label)),
      ),
      removeProviderAccount: payloadHandler(parseRemoveProviderAccountInput, ({ provider, accountId }) =>
        runCauseEffect(service.removeProviderAccount(provider, accountId)),
      ),
      setProviderAccountPool: payloadHandler(
        parseSetProviderAccountPoolInput,
        ({ provider, enabled, leftOut, strategy }) =>
          runCauseEffect(service.setProviderAccountPool(provider, enabled, leftOut, strategy)),
      ),
      setLiveVoiceAccount: payloadHandler(parseSetLiveVoiceAccountInput, ({ accountId }) =>
        runCauseEffect(service.setLiveVoiceAccount(accountId)),
      ),
      signOutProvider: payloadHandler(parseProviderId, (provider) => runCauseEffect(service.signOutProvider(provider))),
      providerUsageResets: payloadHandler(parseProviderId, (provider) =>
        runCauseEffect(service.providerUsageResets(provider)),
      ),
      resetProviderUsage: payloadHandler(parseResetProviderUsageInput, ({ provider, accountId }) =>
        runCauseEffect(service.resetProviderUsage(provider, accountId)),
      ),
      getProviderApiKeyState: payloadHandler(parseProviderId, async (provider) => ({
        provider,
        status: credentials.status(provider),
      })),
    },
    providerRuntimes: {
      getStatus: handler(() => providerRuntimes.getStatus()),
      download: payloadHandler(parseDownloadableProviderId, (parsed) =>
        runCauseEffect(providerRuntimes.download(parsed)),
      ),
      cancel: payloadHandler(parseDownloadableProviderId, (parsed) => runCauseEffect(providerRuntimes.cancel(parsed))),
      measureDownload: payloadHandler(parseManagedProviderId, (parsed) =>
        runCauseEffect(providerRuntimes.measureDownload(parsed)),
      ),
      removeDownload: payloadHandler(parseManagedProviderId, (parsed) =>
        runCauseEffect(providerRuntimes.removeDownload(parsed)),
      ),
      checkForUpdates: handler(() => runCauseEffect(providerRuntimes.checkForUpdates())),
    },
  };
}

export function signInCodexWithApiKey(service: Pick<AgentService, "signInCodexWithApiKey">, key: string) {
  registerSecretValue(key);
  return runCauseEffect(service.signInCodexWithApiKey(key));
}

export function parseProviderApiKeyInput(value: unknown): SetProviderApiKeyInput {
  if (!isDynamicRecord(value)) throw new Error(sourceText("error.provider.keyRequired"));
  const provider = parseProviderId(value.provider);
  if (!isString(value.key) || !value.key.trim()) throw new Error(sourceText("error.provider.keyRequired"));
  if (value.key.length > MAX_API_KEY_LENGTH) throw new Error(sourceText("error.provider.keyTooLong"));
  return { provider, key: value.key.trim() };
}

function parseManagedProviderId(value: unknown): ManagedProviderId {
  const provider = parseProviderId(value);
  if (!isManagedRuntimeProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
  return provider;
}

export function parseDownloadableProviderId(value: unknown): DownloadableProviderId {
  const provider = parseProviderId(value);
  if (!isDownloadableProvider(provider)) throw new Error("OpenBot does not manage this provider's CLI.");
  return provider;
}

function parseRefreshProvidersInput(value: unknown): { automatic: boolean } {
  if (!isDynamicRecord(value) || typeof value.automatic !== "boolean") throw new Error("Invalid provider refresh.");
  return { automatic: value.automatic };
}

export function parseProviderUseInput(value: unknown): { provider: AgentProviderId; on: boolean } {
  if (!isDynamicRecord(value) || typeof value.on !== "boolean") throw new Error("Invalid provider switch.");
  const provider = parseProviderId(value.provider);
  if (provider === "acp") throw new Error("Custom agents do not have a built-in provider switch.");
  return { provider, on: value.on };
}

function parseInstalledCliChoice(value: unknown): { provider: ManagedProviderId; installed: boolean } {
  if (!isDynamicRecord(value) || typeof value.installed !== "boolean") throw new Error("Invalid provider CLI choice.");
  return { provider: parseManagedProviderId(value.provider), installed: value.installed };
}

export function parseConnectProviderAccountInput(value: unknown): ConnectProviderAccountInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid provider account.");
  return {
    provider: parseProviderId(value.provider),
    accountId: value.accountId === null ? null : requireString(value.accountId, "accountId"),
  };
}

export function parseConnectProviderAccountKeyInput(value: unknown): ConnectProviderAccountKeyInput {
  return { ...parseConnectProviderAccountInput(value), key: parseProviderApiKeyInput(value).key };
}

export function parseRemoveProviderAccountInput(value: unknown): RemoveProviderAccountInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid provider account.");
  return { provider: parseProviderId(value.provider), accountId: requireString(value.accountId, "accountId") };
}

export function parseSetProviderAccountPoolInput(value: unknown): SetProviderAccountPoolInput {
  if (
    !isDynamicRecord(value) ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.leftOut) ||
    value.leftOut.length > MAX_PROVIDER_ACCOUNTS ||
    !value.leftOut.every(isProviderAccountId) ||
    (value.strategy !== undefined && !isProviderAccountPoolStrategy(value.strategy))
  )
    throw new Error("Invalid provider account pool.");
  return {
    provider: parseProviderId(value.provider),
    enabled: value.enabled,
    leftOut: value.leftOut,
    ...(value.strategy === undefined ? {} : { strategy: value.strategy }),
  };
}

export function parseSetLiveVoiceAccountInput(value: unknown): SetLiveVoiceAccountInput {
  return { accountId: decodeLiveVoiceAccount(value) };
}

export function parseResetProviderUsageInput(value: unknown): ResetProviderUsageInput {
  if (!isDynamicRecord(value) || !isProviderAccountId(value.accountId)) throw new Error("Invalid provider account.");
  return { provider: parseProviderId(value.provider), accountId: value.accountId };
}

export function parseRenameProviderAccountInput(value: unknown): RenameProviderAccountInput {
  if (!isDynamicRecord(value) || (value.label !== null && !isString(value.label)))
    throw new Error("Invalid provider account.");
  const label = value.label?.trim() || null;
  if (label && label.length > PROVIDER_ACCOUNT_LABEL_MAX_LENGTH) throw new Error("Invalid provider account.");
  return { ...parseRemoveProviderAccountInput(value), label };
}
