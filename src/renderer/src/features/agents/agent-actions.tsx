import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentDeleteUndoToast, startUndoCountdown } from "@openbot/ui/features/agents/AgentDeleteUndoToast";
import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { duplicateSection as duplicateSectionWith } from "@openbot/ui/features/sidebar/duplicate-section";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { toAgentProfile, withoutAgent } from "../../app-message-projection";
import { createStoredProfile } from "../../app-stored-values";
import { useNavigation } from "../../navigation";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useTurns } from "../../turns";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { useConversation } from "../conversation/conversation-context";
import { agentConversationKey } from "../conversation/conversation-keys";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useServers } from "../servers/servers-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { type NewAgentDraft, newAgentInput } from "./agent-create-input";
import { attentionAgentId, withoutAttention } from "./agent-runtime-snapshot";
import { useAgents } from "./agents-context";
import { agentsPort } from "./agents-port";

/**
 * Creating, editing, duplicating and deleting an agent.
 *
 * A leaf, and it has to be one: `deleteAgent` alone writes to agents,
 * conversation, turns, sidebar and navigation, so no domain can own it without
 * reaching into one nested under itself. This is the shape the dependency rule
 * pushes every multi-domain command into - state lives outward, the command
 * that spans several domains lives at the bottom and reads all of them.
 *
 * The four share one guard, `agentSetupOpen() && creatingAgent()`: while the
 * first-agent form is mid-submit there is no agent to act on yet, and letting a
 * second write through would race the one in flight.
 *
 * Conversation cleanup belongs to its domain. This command removes the agent
 * and asks each domain to remove the state that it owns.
 */
