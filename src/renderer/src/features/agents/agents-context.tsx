import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentNotificationLevelsSnapshot,
  type AgentStatus,
  type AvatarImageInput,
  agentNotificationLevelMap,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  type HiddenAgent,
  type ServerNotificationLevel,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { AGENT_HIDDEN_WORK_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import type { AgentProfile } from "@openbot/ui/data";
import type { CreationPreference, DevelopmentCreation } from "@openbot/ui/features/agents/agent-creation-model";
import { createFirstAgentDraft, type FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { FALLBACK_STATUS } from "../../app-defaults";
import { agentProfilesEqual, toAgentProfile } from "../../app-message-projection";
import { createStoredProfile, updateStored } from "../../app-stored-values";
import { usePlatform } from "../../platform";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useUiErrors } from "../../ui-errors";
import type { AgentSettingsRequest } from "../conversation/conversation-types";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { remoteAdminServer } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useWindowPage } from "../window/window-page-context";
import { AGENT_SELECTION_STORAGE_KEY, readAgentSelection, writeAgentSelection } from "./agent-selection";
import { agentsPort } from "./agents-port";
import {
  createHostAccounts,
  withHostAccounts,
  withHostAgentAccount,
  withHostProfileAccount,
} from "./host-provider-accounts";

const Agents = createSimpleContext({
  name: "Agents",
  init: () => {
    const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
    const { activeDirectMember, setDirectTyping } = useDirectMessages();
    const windowPage = useWindowPage();
    const { uiErrors, setUiErrors, appendUiError } = useUiErrors();

    const [agentList, setAgentList] = createSignal<AgentProfile[]>([]);
    const [agentListSettled, setAgentListSettled] = createSignal(false);
    const [duplicatingAgentIds, setDuplicatingAgentIds] = createSignal<Set<string>>(new Set());
    const [modelOptions, setModelOptions] = createSignal<ClientAgentModelOption[]>([]);
    const selectionServerId = untrack(activeServerId);
    const scopeIsCurrent = createScopeGuard();
    const chatWindowAgentId = usePlatform().chatWindow?.agentId;
    let savedAgentId = chatWindowAgentId ?? readAgentSelection(AGENT_SELECTION_STORAGE_KEY)[selectionServerId] ?? "";
    const [activeAgentId, updateActiveAgentId] = createSignal("");
    const [agentChatOpenRevision, setAgentChatOpenRevision] = createSignal(0);
    const [agentSetupOpen, setAgentSetupOpen] = createSignal(false);
    const [agentSetupDraft, setAgentSetupDraft] = createSignal<FirstAgentDraft>(createFirstAgentDraft());
    const [agentSetupError, setAgentSetupError] = createSignal<string | null>(null);
    const [creatingAgent, setCreatingAgent] = createSignal(false);
    const [serverSetupChoice, setServerSetupChoice] = createSignal<CreationPreference | null>(null);
    const serverOnboardingOpen = createMemo(
      () =>
        agentSetupOpen() &&
        agentList().length === 0 &&
        serverSetupChoice() === null &&
        remoteAdminServer(activeServer(), "providers-v1") !== undefined,
    );
    const agentListConnecting = createMemo(() => {
      if (agentListSettled()) return false;
      const server = activeServer();
      if (!server || server.kind === "local") return true;
      return (
        server?.kind === "remote" &&
        (server.state === "offline" || server.state === "connecting" || server.state === "online") &&
        server.issue == null &&
        server.hostedSleep !== "sleeping"
      );
    });
    const [settingsRequest, setSettingsRequest] = createSignal<AgentSettingsRequest | null>(null);
    const [providerStatus, setAgentStatus] = createSignal<AgentStatus>(FALLBACK_STATUS);
    const hostAccounts = createHostAccounts({
      serverId: createMemo(() => remoteAdminServer(activeServer(), PROVIDER_ACCOUNTS_CAPABILITY)?.id),
      accounts: (serverId) => agentsPort().providerAdmin.accounts(serverId),
      usage: (serverId) => agentsPort().providerAdmin.accountUsage(serverId),
      applied: (host) => {
        for (const profile of agentList()) {
          const next = withHostProfileAccount(profile, host);
          if (next !== profile) updateStored(profile, next);
        }
      },
    });
    const agentStatus = createMemo(() => withHostAccounts(providerStatus(), hostAccounts.host()));
    const platform = usePlatform();
    const developmentCreation = createMemo((): DevelopmentCreation | null => {
      if (activeServer()?.kind !== "local" || platform.appInfo()?.variant !== "dev") return null;
      const available = new Set(
        agentStatus()
          .providers?.filter((row) => row.state === "available")
          .map((row) => row.id),
      );
      return { providerAvailable: (provider) => available.has(provider) };
    });
    createEffect(providerStatus, hostAccounts.schedule);
    let openedAgentChatId: string | null = null;
    const hiddenAgentIds = new Set<string>();
    const [userHiddenAgents, setUserHiddenAgents] = createSignal<HiddenAgent[]>([]);
    const userHiddenAgentIds = createMemo(() => new Set(userHiddenAgents().map((agent) => agent.agentId)));
    const userHiddenAgentsWork = () => activeServerSupportsCapability(AGENT_HIDDEN_WORK_CAPABILITY);
    const noAgentIds: ReadonlySet<string> = new Set();
    const userPausedAgentIds = createMemo(() => (userHiddenAgentsWork() ? noAgentIds : userHiddenAgentIds()));

    function applyUserHiddenAgents(agents: HiddenAgent[]): void {
      if (!scopeIsCurrent()) return;
      setUserHiddenAgents(agents);
    }

    const [ownAgentLevels, setOwnAgentLevels] = createSignal<ReadonlyMap<string, ServerNotificationLevel>>(new Map());
    let ownAgentLevelsApplied = 0;
    const mutedAgentIds = createMemo(
      () => new Set([...ownAgentLevels()].flatMap(([agentId, level]) => (level === "nothing" ? [agentId] : []))),
    );

    function applyOwnAgentLevels(snapshot: Pick<AgentNotificationLevelsSnapshot, "agents">): void {
      if (!scopeIsCurrent()) return;
      ownAgentLevelsApplied += 1;
      setOwnAgentLevels(agentNotificationLevelMap({ server: null, agents: snapshot.agents }));
    }

    const activeAgent = createMemo(() => {
      if (activeDirectMember()) return undefined;
      const agentId = activeAgentId() || savedAgentId;
      return agentList().find((agent) => agent.id === agentId) ?? agentList()[0];
    });

    function setActiveAgentId(value: string | ((current: string) => string)): void {
      if (!scopeIsCurrent()) return;
      updateActiveAgentId((current) => {
        const next = typeof value === "function" ? value(current) : value;
        savedAgentId = "";
        if (!chatWindowAgentId) writeAgentSelection(AGENT_SELECTION_STORAGE_KEY, selectionServerId, next);
        return next;
      });
    }

    function explicitlyOpenedAgentChatId(): string | null {
      return openedAgentChatId;
    }

    function setExplicitlyOpenedAgentChatId(agentId: string | null): void {
      openedAgentChatId = agentId;
    }

    function analyticsAgentProperties(agentId: string) {
      const agent = agentList().find((candidate) => candidate.id === agentId);
      if (!agent) return null;
      return {
        ...(isKnownAgentProvider(agent.provider) ? { provider: agent.provider } : {}),
        model: agent.model,
        reasoning_effort: agent.reasoningEffort,
        server_kind: activeServer()?.kind ?? ("unknown" as const),
      };
    }

    function applyStoredAgents(storedAgents: ClientAgentSummary[]): void {
      const currentById = new Map(agentList().map((agent) => [agent.id, agent]));
      const host = untrack(hostAccounts.host);
      const profiles = storedAgents.flatMap((stored) => {
        if (hiddenAgentIds.has(stored.id)) return [];
        const next = toAgentProfile(withHostAgentAccount(stored, host));
        const existing = currentById.get(next.id);
        if (!existing) return [createStoredProfile(next)];
        if (!agentProfilesEqual(existing, next)) updateStored(existing, next);
        return [existing];
      });
      setAgentList((current) =>
        current.length === profiles.length && current.every((agent, index) => agent === profiles[index])
          ? current
          : profiles,
      );
      setAgentListSettled(true);
      setActiveAgentId((current) => {
        const preferred = current || savedAgentId;
        if (profiles.some((agent) => agent.id === preferred)) return preferred;
        const hidden = untrack(userHiddenAgentIds);
        return (profiles.find((agent) => !hidden.has(agent.id)) ?? profiles[0])?.id ?? "";
      });
      if (profiles.length === 0 && !agentSetupOpen()) {
        setAgentSetupDraft(createFirstAgentDraft());
        setAgentSetupError(null);
        setAgentSetupOpen(true);
      }
      hostAccounts.schedule();
    }

    function applyFrameAgents(storedAgents: ClientAgentSummary[]): void {
      if (agentListSettled()) return;
      const host = untrack(hostAccounts.host);
      setAgentList(
        storedAgents.map((stored) =>
          createStoredProfile({ ...toAgentProfile(withHostAgentAccount(stored, host)), preview: "" }),
        ),
      );
    }

    function hideAgent(agentId: string): (() => void) | null {
      const index = agentList().findIndex((agent) => agent.id === agentId);
      const agent = agentList()[index];
      if (!agent) return null;
      hiddenAgentIds.add(agentId);
      setAgentList((current) => current.filter((candidate) => candidate.id !== agentId));
      return () => {
        if (!hiddenAgentIds.delete(agentId)) return;
        setAgentList((current) =>
          current.some((candidate) => candidate.id === agentId)
            ? current
            : [...current.slice(0, index), agent, ...current.slice(index)],
        );
      };
    }

    function forgetHiddenAgent(agentId: string): void {
      hiddenAgentIds.delete(agentId);
    }

    function openAgentSetup(): void {
      windowPage.showAgents();
      if (agentSetupOpen()) return;
      setDirectTyping(false);
      setAgentSetupDraft(createFirstAgentDraft());
      setAgentSetupError(null);
      openedAgentChatId = null;
      setAgentSetupOpen(true);
    }

    function cancelAgentSetup(): void {
      if (creatingAgent() || agentList().length === 0) return;
      setAgentSetupOpen(false);
      setAgentSetupError(null);
      setAgentSetupDraft(createFirstAgentDraft());
    }

    async function updateAgent(agentId: string, updates: Omit<UpdateAgentInput, "agentId">): Promise<void> {
      const analytics = desktopAnalytics.scope();
      const properties = analyticsAgentProperties(agentId);
      const changedFields = Object.keys(updates);
      try {
        const stored = await agentsPort().agent.updateAgent({
          agentId,
          ...updates,
        });
        const next = toAgentProfile(stored);
        if (updates.provider !== undefined || updates.providerAccountId !== undefined) hostAccounts.schedule();
        setAgentList((current) => {
          const existingIndex = current.findIndex((agent) => agent.id === agentId);
          if (existingIndex === -1) return [...current, createStoredProfile(next)];
          const existing = current[existingIndex];
          if (existing) updateStored(existing, next);
          return [...current];
        });
        analytics.track("agent_action", {
          action: "update",
          changed_fields: changedFields,
          result: "succeeded",
          ...(properties ?? {}),
        });
      } catch (error) {
        analytics.track("agent_action", {
          action: "update",
          changed_fields: changedFields,
          result: "failed",
          failure_code: "update_failed",
          ...(properties ?? {}),
        });
        throw error;
      }
    }

    async function setAgentAvatar(agentId: string, image: AvatarImageInput | null): Promise<void> {
      const analytics = desktopAnalytics.scope();
      const properties = analyticsAgentProperties(agentId);
      try {
        const stored = await agentsPort().agent.setAvatar({ agentId, image });
        const next = toAgentProfile(stored);
        setAgentList((current) => {
          const existing = current.find((agent) => agent.id === agentId);
          if (!existing) return [...current, createStoredProfile(next)];
          updateStored(existing, next);
          return current;
        });
        analytics.track("agent_action", {
          action: "update",
          changed_fields: ["avatar"],
          result: "succeeded",
          ...(properties ?? {}),
        });
      } catch (error) {
        analytics.track("agent_action", {
          action: "update",
          changed_fields: ["avatar"],
          result: "failed",
          failure_code: "avatar_update_failed",
          ...(properties ?? {}),
        });
        throw error;
      }
    }

    return {
      agentList,
      setAgentList,
      agentListConnecting,
      agentListSettled,
      setAgentListSettled,
      duplicatingAgentIds,
      setDuplicatingAgentIds,
      modelOptions,
      setModelOptions,
      activeAgentId,
      setActiveAgentId,
      activeAgent,
      agentChatOpenRevision,
      setAgentChatOpenRevision,
      uiErrors,
      setUiErrors,
      appendUiError,
      agentSetupOpen,
      serverOnboardingOpen,
      serverSetupChoice,
      setServerSetupChoice,
      setAgentSetupOpen,
      agentSetupDraft,
      setAgentSetupDraft,
      agentSetupError,
      setAgentSetupError,
      creatingAgent,
      setCreatingAgent,
      settingsRequest,
      setSettingsRequest,
      agentStatus,
      setAgentStatus,
      developmentCreation,
      hostAccountLimits: hostAccounts.limits,
      refreshHostAccounts: hostAccounts.refresh,
      refreshHostAccountUsage: hostAccounts.refreshUsage,
      explicitlyOpenedAgentChatId,
      setExplicitlyOpenedAgentChatId,
      analyticsAgentProperties,
      applyStoredAgents,
      applyFrameAgents,
      hideAgent,
      forgetHiddenAgent,
      userHiddenAgents,
      userHiddenAgentIds,
      userHiddenAgentsWork,
      userPausedAgentIds,
      applyUserHiddenAgents,
      ownAgentLevels,
      mutedAgentIds,
      applyOwnAgentLevels,
      ownAgentLevelsApplied: () => ownAgentLevelsApplied,
      openAgentSetup,
      cancelAgentSetup,
      updateAgent,
      setAgentAvatar,
    };
  },
});

export const AgentsProvider = Agents.provider;
export const useAgents = Agents.use;
