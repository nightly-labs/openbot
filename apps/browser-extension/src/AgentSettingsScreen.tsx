import { type AgentProviderId, type AgentProviderRef, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import type {
  AgentAdminSettings,
  AgentStatus,
  ClientAgentModelOption,
  UpdateAgentAdminSettingsInput,
} from "@openbot/contracts/ipc";
import { toAgentProfile } from "@openbot/ui/features/agents/agent-profile";
import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { useText } from "@openbot/ui/text";
import { createMemo, createStore, onSettled, Show } from "solid-js";
import type { AgentSettingsApi } from "./agent-settings";
import type { Workspace } from "./workspace";

/** A provider this build does not know keeps the desktop's starting choice, as there. */
function knownProvider(provider: AgentProviderRef): AgentProviderId {
  return isKnownAgentProvider(provider) ? provider : "codex";
}

/** The panel fills the side panel, which is the panel's own smallest width. */
const PANEL_WIDTH = 360;

/**
 * The desktop's agent settings for an agent of the open server: profile, look, model, chat colour,
 * permissions, a new chat and the history. The host checks each change.
 */
export function AgentSettingsScreen(props: {
  workspace: Workspace;
  settings: AgentSettingsApi;
  agentId: string;
  onClose: () => void;
}) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    models: ClientAgentModelOption[];
    status: AgentStatus | null;
    admin: AgentAdminSettings | null;
    error: string | null;
  }>({ models: [], status: null, admin: null, error: null });
  let disposed = false;

  const summary = createMemo(() => props.workspace.state.agents.find((agent) => agent.id === props.agentId));
  const profile = createMemo(() => {
    const agent = summary();
    if (!agent) return undefined;
    const color = props.workspace.state.colors[agent.id];
    return toAgentProfile({ ...agent, avatarColor: color ?? null });
  });
  // The panel reads these props in its effects. A ternary in JSX becomes a getter that makes a memo when
  // read, and a memo made in an effect callback halts Solid, so each one is a memo here.
  const autoApprove = createMemo(() =>
    state.admin ? state.admin.autoApprove || state.admin.autoApproveLocked : undefined,
  );
  const updatePermissions = createMemo(() =>
    state.admin
      ? async (input: UpdateAgentAdminSettingsInput) => {
          const next = await props.settings.updatePermissions(input);
          setState((draft) => {
            draft.admin = next;
          });
        }
      : undefined,
  );
  const startNewChat = createMemo(() => {
    const clear = props.settings.startNewChat;
    return clear
      ? async () => {
          await clear(props.agentId);
          await props.workspace.reloadChat();
        }
      : undefined;
  });
  const deleteHistory = createMemo(() => {
    const remove = props.settings.deleteHistory;
    return remove
      ? async () => {
          await remove(props.agentId);
          await props.workspace.reloadChat();
        }
      : undefined;
  });
  const working = () => {
    const chat = props.workspace.state.chat;
    return chat?.agentId === props.agentId && chat.activeTurnId !== null;
  };

  onSettled(() => {
    void Promise.all([props.settings.catalog(), props.settings.adminSettings(props.agentId)])
      .then(([catalog, admin]) => {
        if (disposed) return;
        setState((draft) => {
          draft.models = catalog.models;
          draft.status = catalog.status;
          draft.admin = admin;
        });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setState((draft) => {
            draft.error = errorMessage(error, t("webClient.agent.modelsFailed"));
          });
      });
    return () => {
      disposed = true;
    };
  });

  return (
    <div class="ext-settings-screen">
      <Show
        when={state.status ? { agent: profile(), status: state.status } : undefined}
        fallback={<p class="ext-state">{state.error ?? t("extension.settings.loading")}</p>}
      >
        {(ready) => (
          <Show when={ready().agent}>
            {(agent) => (
              <AgentSettingsPanel
                agent={agent()}
                runtimeSettings={{
                  provider: knownProvider(agent().provider),
                  model: agent().model,
                  reasoningEffort: agent().reasoningEffort,
                }}
                agentStatus={ready().status}
                modelOptions={state.models}
                working={working()}
                autoApprove={autoApprove()}
                onUpdatePermissions={updatePermissions()}
                maxWidth={() => PANEL_WIDTH}
                width={PANEL_WIDTH}
                onResize={() => undefined}
                onResizeEnd={() => undefined}
                onClose={props.onClose}
                onUpdateAgent={(agentId, updates) => props.settings.updateAgent({ agentId, ...updates })}
                onUpdateRuntimeSettings={async (agentId, _settings, updates) => {
                  await props.settings.updateAgent({ agentId, ...updates });
                  return true;
                }}
                onSetAgentAvatar={(agentId, image) => props.settings.setAvatar(agentId, image)}
                onStartNewChat={startNewChat()}
                onDeleteHistory={deleteHistory()}
              />
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
