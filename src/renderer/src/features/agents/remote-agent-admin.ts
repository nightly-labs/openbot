import type {
  AgentAdminSettings,
  AgentBackupModelSettings,
  AgentBackupModels,
  AgentBuiltinMemorySettings,
  AgentFastModeSettings,
  AgentHostSettings,
  AgentNewChatSettings,
  AgentPlanCardSettings,
  AgentUsageLimitReturn,
  BusyMessageMode,
  ServerSummary,
  UpdateAgentAdminSettingsInput,
  UpdateAgentHostSettingsInput,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_BACKUP_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_BUILTIN_MEMORY_CAPABILITY } from "@openbot/contracts/team-protocol/agent-builtin-memory-v1";
import { AGENT_FAST_MODE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_NEW_CHAT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import { AGENT_PLAN_CARD_CAPABILITY } from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_SPEED_CAPABILITY } from "@openbot/contracts/team-protocol/agent-speed-v1";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, untrack } from "solid-js";
import { serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { type AgentsPort, agentsPort } from "./agents-port";

export type RemoteAgentAdminCalls = Pick<
  AgentsPort["agent"],
  | "getAgentAdminSettings"
  | "updateAgentAdminSettings"
  | "getAgentHostSettings"
  | "updateAgentHostSettings"
  | "getAgentBackupModels"
  | "updateAgentBackupModels"
  | "getAgentNewChat"
  | "updateAgentNewChat"
  | "getAgentPlanCard"
  | "updateAgentPlanCard"
  | "getAgentBuiltinMemory"
  | "updateAgentBuiltinMemory"
  | "getAgentFastMode"
  | "updateAgentFastMode"
>;

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
  newChatKey: string | null;
  newChat: AgentNewChatSettings | null;
  planCardKey: string | null;
  planCard: AgentPlanCardSettings | null;
  builtinMemoryKey: string | null;
  builtinMemory: AgentBuiltinMemorySettings | null;
  fastModeKey: string | null;
  fastMode: AgentFastModeSettings | null;
}

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
    newChatKey: null,
    newChat: null,
    planCardKey: null,
    planCard: null,
    builtinMemoryKey: null,
    builtinMemory: null,
    fastModeKey: null,
    fastMode: null,
  });
  const hostKey = createMemo(() => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_HOST_SETTINGS_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });
  const currentHostSettings = () => (state.hostKey !== null && state.hostKey === hostKey() ? state.hostSettings : null);
  function acceptHost(requestKey: string, settings: AgentHostSettings): void {
    if (hostKey() !== requestKey) return;
    setState((draft) => {
      draft.hostKey = requestKey;
      draft.hostSettings = settings;
    });
  }
  let hostReadGeneration = 0;
  createEffect(
    createMemo(() => JSON.stringify([hostKey(), target()?.updatedAt])),
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
  const backupKey = createMemo(() => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_BACKUP_MODELS_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });
  function acceptBackup(requestKey: string, settings: AgentBackupModelSettings): void {
    if (backupKey() !== requestKey) return;
    setState((draft) => {
      draft.backupKey = requestKey;
      draft.backupModels = settings;
    });
  }
  let backupReadGeneration = 0;
  createEffect(
    createMemo(() => JSON.stringify([backupKey(), target()?.updatedAt])),
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
        .catch(() => undefined);
    },
  );
  const newChatKey = createMemo(() => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_NEW_CHAT_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });
  function acceptNewChat(requestKey: string, settings: AgentNewChatSettings): void {
    if (newChatKey() !== requestKey) return;
    setState((draft) => {
      draft.newChatKey = requestKey;
      draft.newChat = settings;
    });
  }
  let newChatReadGeneration = 0;
  createEffect(
    createMemo(() => JSON.stringify([newChatKey(), target()?.updatedAt])),
    () => {
      const requestKey = untrack(newChatKey);
      const generation = ++newChatReadGeneration;
      if (untrack(() => state.newChatKey) !== requestKey)
        setState((draft) => {
          draft.newChatKey = null;
          draft.newChat = null;
        });
      const current = untrack(target);
      if (!requestKey || !current) return;
      calls()
        .getAgentNewChat(current.agentId, current.server.id)
        .then((settings) => {
          if (generation === newChatReadGeneration) acceptNewChat(requestKey, settings);
        })
        .catch(() => undefined);
    },
  );
  const planCardKey = createMemo(() => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_PLAN_CARD_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });
  function acceptPlanCard(requestKey: string, settings: AgentPlanCardSettings): void {
    if (planCardKey() !== requestKey) return;
    setState((draft) => {
      draft.planCardKey = requestKey;
      draft.planCard = settings;
    });
  }
  let planCardReadGeneration = 0;
  createEffect(
    createMemo(() => JSON.stringify([planCardKey(), target()?.updatedAt])),
    () => {
      const requestKey = untrack(planCardKey);
      const generation = ++planCardReadGeneration;
      if (untrack(() => state.planCardKey) !== requestKey)
        setState((draft) => {
          draft.planCardKey = null;
          draft.planCard = null;
        });
      const current = untrack(target);
      if (!requestKey || !current) return;
      calls()
        .getAgentPlanCard(current.agentId, current.server.id)
        .then((settings) => {
          if (generation === planCardReadGeneration) acceptPlanCard(requestKey, settings);
        })
        .catch(() => undefined);
    },
  );
  const builtinMemoryKey = createMemo(() => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdminister(current.server, AGENT_BUILTIN_MEMORY_CAPABILITY))
      return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });
  function acceptBuiltinMemory(requestKey: string, settings: AgentBuiltinMemorySettings): void {
    if (builtinMemoryKey() !== requestKey) return;
    setState((draft) => {
      draft.builtinMemoryKey = requestKey;
      draft.builtinMemory = settings;
    });
  }
  let builtinMemoryReadGeneration = 0;
  createEffect(
    createMemo(() => JSON.stringify([builtinMemoryKey(), target()?.updatedAt])),
    () => {
      const requestKey = untrack(builtinMemoryKey);
      const generation = ++builtinMemoryReadGeneration;
      if (untrack(() => state.builtinMemoryKey) !== requestKey)
        setState((draft) => {
          draft.builtinMemoryKey = null;
          draft.builtinMemory = null;
        });
      const current = untrack(target);
      if (!requestKey || !current) return;
      calls()
        .getAgentBuiltinMemory(current.agentId, current.server.id)
        .then((settings) => {
          if (generation === builtinMemoryReadGeneration) acceptBuiltinMemory(requestKey, settings);
        })
        .catch(() => undefined);
    },
  );
  const fastModeKey = createMemo(() => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverHasFastMode(current.server)) return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });
  function acceptFastMode(requestKey: string, settings: AgentFastModeSettings): void {
    if (fastModeKey() !== requestKey) return;
    setState((draft) => {
      draft.fastModeKey = requestKey;
      draft.fastMode = settings;
    });
  }
  let fastModeReadGeneration = 0;
  createEffect(
    createMemo(() => JSON.stringify([fastModeKey(), target()?.updatedAt])),
    () => {
      const requestKey = untrack(fastModeKey);
      const generation = ++fastModeReadGeneration;
      if (untrack(() => state.fastModeKey) !== requestKey)
        setState((draft) => {
          draft.fastModeKey = null;
          draft.fastMode = null;
        });
      const current = untrack(target);
      if (!requestKey || !current) return;
      calls()
        .getAgentFastMode(current.agentId, current.server.id)
        .then((settings) => {
          if (generation === fastModeReadGeneration) acceptFastMode(requestKey, settings);
        })
        .catch(() => undefined);
    },
  );
  const key = createMemo(() => {
    const current = target();
    if (current?.server.kind !== "remote" || !serverCanAdministerAgents(current.server)) return null;
    return JSON.stringify([current.server.id, current.agentId]);
  });

  function accept(requestKey: string, settings: AgentAdminSettings): void {
    if (key() !== requestKey) return;
    setState((draft) => {
      draft.key = requestKey;
      draft.settings = settings;
    });
  }

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
      .catch(() => undefined);
  });

  return {
    automation: (): boolean | undefined => currentHostSettings()?.allowAutomation,
    computerUse: (): boolean | undefined => currentHostSettings()?.computerUse,
    busyMessageMode: (): BusyMessageMode | null | undefined => currentHostSettings()?.busyMessageMode,
    defaultBusyMessageMode: (): BusyMessageMode | undefined => currentHostSettings()?.defaultBusyMessageMode,
    async updateHostSettings(input: UpdateAgentHostSettingsInput): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_HOST_SETTINGS_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentHostSettings(input, server.id);
      if (hostKey() === JSON.stringify([server.id, input.agentId])) hostReadGeneration += 1;
      acceptHost(JSON.stringify([server.id, input.agentId]), settings);
    },
    backupModels: (): AgentBackupModels | null | undefined =>
      state.backupKey !== null && state.backupKey === backupKey() ? state.backupModels?.backupModels : undefined,
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
    allowNewChat: (): boolean | undefined =>
      state.newChatKey !== null && state.newChatKey === newChatKey() ? state.newChat?.allowNewChat : undefined,
    async updateNewChat(agentId: string, allowNewChat: boolean): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_NEW_CHAT_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentNewChat({ agentId, allowNewChat }, server.id);
      if (newChatKey() === JSON.stringify([server.id, agentId])) newChatReadGeneration += 1;
      acceptNewChat(JSON.stringify([server.id, agentId]), settings);
    },
    quickAcknowledgement: (): boolean | undefined =>
      state.planCardKey !== null && state.planCardKey === planCardKey()
        ? state.planCard?.quickAcknowledgement
        : undefined,
    async updatePlanCard(agentId: string, quickAcknowledgement: boolean): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_PLAN_CARD_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentPlanCard({ agentId, quickAcknowledgement }, server.id);
      if (planCardKey() === JSON.stringify([server.id, agentId])) planCardReadGeneration += 1;
      acceptPlanCard(JSON.stringify([server.id, agentId]), settings);
    },
    memory: (): boolean | undefined =>
      state.builtinMemoryKey !== null && state.builtinMemoryKey === builtinMemoryKey()
        ? state.builtinMemory?.memory
        : undefined,
    async updateBuiltinMemory(agentId: string, memory: boolean): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverCanAdminister(server, AGENT_BUILTIN_MEMORY_CAPABILITY))
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentBuiltinMemory({ agentId, memory }, server.id);
      if (builtinMemoryKey() === JSON.stringify([server.id, agentId])) builtinMemoryReadGeneration += 1;
      acceptBuiltinMemory(JSON.stringify([server.id, agentId]), settings);
    },
    fastMode: (): boolean | null | undefined =>
      state.fastModeKey !== null && state.fastModeKey === fastModeKey() ? state.fastMode?.fastMode : undefined,
    ultrafast: (): boolean =>
      state.fastModeKey !== null && state.fastModeKey === fastModeKey() && state.fastMode?.ultrafast === true,
    async updateFastMode(agentId: string, fastMode: boolean, ultrafast = false): Promise<void> {
      const server = target()?.server;
      if (server?.kind !== "remote" || !serverHasFastMode(server))
        throw new Error(currentText().t("error.agent.settingsLocalOnly"));
      const settings = await calls().updateAgentFastMode(
        { agentId, fastMode, ...(fastMode && ultrafast ? { ultrafast: true } : {}) },
        server.id,
      );
      if (fastModeKey() === JSON.stringify([server.id, agentId])) fastModeReadGeneration += 1;
      acceptFastMode(JSON.stringify([server.id, agentId]), settings);
    },
    settings: (): AgentAdminSettings | null => (state.key !== null && state.key === key() ? state.settings : null),
    autoApproves: (): boolean | undefined => {
      const settings = state.key !== null && state.key === key() ? state.settings : null;
      return settings ? settings.autoApprove || settings.autoApproveLocked : undefined;
    },
    async update(input: UpdateAgentAdminSettingsInput): Promise<void> {
      const server = target()?.server;
      if (!serverCanAdministerAgents(server) || server.kind !== "remote")
        throw new Error(currentText().t("agent.error.adminOnly"));
      const settings = await calls().updateAgentAdminSettings(input, server.id);
      accept(JSON.stringify([server.id, input.agentId]), settings);
    },
  };
}

