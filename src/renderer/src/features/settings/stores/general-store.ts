import type { AgentProviderId, AgentStatus, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
import type { ProviderPickerOption } from "../../../components/ProviderPicker";

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
  const [selectedProvider, setSelectedProvider] = createSignal<AgentProviderId | null>(null);

  const providerOptions = createMemo<ProviderPickerOption[]>(() =>
    (["codex", "claude", "grok"] as const).map((provider) => {
      const agent = props.agentStatus?.providers?.find((candidate) => candidate.id === provider);
      const runtime = props.providerRuntimeStatuses?.[provider];
      return {
        id: provider,
        name: provider === "codex" ? "ChatGPT" : provider === "claude" ? "Claude" : "Grok",
        description: "Available on this computer",
        state: agent?.state ?? "not-installed",
        message: agent?.message,
        email: agent?.email,
        connectionState: agent?.connectionState,
        checkError: agent?.checkError,
        availableVersion: props.providerAvailableVersions?.[provider] ?? null,
        /*
         * A CLI the user installed themselves has no managed download, so its runtime stays
         * "not-downloaded" while the provider works perfectly well. The row reads that as ready, on
         * the version the provider reports - including when an update is offered for it, which is
         * the user's own install being newer-able, not a runtime waiting to be downloaded.
         */
        runtimeStatus:
          runtime?.phase === "not-downloaded" &&
          (agent?.cliSource === "system" || !runtime.availableVersion) &&
          (agent?.state === "available" || agent?.state === "sign-in-required")
            ? { ...runtime, phase: "ready", version: agent.version ?? null }
            : runtime,
      };
    }),
  );

  return { providerOptions, selectedProvider, setSelectedProvider };
}

export type SettingsGeneralStore = ReturnType<typeof createSettingsGeneralStore>;