const AgentActions = createSimpleContext({
  name: "Agent actions",
  init: () => {
    const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
    const scopeIsCurrent = createScopeGuard();
    const {
      agentList,
      setAgentList,
      agentSetupOpen,
      setAgentSetupOpen,
      agentSetupDraft,
      setAgentSetupError,
      creatingAgent,
      setCreatingAgent,
      duplicatingAgentIds,
      setDuplicatingAgentIds,
      activeAgentId,
      setActiveAgentId,
      setSettingsRequest,
      setUiErrors,
      analyticsAgentProperties,
      hideAgent,
      forgetHiddenAgent,
      userHiddenAgents,
      userHiddenAgentIds,
      applyUserHiddenAgents,
    } = useAgents();
    const { initializeConversation, removeConversation } = useConversation();
    const threads = useAgentThreads();
    const { setActiveTurns, setFailedTurns, setQueues, setPendingPrompts } = useTurns();
    const { sidebarLayout, setSidebarLayout, applySidebarLayoutAction, removePinnedSidebarItemEverywhere } =
      useSidebar();
    const { clearDirectSelection } = useDirectMessages();
    const { selectAgent } = useNavigation();
    const [duplicatingSectionIds, setDuplicatingSectionIds] = createSignal<Set<string>>(new Set());

    /** Asks the host for the agent. */
    function requestNewAgent(draft: NewAgentDraft) {
      const createModelSupported =
        activeServer()?.kind !== "remote" || activeServerSupportsCapability(TEAM_AGENT_CREATE_MODEL_CAPABILITY);
      return agentsPort().agent.createAgent(newAgentInput(draft, createModelSupported));
    }

    /** Synchronous, so a caller that also selects the agent does both in the same update. */
    function addNewAgent(stored: ClientAgentSummary): AgentProfile {
      const newAgent = createStoredProfile(toAgentProfile(stored));
      setAgentList((current) => [newAgent, ...current.filter((item) => item.id !== newAgent.id)]);
      initializeConversation(newAgent.id);
      return newAgent;
    }

    /** An agent made from another view, such as the routine canvas: the user stays where they are. */
    async function createAgentInPlace(draft: Parameters<typeof requestNewAgent>[0]) {
      const analytics = desktopAnalytics.scope();
      try {
        const newAgent = addNewAgent(await requestNewAgent(draft));
        const properties = analyticsAgentProperties(newAgent.id);
        analytics.track("agent_action", { action: "create", result: "succeeded", ...(properties ?? {}) });
        return newAgent;
      } catch (error) {
        analytics.track("agent_action", { action: "create", result: "failed", failure_code: "create_failed" });
        throw error;
      }
    }

    async function createAgent(draft: FirstAgentDraft = agentSetupDraft()) {
      if (creatingAgent()) return;
      const analytics = desktopAnalytics.scope();
      const submitted = { ...draft };
      setCreatingAgent(true);
      setAgentSetupError(null);
      try {
        const newAgent = addNewAgent(await requestNewAgent(submitted));
        setAgentSetupOpen(false);
        clearDirectSelection();
        setActiveAgentId(newAgent.id);
        const properties = analyticsAgentProperties(newAgent.id);
        analytics.track("agent_action", { action: "create", result: "succeeded", ...(properties ?? {}) });
      } catch (error) {
        analytics.track("agent_action", { action: "create", result: "failed", failure_code: "create_failed" });
        const { t, errorMessage } = currentText();
        setAgentSetupError(errorMessage(error, t("agent.error.createFailed")));
      } finally {
        setCreatingAgent(false);
      }
    }

    function editAgent(agentId: string) {
      if (agentSetupOpen() && creatingAgent()) return;
      selectAgent(agentId);
      setSettingsRequest({ agentId, nonce: Date.now() });
    }

    /** Copies one agent into the roster and the layout, and leaves the selection alone. `null`: the scope ended. */
    async function copyAgent(agentId: string) {
      const result = await agentsPort().agent.duplicateAgent(agentId);
      if (!scopeIsCurrent()) return null;
      const profile = createStoredProfile(toAgentProfile(result.agent));
      setAgentList((current) => [profile, ...current.filter((candidate) => candidate.id !== profile.id)]);
      setSidebarLayout(result.layout);
      return result;
    }

    async function duplicateAgent(agentId: string): Promise<void> {
      if (agentSetupOpen() && creatingAgent()) return;
      if (!activeServerSupportsCapability("agent-duplication") || duplicatingAgentIds().has(agentId)) return;
      const analytics = desktopAnalytics.scope();
      const properties = analyticsAgentProperties(agentId);
      setDuplicatingAgentIds((current) => new Set(current).add(agentId));
      try {
        const result = await copyAgent(agentId);
        if (!result) return;
        selectAgent(result.agent.id);
        analytics.track("agent_action", { action: "duplicate", result: "succeeded", ...(properties ?? {}) });
      } catch (error) {
        analytics.track("agent_action", {
          action: "duplicate",
          result: "failed",
          failure_code: "duplicate_failed",
          ...(properties ?? {}),
        });
        const { t, errorMessage } = currentText();
        actionToast.error(t("agent.error.duplicateTitle"), {
          ...{
            description: errorMessage(error, t("agent.error.duplicateFailed")),
          },
          report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },
        });
        throw error;
      } finally {
        setDuplicatingAgentIds((current) => {
          const next = new Set(current);
          next.delete(agentId);
          return next;
        });
      }
    }

    /** Copies a custom section and each of its agents. The user stays on the agent that is open. */
    async function duplicateSection(sectionId: string): Promise<void> {
      if (agentSetupOpen() && creatingAgent()) return;
      if (!activeServerSupportsCapability("agent-duplication") || !activeServerSupportsCapability("sidebar-layout")) {
        return;
      }
      if (duplicatingSectionIds().has(sectionId)) return;
      setDuplicatingSectionIds((current) => new Set(current).add(sectionId));
      try {
        const hidden = userHiddenAgentIds();
        await duplicateSectionWith(
          {
            layout: sidebarLayout(),
            agentIds: agentList()
              .filter((agent) => !hidden.has(agent.id))
              .map((agent) => agent.id),
            // The agent's own Duplicate item waits too: the host refuses a second copy of one agent.
            duplicateAgent: async (agentId) => {
              if (!scopeIsCurrent()) return null;
              setDuplicatingAgentIds((current) => new Set(current).add(agentId));
              try {
                const result = await copyAgent(agentId);
                return result && { agentId: result.agent.id, layout: result.layout };
              } finally {
                setDuplicatingAgentIds((current) => {
                  const next = new Set(current);
                  next.delete(agentId);
                  return next;
                });
              }
            },
            // A server switch during the call ends the chain: the next call would reach the other server.
            mutateLayout: async (action) => {
              if (!scopeIsCurrent()) return null;
              const layout = await applySidebarLayoutAction(action);
              return scopeIsCurrent() ? layout : null;
            },
          },
          sectionId,
        );
      } catch (error) {
        const { t, errorMessage } = currentText();
        actionToast.error(t("sidebar.section.duplicateTitle"), {
          description: errorMessage(error, t("sidebar.section.duplicateFailed")),
          report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },
        });
        throw error;
      } finally {
        setDuplicatingSectionIds((current) => {
          const next = new Set(current);
          next.delete(sectionId);
          return next;
        });
      }
    }

    /**
     * Deletes that wait for the undo time to end, by agent. A server switch ends this scope, and with it
     * the time to undo: each delete then runs at once, against the server it was made on.
     */
    const pendingDeletes = new Map<string, () => void>();
    onCleanup(() => {
      for (const commit of [...pendingDeletes.values()]) commit();
    });

    /**
     * The agent leaves the roster at once, and a toast offers Undo. Main deletes the agent only when the
     * time is over, so an undo has nothing to restore. If the app quits before then, the agent stays.
     */
    async function deleteAgent(agentId: string) {
      if (agentSetupOpen() && creatingAgent()) return;
      if (pendingDeletes.has(agentId)) return;
      const agent = agentList().find((candidate) => candidate.id === agentId);
      if (!agent) return;
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      const properties = analyticsAgentProperties(agentId);
      const marketplaceAgent = Boolean(agent.marketplaceSource);
      const wasActive = activeAgentId() === agentId;
      // Read before the roster changes: a read after a write returns the old value until the flush.
      const others = agentList().filter((candidate) => candidate.id !== agentId);
      const userHidden = userHiddenAgentIds();
      const nextAgentId = (others.find((candidate) => !userHidden.has(candidate.id)) ?? others[0])?.id ?? "";
      const hidden = hideAgent(agentId);
      if (!hidden) return;
      const showAgent: () => void = hidden;
      if (wasActive) setActiveAgentId(nextAgentId);
      setSettingsRequest((current) => (current?.agentId === agentId ? null : current));

      const toastId = `agent-delete-${serverId}-${agentId}`;
      let settled = false;
      /** Undo and delete each end the same wait, so only the first of them runs. */
      function settle(): boolean {
        if (settled) return false;
        settled = true;
        countdown.stop();
        pendingDeletes.delete(agentId);
        // A scope cleanup can call this, and a write to the Toaster from there stops the reactive system.
        queueMicrotask(() => toast.dismiss(toastId));
        return true;
      }

      function undo(): void {
        if (!settle() || !scopeIsCurrent()) return;
        showAgent();
        if (wasActive) setActiveAgentId(agentId);
      }

      function forgetDeletedAgent(): void {
        analytics.track("agent_action", { action: "delete", result: "succeeded", ...(properties ?? {}) });
        if (marketplaceAgent) {
          analytics.track("marketplace_action", { entity: "agent", action: "uninstall", result: "succeeded" });
        }
        if (!scopeIsCurrent()) return;
        forgetHiddenAgent(agentId);
        threads.forgetAgent(agentId);
        removeConversation(agentId);
        setUiErrors((current) => withoutAgent(current, agentConversationKey(serverId, agentId)));
        setActiveTurns((current) => withoutAgent(current, agentId));
        setFailedTurns((current) => withoutAgent(current, agentId));
        setQueues((current) => withoutAgent(current, agentId));
        setPendingPrompts((current) => withoutAttention(current, (event) => attentionAgentId(event) === agentId));
      }

      async function commit(): Promise<void> {
        if (!settle()) return;
        // Before the wait: a server switch reads the stored pins when the next scope starts. If the delete
        // fails, the agent comes back without its pin.
        removePinnedSidebarItemEverywhere({ kind: "agent", id: agentId });
        try {
          await agentsPort().agent.deleteAgent(agentId, serverId);
          forgetDeletedAgent();
        } catch (error) {
          // A step after the delete can fail, such as the sidebar write. Main then no longer has the
          // agent, and putting it back would show an agent that comes back only until a restart.
          const stillListed = await agentsPort()
            .agent.listAgents(serverId)
            .then(
              (agents) => agents.some((candidate) => candidate.id === agentId),
              () => true,
            );
          if (!stillListed) {
            forgetDeletedAgent();
            return;
          }
          analytics.track("agent_action", {
            action: "delete",
            result: "failed",
            failure_code: "delete_failed",
            ...(properties ?? {}),
          });
          if (marketplaceAgent) {
            analytics.track("marketplace_action", {
              entity: "agent",
              action: "uninstall",
              result: "failed",
              failure_code: "uninstall_failed",
            });
          }
          if (scopeIsCurrent()) showAgent();
          const { t, errorMessage } = currentText();
          actionToast.error(t("agent.error.deleteFailed"), {
            description: errorMessage(error, t("sidebar.delete.failed")),
            report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },
          });
        }
      }

      const countdown = startUndoCountdown(() => void commit());
      pendingDeletes.set(agentId, () => void commit());
      toast(() => <AgentDeleteUndoToast agent={agent} countdown={countdown} onUndo={undo} />, {
        id: toastId,
        duration: Number.POSITIVE_INFINITY,
        unstyled: true,
        closeButton: false,
        class: "agent-delete-undo-toast-host",
        onDismiss: () => void commit(),
      });
    }

    /** The Undo toasts of hides on this server. A server switch removes them with this scope. */
    const hideToastIds = new Set<string>();
    onCleanup(() => {
      const ids = [...hideToastIds];
      // A write to the Toaster from a scope cleanup stops the reactive system.
      queueMicrotask(() => {
        for (const id of ids) toast.dismiss(id);
      });
    });

    /**
     * Hides or restores an agent. The sidebar moves the agent at once, and the server's answer then
     * replaces the hidden list. If the server refuses, only this agent goes back. The open chat stays
     * open: the user can read it, and the sidebar shows the agent in its Hidden group.
     */
    async function setAgentHiddenByUser(agentId: string, hidden: boolean): Promise<void> {
      if (agentSetupOpen() && creatingAgent()) return;
      const agent = agentList().find((candidate) => candidate.id === agentId);
      if (!agent || userHiddenAgentIds().has(agentId) === hidden) return;
      const serverId = activeServerId();
      const toastId = `agent-hide-${serverId}-${agentId}`;
      const previous = userHiddenAgents().find((entry) => entry.agentId === agentId);
      const withoutAgent = () => userHiddenAgents().filter((entry) => entry.agentId !== agentId);
      applyUserHiddenAgents(
        hidden ? [...withoutAgent(), { agentId, hiddenAt: new Date().toISOString() }] : withoutAgent(),
      );
      if (hidden) {
        const { t } = currentText();
        hideToastIds.add(toastId);
        toast(t("agent.hideUndo.title", { name: agent.name }), {
          id: toastId,
          action: { label: t("agent.hideUndo.action"), onClick: () => void setAgentHiddenByUser(agentId, false) },
          onDismiss: () => hideToastIds.delete(toastId),
          onAutoClose: () => hideToastIds.delete(toastId),
        });
      } else if (hideToastIds.delete(toastId)) {
        toast.dismiss(toastId);
      }
      try {
        const snapshot = await agentsPort().agent.setAgentHidden({ agentId, hidden }, serverId);
        applyUserHiddenAgents(snapshot.agents);
      } catch (error) {
        if (!scopeIsCurrent()) return;
        applyUserHiddenAgents(previous ? [...withoutAgent(), previous] : withoutAgent());
        if (hideToastIds.delete(toastId)) toast.dismiss(toastId);
        const { t, errorMessage } = currentText();
        actionToast.error(t(hidden ? "agent.error.hideFailed" : "agent.error.restoreFailed"), {
          description: errorMessage(error, t("agent.error.hiddenFailed")),
          report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },
        });
      }
    }

    return {
      createAgent,
      createAgentInPlace,
      editAgent,
      duplicateAgent,
      duplicateSection,
      duplicatingSectionIds,
      deleteAgent,
      setAgentHiddenByUser,
    };
  },
});

export const AgentActionsProvider = AgentActions.provider;
export const useAgentActions = AgentActions.use;
