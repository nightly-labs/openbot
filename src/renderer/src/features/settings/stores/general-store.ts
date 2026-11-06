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
  /** The newer runtime main says exists, per provider. Decided there, never worked out here. */
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  /**
   * Whether the optional OpenCode key is saved. An accessor, because the modal refreshes it after
   * the key dialog closes and the options memo has to recompute. Read by the modal through the key
   * API, because only the status crosses IPC and no getter returns the key. Absent until the first
   * read, so the row shows no key badge rather than a wrong one.
   */
  openCodeKeyStatus?: () => ProviderApiKeyStatus | undefined;
  /** Whether a Claude key is saved, read the same way. Absent where the host does not read the key. */
  claudeKeyStatus?: () => ProviderApiKeyStatus | undefined;
  /**
   * Whether a joined server's host logs Codex in with a pasted OpenAI key, read the same way. Absent
   * where the host does not read the key (`codex-api-key-v1`). This computer's agent status says it.
   */
  codexKeyStatus?: () => ProviderApiKeyStatus | undefined;
  /** The joined server whose host runs these providers. Absent when this computer runs them. */
  providerHostName?: string | undefined;
  /** The providers that the user turned off in OpenBot. */
  offProviders?: readonly AgentProviderId[] | undefined;
  /** The names of the agents that use each provider. */
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>> | undefined;
  /** The names of the agents that use each account, by provider and account. */
  providerAccountUsers?: Partial<Record<AgentProviderId, Readonly<Record<string, readonly string[]>>>> | undefined;
}

/**
 * The provider options of the Providers tab, merged from the agent status and the runtime download
 * status.
 */
export function createSettingsGeneralStore(props: GeneralStoreProps) {
  const i18n = useI18n();

  const providerOptions = createMemo<ProviderPickerOption[]>(() =>
    // A joined server's host serves only the providers that the Team API carries: a host before
    // protocol 5 sends no Gemini status. Custom agents have their own list, because one row cannot
    // stand for several commands.
    AGENT_PROVIDERS.filter(
      (provider) =>
        provider !== "acp" &&
        (!props.providerHostName ||
          !isLocalOnlyProvider(provider) ||
          props.agentStatus?.providers?.some((candidate) => candidate.id === provider) === true),
    ).map((provider) => {
      const agent = props.agentStatus?.providers?.find((candidate) => candidate.id === provider);
      const runtime = props.providerRuntimeStatuses?.[provider];
      /*
       * A CLI the user installed themselves is the one the provider runs, whatever the managed
       * runtime holds, so the row reads it as ready on the version the provider reports. An
       * update offered for it is the user's own install being newer-able, not a download.
       *
       * Only while that runtime is idle. The provider keeps answering on the user's own CLI for
       * the whole of an update, so a mask that ignored the phase would report the row as ready
       * throughout, and hide both the progress the Cancel button reverses and the failure the
       * Retry button answers.
       *
       * A CLI the user installed that failed shows its own version too, so the row names the CLI
       * that failed. A copy that is not downloaded keeps its Download then.
       */
      const agentVersionShown = Boolean(
        runtime &&
          agent &&
          (runtime.phase === "ready" || runtime.phase === "not-downloaded") &&
          (agent.cliSource === "system"
            ? agent.state === "available" ||
              agent.state === "sign-in-required" ||
              (agent.state === "error" && runtime.phase === "ready")
            : (agent.state === "available" || agent.state === "sign-in-required") &&
              runtime.phase === "not-downloaded" &&
              !runtime.availableVersion),
      );
      // The Gemini status says only whether a saved key serves the turns. The status of a joined
      // server's host does not carry the Codex key, so that host answers for it on the key route.
      // Released hosts do not report a Muse key.
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
        runtimeStatus:
          runtime && agentVersionShown ? { ...runtime, phase: "ready", version: agent?.version ?? null } : runtime,
        // The label goes only with the version of the CLI it names: in other states the row shows
        // the copy's version, while the agent status can still name the user's CLI.
        cliSource: agentVersionShown || agent?.cliSource === "managed" ? agent?.cliSource : undefined,
      };
    }),
  );

  return { providerOptions };
}

export type SettingsGeneralStore = ReturnType<typeof createSettingsGeneralStore>;
