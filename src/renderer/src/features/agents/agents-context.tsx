import type {
  AgentModelOption,
  AgentStatus,
  AgentSummary,
  AvatarImageInput,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { createFirstAgentDraft, type FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { currentText } from "@openbot/ui/text";
import { createMemo, createSignal, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { FALLBACK_STATUS } from "../../app-defaults";
import { agentProfilesEqual, toAgentProfile } from "../../app-message-projection";
import { createStoredProfile, updateStored } from "../../app-stored-values";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useUiErrors } from "../../ui-errors";
import type { AgentSettingsRequest } from "../conversation/conversation-types";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { remoteAdminServer } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import type { CreationPreference } from "./agent-creation-model";
import { readAgentSelection, writeAgentSelection } from "./agent-selection";
import { agentsPort } from "./agents-port";

/**
 * The agents on the active server: the roster, which one is open, the provider
 * runtime's status behind them, and the first-run setup sheet.
 *
 * Three things live here that the plan's inventory filed elsewhere, each for a
 * reason worth keeping:
 *
 * - **`activeAgentId` and `activeAgent`.** `activeAgent` returns `undefined` while a
 *   person's conversation is open, so it has to read `activeDirectMember()`;
 *   that is the whole reason this provider nests inside direct messages. Every
 *   other reader of the pair is either in this file or nested below it.
 * - **`uiErrors` and `appendUiError`, borrowed from `ui-errors.tsx`.** Twenty-odd
 *   commands across conversation, turns and navigation append to it, and all of
 *   them sit below this provider, so this is where they reach it. The store
 *   itself lives above the per-server scope, because a command can outlive the
 *   workspace that issued it - a voice message transcribed after the user has
 *   moved on still fails against the server it was dictated on, and its error has
 *   to be there when they come back.
 * - **`explicitlyOpenedAgentChatId`**, as an accessor pair rather than a signal.
 *   It is read inside event handling to decide whether a page the user asked
 *   for may overwrite what is on screen; making it reactive would re-run that
 *   handling on a value that is only ever consulted, never watched.
 *
 * **The commands that create, duplicate, edit or delete an agent are still in
 * the controller.** Each writes several domains nested under this one -
 * `createAgent` seeds `liveMessages` and `conversationLoaded`, `duplicateAgent`
 * replaces the sidebar layout, `deleteAgent` prunes ten different maps - so they
 * belong to the navigation leaf, not here. What moved is everything an agent
 * owns on its own: the roster, the open one, the setup sheet, and the two
 * updates (`updateAgent`, `setAgentAvatar`) that touch nothing else.
 *
 * `applyStoredAgents` opens the setup sheet when the roster comes back empty.
 * That is load-bearing for a fresh install, and it is deliberately *not*
 * guarded on the sheet already being open by anything but `agentSetupOpen()` -
 * re-running it while the user is typing a draft would discard the draft.
 */
const Agents = createSimpleContext({
  name: "Agents",
  init: () => {
    const { activeServer, activeServerId } = useServers();
    const { activeDirectMember, setDirectTyping } = useDirectMessages();
    const { dismissUsage } = useUsage();
    const { uiErrors, setUiErrors, appendUiError } = useUiErrors();

    const [agentList, setAgentList] = createSignal<AgentProfile[]>([]);
    /** The first roster read of this scope succeeded. */
    const [agentListSettled, setAgentListSettled] = createSignal(false);
    const [duplicatingAgentIds, setDuplicatingAgentIds] = createSignal<Set<string>>(new Set());
    const [modelOptions, setModelOptions] = createSignal<AgentModelOption[]>([]);
    const selectionServerId = untrack(activeServerId);
    const scopeIsCurrent = createScopeGuard();
    let savedAgentId = readAgentSelection()[selectionServerId] ?? "";
    const [activeAgentId, updateActiveAgentId] = createSignal("");
    const [agentChatOpenRevision, setAgentChatOpenRevision] = createSignal(0);
    const [agentSetupOpen, setAgentSetupOpen] = createSignal(false);
    const [agentSetupDraft, setAgentSetupDraft] = createSignal<FirstAgentDraft>(createFirstAgentDraft());
    const [agentSetupError, setAgentSetupError] = createSignal<string | null>(null);
    const [creatingAgent, setCreatingAgent] = createSignal(false);
    /**
     * The provider that the provider step of this joined server chose, for the agent form after it.
     * In memory only: the saved setup choice is of this computer, and this context is of one server.
     */
    const [serverSetupChoice, setServerSetupChoice] = createSignal<CreationPreference | null>(null);
    /**
     * A joined server with no agents shows the provider step before the agent form, when the account
     * can sign its host in. OpenBot includes no AI subscription, so an agent made first could not
     * answer. A member, an older host and this computer open the form as before.
     */
    const serverOnboardingOpen = createMemo(
      () =>
        agentSetupOpen() &&
        agentList().length === 0 &&
        serverSetupChoice() === null &&
        remoteAdminServer(activeServer(), "providers-v1") !== undefined,
    );
    /**
     * A server whose roster has not come back yet. A remote host answers over the remote connection,
     * which takes seconds after a launch, so an empty list here does not mean the server has no
     * agents. Main reports such a host as `offline` until the first connection is up, so that state
     * counts as connecting too. A failed connection reports `error` or an issue, and an incompatible
     * or sleeping server keeps its own state. Only a successful read can settle the roster.
     */
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
    const [agentStatus, setAgentStatus] = createSignal<AgentStatus>(FALLBACK_STATUS);
    let openedAgentChatId: string | null = null;

    const activeAgent = createMemo(() => {
      if (activeDirectMember()) return undefined;
      return agentList().find((agent) => agent.id === activeAgentId()) ?? agentList()[0];
    });

    function setActiveAgentId(value: string | ((current: string) => string)): void {
      if (!scopeIsCurrent()) return;
      updateActiveAgentId((current) => {
        const next = typeof value === "function" ? value(current) : value;
        savedAgentId = "";
        writeAgentSelection(selectionServerId, next);
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
        provider: agent.provider,
        model: agent.model,
        reasoning_effort: agent.reasoningEffort,
        server_kind: activeServer()?.kind ?? ("unknown" as const),
      };
    }

    function applyStoredAgents(storedAgents: AgentSummary[]): void {
      const currentById = new Map(agentList().map((agent) => [agent.id, agent]));
      const profiles = storedAgents.map((stored) => {
        const next = toAgentProfile(stored);
        const existing = currentById.get(next.id);
        if (!existing) return createStoredProfile(next);
        if (!agentProfilesEqual(existing, next)) updateStored(existing, next);
        return existing;
      });
      setAgentList(profiles);
      setAgentListSettled(true);
      setActiveAgentId((current) => {
        // Validate the saved choice before it can trigger conversation requests.
        const preferred = current || savedAgentId;
        return profiles.some((agent) => agent.id === preferred) ? preferred : (profiles[0]?.id ?? "");
      });
      if (profiles.length === 0 && !agentSetupOpen()) {
        setAgentSetupDraft(createFirstAgentDraft());
        setAgentSetupError(null);
        setAgentSetupOpen(true);
      }
    }

    function openBotSetup(): void {
      // The form renders in the workspace content the Usage report covers, and the
      // sidebar button that asks for it is outside that markup. Above the guard
      // below, so a second press reveals a form that is already open rather than
      // doing nothing visible; the guard still protects the draft from a reset.
      // The automatic open above is deliberately not this: a server with no agents
      // must not take the report away from a user who asked for it.
      dismissUsage();
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
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      const properties = analyticsAgentProperties(agentId);
      const changedFields = Object.keys(updates);
      try {
        const stored = await agentsPort().agent.updateAgent({
          agentId,
          ...updates,
        });
        const next = toAgentProfile(stored);
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
        appendUiError(agentId, error, currentText().t("agent.error.settingsFailed"), serverId);
        throw error;
      }
    }

    async function setAgentAvatar(agentId: string, image: AvatarImageInput | null): Promise<void> {
      const serverId = activeServerId();
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
        appendUiError(agentId, error, currentText().t("agent.error.avatarFailed"), serverId);
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
      explicitlyOpenedAgentChatId,
      setExplicitlyOpenedAgentChatId,
      analyticsAgentProperties,
      applyStoredAgents,
      openBotSetup,
      cancelAgentSetup,
      updateAgent,
      setAgentAvatar,
    };
  },
});

export const AgentsProvider = Agents.provider;
export const useAgents = Agents.use;