export async function updateRemoteAgent(
  admin: Pick<
    RemoteAgentAdmin,
    | "update"
    | "updateHostSettings"
    | "updateBackupModels"
    | "updateNewChat"
    | "updatePlanCard"
    | "updateBuiltinMemory"
    | "updateFastMode"
  >,
  input: UpdateAgentInput,
  updateProfile: (input: UpdateAgentInput) => Promise<void>,
): Promise<void> {
  const {
    access,
    computerUse,
    allowAutomation,
    busyMessageMode,
    backupModels,
    allowNewChat,
    quickAcknowledgement,
    memory,
    fastMode,
    ultrafast,
    agentId,
    ...fields
  } = input;
  if (allowAutomation === null) throw new Error("A joined server has no default for Local scripts.");
  if (quickAcknowledgement === null) throw new Error("A joined server has no default for the plan card.");
  if (allowNewChat === null) throw new Error("A joined server has no default for new chats.");
  if (access !== undefined) await admin.update({ agentId, access });
  if (computerUse !== undefined || allowAutomation !== undefined || busyMessageMode !== undefined)
    await admin.updateHostSettings({
      agentId,
      ...(computerUse === undefined ? {} : { computerUse }),
      ...(allowAutomation === undefined ? {} : { allowAutomation }),
      ...(busyMessageMode === undefined ? {} : { busyMessageMode }),
    });
  if (backupModels !== undefined) await admin.updateBackupModels(agentId, backupModels);
  if (allowNewChat !== undefined) await admin.updateNewChat(agentId, allowNewChat);
  if (quickAcknowledgement !== undefined) await admin.updatePlanCard(agentId, quickAcknowledgement);
  if (memory !== undefined) await admin.updateBuiltinMemory(agentId, memory);
  if (fastMode !== undefined) await admin.updateFastMode(agentId, fastMode, ultrafast === true);
  if (Object.keys(fields).length) await updateProfile({ agentId, ...fields });
}

export type RemoteAgentAdmin = ReturnType<typeof createRemoteAgentAdmin>;

function serverHasFastMode(server: Parameters<typeof serverSupportsCapability>[0]): boolean {
  return (
    serverSupportsCapability(server, AGENT_SPEED_CAPABILITY) ||
    serverSupportsCapability(server, AGENT_FAST_MODE_CAPABILITY)
  );
}
