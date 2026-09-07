import type { AgentProviderId, AgentStatus, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { createMemo, createSignal } from "solid-js";
import type { ProviderPickerOption } from "../../../components/ProviderPicker";

interface GeneralStoreProps {
  agentStatus?: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>>;
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
        runtimeStatus:
          runtime?.phase === "not-downloaded" && (agent?.state === "available" || agent?.state === "sign-in-required")
            ? { ...runtime, phase: "ready", version: agent.version ?? null }
            : runtime,
      };
    }),
  );

  return { providerOptions, selectedProvider, setSelectedProvider };
}

export type SettingsGeneralStore = ReturnType<typeof createSettingsGeneralStore>;
