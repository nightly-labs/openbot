import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  type AgentStatus,
  agentProviderName,
  type ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
import type { ProviderPickerOption } from "../../../components/ProviderPicker";
import { useI18n } from "../../../i18n-context";

interface GeneralStoreProps {
  agentStatus?: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>>;
  /** The newer runtime main says exists, per provider. Decided there, never worked out here. */
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>>;
}

/**
 * The General tab's provider list: which row is selected, and the three options merged from the
 * agent status and the runtime download status.
 */
export function createSettingsGeneralStore(props: GeneralStoreProps) {
  const i18n = useI18n();
  const [selectedProvider, setSelectedProvider] = createSignal<AgentProviderId | null>(null);

  const providerOptions = createMemo<ProviderPickerOption[]>(() =>
    AGENT_PROVIDERS.map((provider) => {
      const agent = props.agentStatus?.providers?.find((candidate) => candidate.id === provider);
      const runtime = props.providerRuntimeStatuses?.[provider];
      return {
        id: provider,
        name: agentProviderName(provider),
        description: i18n.t("provider.availableHere"),
        state: agent?.state ?? "not-installed",
        message: agent?.message,
        email: agent?.email,
        connectionState: agent?.connectionState,
        checkError: agent?.checkError,
        availableVersion: props.providerAvailableVersions?.[provider] ?? null,
        /*
         * A CLI the user installed themselves is the one the provider runs, whatever the managed
         * runtime holds, so the row reads it as ready on the version the provider reports. An
         * update offered for it is the user's own install being newer-able, not a download.
         */
        runtimeStatus:
          runtime &&
          (agent?.state === "available" || agent?.state === "sign-in-required") &&
          (agent.cliSource === "system" || (runtime.phase === "not-downloaded" && !runtime.availableVersion))
            ? { ...runtime, phase: "ready", version: agent.version ?? null }
            : runtime,
      };
    }),
  );

  return { providerOptions, selectedProvider, setSelectedProvider };
}

export type SettingsGeneralStore = ReturnType<typeof createSettingsGeneralStore>;
