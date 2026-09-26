import type { AgentAdminSettings, ServerSummary, UpdateAgentAdminSettingsInput } from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { createEffect, createStore } from "solid-js";
import { serverCanAdminister } from "../servers/server-capabilities";
import { agentsPort } from "./agents-port";

/** A joined server where this account may change agent access and auto-approve. */
export function serverCanAdministerAgents(server: ServerSummary | undefined): server is ServerSummary {
  return serverCanAdminister(server, AGENT_ADMIN_CAPABILITY);
}

interface RemoteAgentAdminState {
  key: string | null;
  settings: AgentAdminSettings | null;
}

/**
 * Access and auto-approve of one agent on a joined server, read from its host. This computer's own
 * agents keep reading the agent summary and the local approval preference, so the target is null
 * for them. The Team API agent summary does not carry either value.
 */
export function createRemoteAgentAdmin(target: () => { server: ServerSummary; agentId: string } | null) {
  const [state, setState] = createStore<RemoteAgentAdminState>({ key: null, settings: null });
  const key = () => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdministerAgents(current.server)) return null;
    return JSON.stringify([current.server.id, current.agentId]);
  };

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
    const current = target();
    if (!requestKey || !current) return;
    agentsPort()
      .agent.getAgentAdminSettings(current.agentId, current.server.id)
      .then((settings) => accept(requestKey, settings))
      // A failed read keeps the controls hidden, as for a member. The host checks the role on every write anyway.
      .catch(() => undefined);
  });

  return {
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
        throw new Error("Agent settings can only be changed by a server administrator.");
      const settings = await agentsPort().agent.updateAgentAdminSettings(input, server.id);
      accept(JSON.stringify([server.id, input.agentId]), settings);
    },
  };
}
