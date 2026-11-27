import { providerCliSource } from "@openbot/contracts/cli-version";
import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  type AgentStatus,
  agentProviderName,
  isLocalOnlyProvider,
  type ProviderApiKeyStatus,
  type ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import type { ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";
import { providerDiagnosticsText } from "@openbot/ui/features/provider-diagnostics/provider-diagnostics";
import { createMemo } from "solid-js";
import { useI18n } from "../../../i18n-context";

interface GeneralStoreProps {
  agentStatus?: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  openCodeKeyStatus?: () => ProviderApiKeyStatus | undefined;
  claudeKeyStatus?: () => ProviderApiKeyStatus | undefined;
  codexKeyStatus?: () => ProviderApiKeyStatus | undefined;
  providerHostName?: string | undefined;
  offProviders?: readonly AgentProviderId[] | undefined;
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>> | undefined;
  providerAccountUsers?: Partial<Record<AgentProviderId, Readonly<Record<string, readonly string[]>>>> | undefined;
}

export function createSettingsGeneralStore(props: GeneralStoreProps) {
  const i18n = useI18n();

  const providerOptions = createMemo<ProviderPickerOption[]>(() =>
    AGENT_PROVIDERS.filter(
      (provider) =>
        provider !== "acp" &&
        (!props.providerHostName ||
          !isLocalOnlyProvider(provider) ||
          props.agentStatus?.providers?.some((candidate) => candidate.id === provider) === true),
    ).map((provider) => {
      const agent = props.agentStatus?.providers?.find((candidate) => candidate.id === provider);
      const runtime = props.providerRuntimeStatuses?.[provider];
      const cliSource = agent ? providerCliSource(agent, runtime) : undefined;
      const agentVersionShown = Boolean(
        runtime &&
          agent &&
          (runtime.phase === "ready" || runtime.phase === "not-downloaded") &&
          (cliSource === "system" && !(agent.cliIncomplete && runtime.phase === "not-downloaded")
            ? agent.state === "available" ||
              agent.state === "sign-in-required" ||
              (agent.state === "error" && runtime.phase === "ready")
            : (agent.state === "available" || agent.state === "sign-in-required") &&
              runtime.phase === "not-downloaded" &&
              !runtime.availableVersion),
      );
      const keyStatus =
        provider === "opencode"
          ? props.openCodeKeyStatus?.()
          : provider === "claude"
            ? props.claudeKeyStatus?.()
            : provider === "antigravity" && agent?.apiKeyInUse
              ? ("saved" as const)
              : provider === "codex" && props.providerHostName
                ? props.codexKeyStatus?.()
                : (provider === "codex" || provider === "muse") && !props.providerHostName
                  ? agent?.apiKeyInUse
                    ? ("saved" as const)
                    : ("missing" as const)
                  : undefined;
      return {
        id: provider,
        name: agentProviderName(provider),
        description: props.providerHostName
          ? i18n.t("provider.availableOnHost", { name: props.providerHostName })
          : i18n.t("provider.availableHere"),
        state: agent?.state ?? "not-installed",
        message: agent?.message,
        email: agent?.email,
        connectionState: agent?.connectionState,
        signInPending: agent?.signInPending,
        restartPending: agent?.restartPending,
        checkError: agent?.checkError,
        lastError: agent?.lastError,
        diagnostics: agent ? providerDiagnosticsText(agent) : undefined,
        availableVersion: props.providerAvailableVersions?.[provider] ?? null,
        ...(keyStatus === undefined ? {} : { keyStatus }),
        off: agent?.off ?? props.offProviders?.includes(provider),
        usedBy: props.providerUsers?.[provider],
        accounts: agent?.accounts?.map((account) => ({
          ...account,
          usedBy: props.providerAccountUsers?.[provider]?.[account.id],
        })),
        accountPool: agent?.accountPool,
        runtimeStatus:
          runtime && agentVersionShown ? { ...runtime, phase: "ready", version: agent?.version ?? null } : runtime,
        cliSource: agentVersionShown || cliSource === "managed" ? cliSource : undefined,
        otherCliVersion: agentVersionShown || cliSource === "managed" ? agent?.otherCliVersion : undefined,
        incompleteCliVersion:
          cliSource === "system" && agent?.cliIncomplete && runtime?.phase === "not-downloaded"
            ? (agent.version ?? undefined)
            : undefined,
      };
    }),
  );

  return { providerOptions };
}

export type SettingsGeneralStore = ReturnType<typeof createSettingsGeneralStore>;
