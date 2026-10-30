import type {
  AgentAdminSettings,
  AgentBackupModelSettings,
  AgentBackupModels,
  AgentHostSettings,
  AgentTaskLimitSettings,
  AgentUsageLimitReturn,
  BusyMessageMode,
  ServerSummary,
  UpdateAgentAdminSettingsInput,
  UpdateAgentHostSettingsInput,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_BACKUP_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_TASK_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";
import { serverCanAdminister } from "../servers/server-capabilities";
import { type AgentsPort, agentsPort } from "./agents-port";

/** The web client sends these host calls over its own connection. */
export type RemoteAgentAdminCalls = Pick<
  AgentsPort["agent"],
  | "getAgentAdminSettings"
  | "updateAgentAdminSettings"
  | "getAgentHostSettings"
  | "updateAgentHostSettings"
  | "getAgentBackupModels"
  | "updateAgentBackupModels"
  | "getAgentTaskLimit"
  | "updateAgentTaskLimit"
>;

/** A joined server where this account may change agent access and auto-approve. */
function serverCanAdministerAgents(server: ServerSummary | undefined): server is ServerSummary {
  return serverCanAdminister(server, AGENT_ADMIN_CAPABILITY);
}

interface RemoteAgentAdminState {
  key: string | null;
  settings: AgentAdminSettings | null;
  hostKey: string | null;
  hostSettings: AgentHostSettings | null;
  backupKey: string | null;
  backupModels: AgentBackupModelSettings | null;
  taskLimitKey: string | null;
  taskLimit: AgentTaskLimitSettings | null;
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
    backupKey: null,
    backupModels: null,
    taskLimitKey: null,
    taskLimit: null,
  });
  const hostKey = () => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_HOST_SETTINGS_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  };
  /** Null until the host answers for the current agent. */
  const currentHostSettings = () => (state.hostKey !== null && state.hostKey === hostKey() ? state.hostSettings : null);
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
  const backupKey = () => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_BACKUP_MODELS_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  };
  function acceptBackup(requestKey: string, settings: AgentBackupModelSettings): void {
    if (backupKey() !== requestKey) return;
    setState((draft) => {
      draft.backupKey = requestKey;
      draft.backupModels = settings;
    });
  }
  let backupReadGeneration = 0;
  createEffect(
    () => JSON.stringify([backupKey(), target()?.updatedAt]),
    () => {
      const requestKey = untrack(backupKey);
      const generation = ++backupReadGeneration;
      if (untrack(() => state.backupKey) !== requestKey)
        setState((draft) => {
          draft.backupKey = null;
          draft.backupModels = null;
        });
      const current = untrack(target);
      if (!requestKey || !current) return;
      calls()
        .getAgentBackupModels(current.agentId, current.server.id)
        .then((settings) => {
          if (generation === backupReadGeneration) acceptBackup(requestKey, settings);
        })
        // A failed read keeps the setting hidden. A host can save a provider that this version does not know.
        .catch(() => undefined);
    },
  );
  const taskLimitKey = () => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_TASK_LIMIT_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  };
  function acceptTaskLimit(requestKey: string, settings: AgentTaskLimitSettings): void {
    if (taskLimitKey() !== requestKey) return;
    setState((draft) => {
      draft.taskLimitKey = requestKey;
      draft.taskLimit = settings;
    });
  }
  let taskLimitReadGeneration = 0;
  createEffect(
    () => JSON.stringify([taskLimitKey(), target()?.updatedAt]),
    () => {
      const requestKey = untrack(taskLimitKey);
      const generation = ++taskLimitReadGeneration;
      if (untrack(() => state.taskLimitKey) !== requestKey)
        setState((draft) => {
          draft.taskLimitKey = null;
          draft.taskLimit = null;
        });
      const current = untrack(target);
      if (!requestKey || !current) return;
      calls()
        .getAgentTaskLimit(current.agentId, current.server.id)
        .then((settings) => {
          if (generation === taskLimitReadGeneration) acceptTaskLimit(requestKey, settings);
        })
        // A failed read keeps the setting hidden. The host checks the role on every write anyway.
        .catch(() => undefined);
    },
  );
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
    const current = untrack(target);
    if (!requestKey || !current) return;
    calls()
      .getAgentAdminSettings(current.agentId, current.server.id)
      .then((settings) => accept(requestKey, settings))
      // A failed read keeps the controls hidden, as for a member. The host checks the role on every write anyway.
      .catch(() => undefined);
  });

  return {
    automation: (): boolean | undefined => currentHostSettings()?.allowAutomation,
    /** Undefined until the host answers. Null: the agent follows the host default. */
    busyMessageMode: (): BusyMessageMode | null | undefined => currentHostSettings()?.busyMessageMode,
    /** The host's own default. Only the host changes it. */
    defaultBusyMessageMode: (): BusyMessageMode | undefined => currentHostSettings()?.defaultBusyMessageMode,
    async updateHostSettings(input: Omit<UpdateAgentHostSettingsInput, "computerUse">): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_HOST_SETTINGS_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentHostSettings(input, server.id);
      if (hostKey() === JSON.stringify([server.id, input.agentId])) hostReadGeneration += 1;
      acceptHost(JSON.stringify([server.id, input.agentId]), settings);
    },
    /** Undefined for a local agent, before the host answers, and when it does not serve the capability. */
    backupModels: (): AgentBackupModels | null | undefined =>
      state.backupKey !== null && state.backupKey === backupKey() ? state.backupModels?.backupModels : undefined,
    /** The model that the agent left for a usage limit. The Team API agent summary does not carry it. */
    usageLimitReturn: (): AgentUsageLimitReturn | null | undefined =>
      state.backupKey !== null && state.backupKey === backupKey() ? state.backupModels?.usageLimitReturn : undefined,
    async updateBackupModels(agentId: string, backupModels: AgentBackupModels | null): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_BACKUP_MODELS_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentBackupModels({ agentId, backupModels }, server.id);
      if (backupKey() === JSON.stringify([server.id, agentId])) backupReadGeneration += 1;
      acceptBackup(JSON.stringify([server.id, agentId]), settings);
    },
    /** Undefined for a local agent, before the host answers, and without the capability. Null: the default. */
    taskLimit: (): number | null | undefined =>
      state.taskLimitKey !== null && state.taskLimitKey === taskLimitKey() ? state.taskLimit?.taskLimit : undefined,
    async updateTaskLimit(agentId: string, taskLimit: number | null): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_TASK_LIMIT_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentTaskLimit({ agentId, taskLimit }, server.id);
      if (taskLimitKey() === JSON.stringify([server.id, agentId])) taskLimitReadGeneration += 1;
      acceptTaskLimit(JSON.stringify([server.id, agentId]), settings);
    },
    /** Null for a local agent, before the first answer, and when the host does not serve the capability. */
    settings: (): AgentAdminSettings | null => (state.key !== null && state.key === key() ? state.settings : null),
    /** Undefined until the host answers. A released host with Turbo mode on locks every agent to auto-approve. */
    autoApproves: (): boolean | undefined => {
      const settings = state.key !== null && state.key === key() ? state.settings : null;
      return settings ? settings.autoApprove || settings.autoApproveLocked : undefined;
    },
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
 * so access, Local scripts, the busy-message mode, backup models and the task limit go to their admin
 * routes. Other fields keep the agent route.
 */
