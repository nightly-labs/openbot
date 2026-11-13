import { foreignProvider, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentModelId,
  type AgentProviderRef,
  type AgentReasoningEffort,
  agentNextProviderAccountId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerDisplayName,
} from "@openbot/contracts/ipc";
import { reasoningLabel } from "@openbot/ui/components/ProviderModelPicker";
import { findModelOption, providerAccountName } from "@openbot/ui/components/provider-accounts";
import { ConversationHeader as SharedConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { ThreadHeader } from "@openbot/ui/features/conversation/threads/ThreadHeader";
import { DRAFT_THREAD_ID, MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { Show } from "solid-js";
import { actionToast } from "../../action-toast";
import { useConversationViewScope } from "./conversation-scope";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

/** The runtime of the running turn, or of the next one, as the "After this turn" badge names it. */
interface BadgeRuntime {
  provider: AgentProviderRef;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  providerAccountId?: string | undefined;
}

import { useText } from "@openbot/ui/text";

/** @internal Stable HMR boundary for conversation header. */
export function ConversationHeader() {
  const { t } = useText();
  const {
    actingBrowserControl,
    agentActivity,
    browserControlAgent,
    channel,
    fastMode,
    ultrafast,
    fastModeChange,
    props,
    runningTurnRuntime,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    setActiveRightPanel,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    sidePanelOpen,
    sideThreadOpen,
    messagePins,
    replyJump,
    toggleSidePanel,
    moveThreadToPanel,
  } = useConversationViewScope();
  const runningThreads = () => props.threads?.running ?? 0;
  /** While a side thread is open, the agent's name goes back to the agent's own chat. */
  const openMainChat = () => {
    const header = props.threads?.header;
    return header && sideThreadOpen() ? () => header.onOpen(MAIN_THREAD_ID) : undefined;
  };
  /** With thread tabs, the agent's name is the tab of the agent's own chat. */
  const titleSelected = () => (props.threads ? !sideThreadOpen() : undefined);
  /** The chat in the main view: the open side thread, a new thread, or undefined for the agent's own chat. */
  const viewTaskId = () => (sideThreadOpen() ? (props.threads?.open?.id ?? DRAFT_THREAD_ID) : undefined);
  /**
   * Opens a pin in its chat: in place in the agent's own chat, else in the tab of its thread, which
   * reads the part around it. A pin whose message or thread is gone shows a toast, and the list reads again.
   * A later click replaces an earlier one that is still loading, so the earlier one shows no toast.
   */
  let pinOpens = 0;
  async function openPin(key: string): Promise<void> {
    const pin = messagePins.pin(key);
    if (!pin) return;
    const open = ++pinOpens;
    const opened =
      pin.taskId === null && !sideThreadOpen()
        ? await replyJump.jumpTo(pin.messageId)
        : ((await props.threads?.onOpenMessage(pin.taskId, pin.messageId)) ?? false);
    if (opened || open !== pinOpens) return;
    actionToast.error(t("chat.pins.missing"));
    messagePins.load();
  }
  /** The pins of all chats of the agent. The pins of the chat in view come first. */
  const pinnedMessages = () => {
    if (!messagePins.available()) return undefined;
    return {
      pins: messagePins.items(viewTaskId()),
      agents: props.agents,
      onOpenChange: (open: boolean) => {
        if (open) messagePins.load();
      },
      onJump: (key: string) => void openPin(key),
      onUnpin: (key: string) => {
        const pin = messagePins.pin(key);
        if (pin) messagePins.set(pin.taskId ?? undefined, pin.messageId, false);
      },
    };
  };
  const working = () => agentActivity() === "Working";
  const providerName = (provider: AgentProviderRef) =>
    isKnownAgentProvider(provider) ? providerDisplayName(provider) : String(provider);
  const accountId = (runtime: BadgeRuntime) => runtime.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  const accountName = (runtime: BadgeRuntime) =>
    providerAccountName(
      t,
      props.agentStatus?.providers?.find((status) => status.id === runtime.provider)?.accounts ?? [],
      accountId(runtime),
    );
  /** Each part shows only where the two runtimes differ, so a model change alone names only the models. */
  const runtimeLabel = (runtime: BadgeRuntime, other: BadgeRuntime) => {
    const parts = [
      findModelOption(props.modelOptions, props.agentStatus?.providers, runtime.provider, runtime.model)?.name ??
        runtime.model,
    ];
    if (runtime.provider !== other.provider) parts.unshift(providerName(runtime.provider));
    else if (accountId(runtime) !== accountId(other)) parts.unshift(accountName(runtime));
    if (runtime.reasoningEffort !== other.reasoningEffort) parts.push(reasoningLabel(runtime.reasoningEffort, t));
    return parts.join(" · ");
  };
  /** A change chosen during a turn, in any thread. It applies from the next turn. */
  const pendingModel = () => {
    const agent = props.agent;
    if (!agent || !(working() || runningThreads() > 0)) return undefined;
    const running: BadgeRuntime = (working() ? runningTurnRuntime() : null) ?? agent;
    const next: BadgeRuntime = agent.pendingRuntime ?? {
      provider: settingsProvider(),
      model: settingsModel(),
      reasoningEffort: settingsReasoning(),
      providerAccountId: agent.providerAccountId,
    };
    if (
      running.provider === next.provider &&
      running.model === next.model &&
      running.reasoningEffort === next.reasoningEffort &&
      accountId(running) === accountId(next)
    )
      return undefined;
    return { running: runtimeLabel(running, next), next: runtimeLabel(next, running) };
  };
  return (
    <SharedConversationHeader
      agent={props.agent}
      title={channel ? <channel.HeaderTitle onOpenSettings={() => setActiveRightPanel("settings")} /> : undefined}
      onSettingsIntent={() => void loadAgentSettingsPanel()}
      onOpenSettings={() => setActiveRightPanel("settings")}
      onOpenChat={openMainChat()}
      titleSelected={titleSelected()}
      pendingModel={pendingModel()}
      modelPicker={{
        provider: settingsProvider(),
        foreignProvider: props.agent ? foreignProvider(props.agent.provider) : undefined,
        value: settingsModel(),
        reasoningEffort: settingsReasoning(),
        modelOptions: props.modelOptions,
        agentStatus: props.agentStatus,
        runtimeStatuses: props.providerRuntimeStatuses,
        customProviders: props.customProviders,
        customAgents: props.customAgents,
        onDownloadProvider: props.onDownloadProvider,
        onCancelProviderDownload: props.onCancelProviderDownload,
        onConnectProvider: props.onConnectProvider,
        canConnectProvider: props.canConnectProvider,
        onManageProviders: props.onManageProviders,
        // A model, effort, provider or account chosen during a turn applies from the next turn.
        disabledReason: t("conversation.header.modelsUnavailable"),
        accountChoice: true,
        providerAccountId: props.agent ? agentNextProviderAccountId(props.agent) : undefined,
        accountUsage: props.accountUsage,
        onChange: (model, provider, accountId, effort) =>
          void selectAndConfirmModel(model, provider, accountId, effort),
        onReasoningEffortChange: (effort) => void selectAndConfirmReasoning(effort),
        fastMode: fastMode(),
        ultrafast: ultrafast(),
        onFastModeChange: fastModeChange(),
      }}
      remoteControl={
        props.remoteDesktopEnabled !== false && props.server?.kind === "remote"
          ? {
              enabled: Boolean(props.remoteDesktopSessionActive || props.server.state === "online"),
              active: Boolean(props.remoteDesktopSessionActive),
              visible: Boolean(props.remoteDesktopVisible),
              onOpen: (trigger) => {
                if (props.server) void props.onOpenRemoteDesktop(props.server.id, trigger);
              },
            }
          : undefined
      }
      threads={
        <Show when={props.threads}>
          {(threads) => <ThreadHeader {...threads().header} onMoveToSide={moveThreadToPanel} />}
        </Show>
      }
      pinnedMessages={pinnedMessages()}
      sidePanel={
        channel?.readOnly()
          ? undefined
          : {
              open: sidePanelOpen(),
              actingAgentName: actingBrowserControl()
                ? (browserControlAgent()?.name ?? t("conversation.header.agentFallback"))
                : undefined,
              onToggle: toggleSidePanel,
            }
      }
    />
  );
}
