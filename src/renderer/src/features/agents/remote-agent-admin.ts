import type {
  AgentAdminSettings,
  AgentHostSettings,
  ServerSummary,
  UpdateAgentAdminSettingsInput,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, untrack } from "solid-js";
import { serverCanAdminister } from "../servers/server-capabilities";
import { type AgentsPort, agentsPort } from "./agents-port";

/** The web client sends these host calls over its own connection. */
export type RemoteAgentAdminCalls = Pick<
  AgentsPort["agent"],
  "getAgentAdminSettings" | "updateAgentAdminSettings" | "getAgentHostSettings" | "updateAgentHostSettings"
>;

/** A joined server where this account may change agent access and auto-approve. */
export function serverCanAdministerAgents(server: ServerSummary | undefined): server is ServerSummary {
  return serverCanAdminister(server, AGENT_ADMIN_CAPABILITY);
}

interface RemoteAgentAdminState {
  key: string | null;
  settings: AgentAdminSettings | null;
  hostKey: string | null;
  hostSettings: AgentHostSettings | null;
}

/**
 * Access and auto-approve of one agent on a joined server, read from its host. This computer's own
 * agents keep reading the agent summary and the local approval preference, so the target is null
 * for them. The Team API agent summary does not carry either value.
 */
export function createRemoteAgentAdmin(
  target: () => { server: ServerSummary; agentId: string; updatedAt?: string | null } | null,
  calls: () => RemoteAgentAdminCalls = () => agentsPort().agent,
) {
  const [state, setState] = createStore<RemoteAgentAdminState>({
    key: null,
    settings: null,
    hostKey: null,
    hostSettings: null,
  });
  const hostKey = () => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_HOST_SETTINGS_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  };
  function acceptHost(requestKey: string, settings: AgentHostSettings): void {
    if (hostKey() !== requestKey) return;
    setState((draft) => {
      draft.hostKey = requestKey;
      draft.hostSettings = settings;
    });
  }
  let hostReadGeneration = 0;
  // A settings change on another client updates the agent's timestamp in the released summary.
  createEffect(
    () => JSON.stringify([hostKey(), target()?.updatedAt]),
    () => {
      const requestKey = untrack(hostKey);
      const generation = ++hostReadGeneration;
      if (untrack(() => state.hostKey) !== requestKey)
        setState((draft) => {
          draft.hostKey = null;
          draft.hostSettings = null;
        });
      const current = untrack(target);
      if (!requestKey || !current) return;
      calls()
        .getAgentHostSettings(current.agentId, current.server.id)
        .then((settings) => {
          if (generation === hostReadGeneration) acceptHost(requestKey, settings);
        })
        .catch(() => undefined);
    },
  );
  const key = createMemo(() => {
    const current = target();
    if (
      current?.server.kind !== "remote" ||
      current.server.state !== "online" ||
      !serverCanAdministerAgents(current.server)
    )
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });

  function accept(requestKey: string, settings: AgentAdminSettings): void {
    if (key() !== requestKey) return;
    setState((draft) => {
      draft.key = requestKey;
      draft.settings = settings;
    });
  }

  // A new agent never shows the values of the previous one while its own are read.
  createEffect(key, (requestKey) => {
    setState((draft) => {
      draft.key = null;
      draft.settings = null;
    });
    const current = untrack(target);
    if (!requestKey || !current) return;
    calls()
      .getAgentAdminSettings(current.agentId, current.server.id)
      .then((settings) => accept(requestKey, settings))
      // A failed read keeps the controls hidden, as for a member. The host checks the role on every write anyway.
      .catch(() => undefined);
  });

  return {
    automation: (): boolean | undefined =>
      state.hostKey !== null && state.hostKey === hostKey() ? state.hostSettings?.allowAutomation : undefined,
    async updateAutomation(agentId: string, allowAutomation: boolean): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_HOST_SETTINGS_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentHostSettings({ agentId, allowAutomation }, server.id);
      if (hostKey() === JSON.stringify([server.id, agentId])) hostReadGeneration += 1;
      acceptHost(JSON.stringify([server.id, agentId]), settings);
    },
    /** Null for a local agent, before the first answer, and when the host does not serve the capability. */
    settings: (): AgentAdminSettings | null => (state.key !== null && state.key === key() ? state.settings : null),
    /**
     * Writes to the host of the selected server. The agent is named by the caller, because an
     * approval card or the settings panel can outlive a switch to another agent. Rejects with the
     * host's reason, so the caller shows it.
     */
    async update(input: UpdateAgentAdminSettingsInput): Promise<void> {
      const server = target()?.server;
      if (!serverCanAdministerAgents(server) || server.kind !== "remote")
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentAdminSettings(input, server.id);
      accept(JSON.stringify([server.id, input.agentId]), settings);
    },
  };
}

/**
 * Sends a profile change to an agent of a joined server. The Team API agent route ignores access,
 * so access and Local scripts go to their admin routes. Other fields keep the agent route.
 */
export async function updateRemoteAgent(
  admin: Pick<RemoteAgentAdmin, "update" | "updateAutomation">,
  input: UpdateAgentInput,
  updateProfile: (input: UpdateAgentInput) => Promise<void>,
): Promise<void> {
  const { access, allowAutomation, agentId, ...fields } = input;
  if (access !== undefined) await admin.update({ agentId, access });
  if (allowAutomation !== undefined) await admin.updateAutomation(agentId, allowAutomation);
  if (Object.keys(fields).length) await updateProfile({ agentId, ...fields });
}

export type RemoteAgentAdmin = ReturnType<typeof createRemoteAgentAdmin>;