export async function updateRemoteAgent(
  admin: Pick<RemoteAgentAdmin, "update" | "updateHostSettings" | "updateBackupModels" | "updateTaskLimit">,
  input: UpdateAgentInput,
  updateProfile: (input: UpdateAgentInput) => Promise<void>,
): Promise<void> {
  const { access, allowAutomation, busyMessageMode, backupModels, taskLimit, agentId, ...fields } = input;
  // A joined server's host keeps one value for each agent: it has no account default to return to.
  // Only Settings › Agents sends `null`, and only for this computer, so no user sees this error.
  // It comes before the first write, so that a wrong call changes nothing.
  if (allowAutomation === null) throw new Error("A joined server has no default for Local scripts.");
  if (access !== undefined) await admin.update({ agentId, access });
  // Null busy-message mode is valid here: the agent follows the host default.
  if (allowAutomation !== undefined || busyMessageMode !== undefined)
    await admin.updateHostSettings({
      agentId,
      ...(allowAutomation === undefined ? {} : { allowAutomation }),
      ...(busyMessageMode === undefined ? {} : { busyMessageMode }),
    });
  if (backupModels !== undefined) await admin.updateBackupModels(agentId, backupModels);
  if (taskLimit !== undefined) await admin.updateTaskLimit(agentId, taskLimit);
  if (Object.keys(fields).length) await updateProfile({ agentId, ...fields });
}

export type RemoteAgentAdmin = ReturnType<typeof createRemoteAgentAdmin>;
