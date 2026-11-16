import { LOCAL_SERVER_ID, type ServerSummary } from "@openbot/contracts/ipc";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { ROUTINE_RUN_COMMAND_CAPABILITY } from "@openbot/contracts/team-protocol/routine-run-command-v1";
import { classifyFailure } from "@openbot/telemetry";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { settingsPanelMaxWidth } from "@openbot/ui/components/SettingsPanel";
import { BROWSER_NEW_TAB_URL } from "@openbot/ui/features/browser/browser-suggestions";
import { SidePanelHeader, SidePanelLauncher, type SidePanelPane } from "@openbot/ui/features/conversation/SidePanel";
import { SideQuestionPanel } from "@openbot/ui/features/conversation/SideQuestionPanel";
import { SubagentPanel } from "@openbot/ui/features/conversation/Subagents";
import { VoicePill } from "@openbot/ui/features/conversation/VoicePill";
import { McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { useChatBubbleStyle } from "../../chat-bubble-style-preference";
import {
  readSidePanelWidth,
  resetSidePanelWidth,
  SIDE_PANEL_DEFAULT,
  saveSidePanelWidth,
} from "../../components/side-panel-width";
import { deviceQuoteShortcut } from "../../send-shortcut-preference";
import { type AgentTemplatePublishCalls, agentTemplatesPort } from "../agent-templates/agent-templates-port";
import { createPublishAgent } from "../agent-templates/PublishAgent";
import { desktopBrowserProfileCalls } from "../browser/browser-profiles-port";
import type { AgentFilesOptions } from "../files/AgentFilesSettings";
import type { ChatFilesSource } from "../files/ChatFilesPanel";
import { canManageStorage, serverHasChannelStorage, serverHasStorage } from "../files/storage-usage";
import { serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { codexLiveAccess } from "../speech/codex-live-access";
import { speechPort } from "../speech/speech-port";
import { cycleSpeechSpeed, speechSpeed } from "../speech/speech-speed";
import { ConversationSideThread } from "./ConversationSideThread";
import { isChatVisualAppShortcut } from "./chat-visual-shortcuts";
import { htmlAttachmentPageHtml, htmlAttachmentPageUrl } from "./chat-visual-url";
import { useConversationController } from "./conversation-controller-context";
import { type AgentNotificationLevelCalls, conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import { agentSkillsMode } from "./installed-skills-source";
import { desktopChatEventRoutinesApi } from "./routine-webhooks-api";
import type { RoutineResultsCalls } from "./routines-port";
import { type CodexLivePort, createCodexLiveConversation } from "./stores/codex-live-conversation-store";
import type { VoiceConversationKind } from "./stores/voice-session-store";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { type HostFolderPick, HostFolderPicker } from "@openbot/ui/features/conversation/HostFolderPicker";
import { Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, Loading, lazy, onSettled, Show, untrack } from "solid-js";
import {
  agentFolderCalls,
  agentInstructionsCalls,
  browseHostFolders,
  type HostFolderPickFn,
  remoteAgentFolderCalls,
} from "./agent-folders-port";
import { conversationPort } from "./conversation-port";

/**
 * The voice conversation with the chat's agent, in a pill at the top of the chat. An agent on this computer,
 * or on a joined server with `live-voice-v1`, uses Codex live voice when the user turned it on in
 * Settings → Voice, whatever the agent's provider: the voice sends each request to the agent. A failed read of that setting keeps the conversation that
 * transcribes on this computer. A conversation that still runs from an earlier visit to the chat shows again.
 * The browser client has only Codex live voice: its runtime gives the port only when the user turned it on.
 */
function VoiceConversationPane(pill: VoicePillPresence) {
  const controller = useConversationController();
  const { props } = useConversationViewScope();
  const running = untrack(() => (props.agent ? controller.voiceSessions.running(props.agent.id) : null));
  const runtimeLive = untrack(() => props.runtime?.liveVoice);
  if (runtimeLive) {
    const liveKind: VoiceConversationKind = running ?? "codex-live";
    return <VoiceConversation kind={liveKind} port={runtimeLive} open={pill.open} onClosed={pill.onClosed} />;
  }
  // Live voice runs in the Codex App Server of the agent's server. An older joined server cannot start
  // it, so its agents transcribe. Without a ChatGPT sign-in of that server's Codex, the voice transcribes.
  const codex = untrack(
    () =>
      (props.server?.kind !== "remote" || serverSupportsCapability(props.server, "live-voice-v1")) &&
      codexLiveAccess(props.agentStatus.providers) !== "signIn",
  );
  const [kind, setKind] = createSignal<VoiceConversationKind | null>(running ?? (codex ? null : "transcribed"));
  if (!running && codex)
    void speechPort()
      .voice.getSpeechSettings()
      .then(
        (settings) => setKind(settings.codexLive ? "codex-live" : "transcribed"),
        () => setKind("transcribed"),
      );
  return (
    <Show when={kind()} keyed>
      {(next) => <VoiceConversation kind={next} open={pill.open} onClosed={pill.onClosed} />}
    </Show>
  );
}

/** The pill is open, or goes back into the top edge and then calls `onClosed`. */
interface VoicePillPresence {
  open: boolean;
  onClosed: () => void;
}

function VoiceConversation(paneProps: VoicePillPresence & { kind: VoiceConversationKind; port?: CodexLivePort }) {
  const controller = useConversationController();
  const { props, startVoiceConversation, endVoiceConversation } = useConversationViewScope();
  const agentId = untrack(() => props.agent?.id);
  if (!agentId) return null;
  const serverId = untrack(() => props.server?.id ?? LOCAL_SERVER_ID);
  const kind = untrack(() => paneProps.kind);
  const port = untrack(() => paneProps.port);
  // The conversation outlives this pill: another chat keeps it, and End stops it.
  const conversation = controller.voiceSessions.open(agentId, kind, () =>
    kind === "codex-live"
      ? createCodexLiveConversation({ agentId, serverId, ...(port ? { port } : {}) })
      : startVoiceConversation(agentId),
  );
  // Codex live voice speaks at the speed of the realtime model, so it has no speed button.
  const transcribed = kind === "transcribed";
  const replySpeed = () => (transcribed ? speechSpeed() : undefined);
  const cycleSpeed = transcribed ? cycleSpeechSpeed : undefined;
  return (
    <Show when={props.agent}>
      {(agent) => (
        <VoicePill
          agent={agent()}
          phase={conversation.phase()}
          muted={conversation.muted()}
          levels={conversation.levels()}
          error={conversation.error()}
          onToggleMute={conversation.toggleMute}
          onInterrupt={conversation.interrupt}
          onEnd={endVoiceConversation}
          speed={replySpeed()}
          onCycleSpeed={cycleSpeed}
          open={paneProps.open}
          onClosed={paneProps.onClosed}
        />
      )}
    </Show>
  );
}

/** @internal Stable HMR boundary for conversation panels. */
export function ConversationPanels(panelProps: { onOpenUsage?: ((trigger: HTMLButtonElement) => void) | undefined }) {
  const controller = useConversationController();
  const bubbleStyle = useChatBubbleStyle();
  const {
    agentReady,
    activateBrowserTab,
    activeBrowserTab,
    agentActivity,
    browserSidebarOpen,
    browserExpandedOpen,
    browserTabs,
    closeShownSidePanelFile,
    closeBrowserTab,
    downloadSidebarFile,
    revealSidebarFile,
    conversationPanelElement,
    filePreviewOpen,
    filesOpen,
    openBrowserAddress,
    openExternalMessageUrl,
    openRoutineRunMessage,
    openSharedFile,
    previewAttachment,
    openSidebarFileExternally,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    previewQuoteId,
    previewFileKey,
    previewWorkspaceAgentId,
    quoteSelection,
    addPageText,
    setPageContext,
    sidebarFileBack,
    openSidebarFileBack,
    props,
    setActiveRightPanel,
    sidePanelWidth,
    setSidePanelWidth,
    handleRoutineSettingsRequest,
    sidebarFilePreview,
    settingsOpen,
    skillSettingsRequest,
    instructionsSettingsRequest,
    routineSettingsRequest,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    updateRuntimeSettings,
    fastMode,
    ultrafast,
    fastModeChange,
    messageLinkRelay,
    openMessageLinkRelay,
    pasteMessageLinkRelay,
    cancelMessageLinkRelay,
    activeRightPanel,
    sidePanel,
    sidePanelOpen,
    setSidePanelMaximized,
    openSidePanelPane,
    toggleSidePanel,
    closeSidePanelPane,
    openSidePanelFile,
    closeSidePanelFile,
    moveSidePanelFile,
    sideQuestion,
    setSideQuestionDraft,
    askSideQuestion,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    voiceConversationOpen,
    panelSubagentId,
    shownPanelThreadId,
    openPanelThread,
    closePanelThread,
    movePanelThreadToChat,
    channel,
    replyJump,
  } = useConversationViewScope();
  const { t, errorMessage } = useText();
  const chatAgentKey = () => (props.agent ? `${props.server?.id ?? "local"}:${props.agent.id}` : null);
  // A channel cannot send the turns of a conversation. Elsewhere the pill stays while the conversation
  // is on, also when its access ends, so End stays in view.
  const voiceKey = () => (voiceConversationOpen() && !channel && chatAgentKey()) || null;
  // When the conversation ends, the pill stays in the page while it goes back into the top edge. A
  // conversation that starts again in that time gets a new pill. Another chat does not show the pill
  // of this one on its way out.
  const [voicePill, setVoicePill] = createSignal<{ key: string } | null>(null);
  const [voicePillClosing, setVoicePillClosing] = createSignal(false);
  createEffect(
    () => ({ key: voiceKey(), chat: chatAgentKey() }),
    ({ key, chat }) => {
      const shown = untrack(voicePill);
      if (key) {
        if (shown?.key !== key || untrack(voicePillClosing)) setVoicePill({ key });
        setVoicePillClosing(false);
      } else if (shown && shown.key === chat) setVoicePillClosing(true);
      else {
        setVoicePill(null);
        setVoicePillClosing(false);
      }
    },
  );
  /** The web client asks the host. Desktop asks main, which asks a joined server's host. */
  const publishCalls = (): AgentTemplatePublishCalls => {
    if (props.runtime?.admin) return props.runtime.admin.agentTemplates;
    const server = props.server;
    if (server?.kind !== "remote") return agentTemplatesPort().agentTemplates;
    const { agent } = agentTemplatesPort();
    return {
      preview: (agentId) => agent.previewAgentTemplate(agentId, server.id),
      publish: (input) => agent.publishAgentTemplate(input, server.id),
      unpublish: (agentId) => agent.unpublishAgentTemplate(agentId, server.id),
    };
  };
  const publishAgent = createPublishAgent((url) => void conversationRuntime(props).openUrl(url), publishCalls);
  // This computer reads the skills of its own agents from the workspace. A joined host publishes its
  // own agents, for an owner or admin, when it serves `agent-publish-v1`.
  // A remote agent's host resolves its settings, so the account defaults of this computer do not apply.
  const localAgentDefaults = () => (props.server?.kind === "local" ? props.agentDefaults : undefined);
  const localFolderCalls = agentFolderCalls();
  // An agent's folders are on the computer that runs it. A joined server serves them through
  // `agent-folders-v1` for an owner or admin, and the folder browser lists the folders of the host.
  const [folderPick, setFolderPick] = createSignal<
    (HostFolderPick & { serverId: string; agentId: string; done: (path: string | null) => void }) | null
  >(null);
  const finishFolderPick = (path: string | null) => {
    const pick = folderPick();
    setFolderPick(null);
    pick?.done(path);
  };
  // The web client gets the calls from its runtime, which gives them only for such a host and user.
  const webFolderApi = createMemo(() => props.runtime?.agentFolders);
  const folderServerId = createMemo(() => {
    if (props.runtime) return webFolderApi() ? props.server?.id : undefined;
    return props.server?.kind === "remote" && serverCanAdminister(props.server, "agent-folders-v1")
      ? props.server.id
      : undefined;
  });
  const folderCalls = createMemo(() => {
    if (!props.runtime && props.server?.kind === "local") return localFolderCalls;
    const serverId = folderServerId();
    if (serverId === undefined) return undefined;
    const api = webFolderApi();
    const pick: HostFolderPickFn = (agentId, mode, start) =>
      new Promise((done) => {
        // A pick that is still open closes as a cancel.
        folderPick()?.done(null);
        const agentName = props.agent?.id === agentId ? props.agent.name : "";
        setFolderPick({ mode, agentName, start, serverId, agentId, done });
      });
    return remoteAgentFolderCalls(serverId, pick, api);
  });
  const browsePickFolders = (path: string | null) => {
    const pick = folderPick();
    if (!pick) return Promise.reject(new Error(t("agentSettings.folders.browse.failed")));
    return browseHostFolders(pick.serverId, pick.agentId, path, webFolderApi());
  };
  const openInstructionsLink = (url: string) => void openExternalMessageUrl(url);
  const localInstructions = { ...agentInstructionsCalls(), openLink: openInstructionsLink };
  // The file on this computer, or on a joined server that lets an owner or admin edit it. The calls
  // follow the server id, so a new summary of the same server keeps the open page.
  const webInstructionsApi = createMemo(() => props.runtime?.agentInstructions);
  const instructionsServerId = createMemo(() => {
    if (props.runtime) return webInstructionsApi() ? props.server?.id : undefined;
    return props.server?.kind === "remote" && serverCanAdminister(props.server, "agent-instructions-v1")
      ? props.server.id
      : undefined;
  });
  const instructionsCalls = createMemo(() => {
    if (!props.runtime && props.server?.kind === "local") return localInstructions;
    const serverId = instructionsServerId();
    return serverId === undefined
      ? undefined
      : { ...agentInstructionsCalls(serverId, webInstructionsApi()), openLink: openInstructionsLink };
  });
  // A joined server's routine destinations, for an owner or admin. The web client gets the calls from its runtime.
  // Copy run command: this computer, or a joined host that serves `routine-run-command-v1` to this
  // owner or admin. The command runs in a shell on the host.
  const routineRunCommand = createMemo(() => {
    if (props.runtime) return props.runtime.routineRunCommand;
    return serverCanAdminister(props.server, ROUTINE_RUN_COMMAND_CAPABILITY)
      ? window.openbot.agent.automationRunCommand
      : undefined;
  });
  const routineResultsServerId = createMemo((): string | RoutineResultsCalls | undefined => {
    if (props.runtime) return props.runtime.routineResultCalls;
    return props.server?.kind === "remote" && serverCanAdminister(props.server, "routine-results-v1")
      ? props.server.id
      : undefined;
  });
  // The memory cap of a joined server, for an owner or admin. It is read each time the settings open,
  // so a change in Server Settings shows there. A member sees no cap; the host still refuses a memory past it.
  const memoryLimitServerId = createMemo(() => {
    if (props.runtime) return props.runtime.agentMemoryLimit ? props.server?.id : undefined;
    return props.server?.kind === "remote" && serverCanAdminister(props.server, AGENT_MEMORY_LIMIT_CAPABILITY)
      ? props.server.id
      : undefined;
  });
  const readMemoryLimit = (serverId: string): Promise<number> => {
    const web = props.runtime?.agentMemoryLimit;
    if (props.runtime) return web ? web() : Promise.reject(new Error(t("conversation.panels.tryAgain")));
    return window.openbot.hostAdmin.getAgentMemoryLimit(serverId).then(({ limit }) => limit);
  };
  const [remoteMemoryLimit, setRemoteMemoryLimit] = createSignal<{ serverId: string; limit: number } | null>(null);
  createEffect(
    () => (settingsOpen() ? memoryLimitServerId() : undefined),
    (serverId) => {
      if (serverId === undefined) return;
      let current = true;
      untrack(() => readMemoryLimit(serverId)).then(
        (limit) => {
          if (current) setRemoteMemoryLimit({ serverId, limit });
        },
        () => {},
      );
      return () => {
        current = false;
      };
    },
  );
  /** The cap that the memories page shows: this computer's, or the one read from the joined server. */
  const agentMemoryLimit = (): number | undefined => {
    if (props.server?.kind === "local") return props.agentMemoryLimit;
    const remote = remoteMemoryLimit();
    return remote && remote.serverId === memoryLimitServerId() ? remote.limit : undefined;
  };
  const canPublish = () =>
    props.runtime
      ? props.runtime.admin !== undefined && serverCanAdminister(props.server, "agent-publish-v1")
      : props.server?.kind === "local" ||
        (props.server?.kind === "remote" && serverCanAdminister(props.server, "agent-publish-v1"));
  // The web client asks the host directly; desktop goes through main for this computer and for a joined server.
  // The calls follow the server id, so a new summary of the same server keeps the loaded profiles.
  const browserProfileServerId = createMemo(() =>
    props.server && serverSupportsCapability(props.server, BROWSER_PROFILES_CAPABILITY) ? props.server.id : undefined,
  );
  const browserProfileCalls = createMemo(() => {
    if (props.runtime) return props.runtime.browserProfiles;
    const serverId = browserProfileServerId();
    return serverId === undefined ? undefined : desktopBrowserProfileCalls(serverId);
  });
  // Any member keeps an own level for each agent. The calls follow the server id, as above, and a
  // new server gets new calls, so its panel does not show the levels of the server before.
  const notificationLevelServerId = createMemo(() =>
    props.server && serverSupportsCapability(props.server, AGENT_NOTIFICATION_LEVELS_CAPABILITY)
      ? props.server.id
      : undefined,
  );
  const notificationLevelCalls = createMemo((): AgentNotificationLevelCalls | undefined => {
    const serverId = notificationLevelServerId();
    if (serverId === undefined) return undefined;
    const remote = props.runtime;
    if (remote) {
      const calls = remote.agentNotificationLevels;
      return calls ? { list: () => calls.list() } : undefined;
    }
    return {
      list: () => conversationPort().agent.listAgentNotificationLevels(serverId),
      subscribe: (listener) =>
        conversationPort().agent.onScopedEvent((scoped) => {
          if (scoped.serverId === serverId && scoped.event.type === "agent-notification-levels-changed")
            listener({ server: scoped.event.server, agents: scoped.event.agents });
        }),
    };
  });
  const openNotificationSettings = (trigger: HTMLElement) => {
    const serverId = props.server?.id;
    if (serverId) props.onOpenNotificationSettings?.(serverId, trigger);
  };
  /** Desktop reads storage through preload. The web client needs the storage calls of its runtime. */
  const storageReachable = () => !props.runtime || props.runtime.storageCalls !== undefined;
  let browserPreviewTrigger: HTMLButtonElement | undefined;
  /** The files of the chat, or of the channel. A chat without a thread has no files. */
  const filesSource = (): ChatFilesSource | undefined => {
    if (channel) return { scope: "channel", channelId: channel.id };
    const threadId = props.agent?.threadId;
    return threadId ? { scope: "conversation", conversationId: threadId } : undefined;
  };
  /** A joined server lists the files of a channel only with `storage-channel-v1`. */
  const filesServer = () => {
    const server = props.server;
    if (!storageReachable()) return undefined;
    if (channel) return serverHasChannelStorage(server) ? server : undefined;
    return serverHasStorage(server) ? server : undefined;
  };
  const filesTitle = () => channel?.name() ?? props.agent?.name ?? "this chat";
  /** A channel message shows in this view. An agent chat opens it as a search result does. */
  function showFileMessage(messageId: string) {
    if (channel) void replyJump.reveal(messageId, undefined, undefined);
    else void props.onOpenSearchMessage?.(messageId);
  }
  /**
   * A channel has a Browser pane while a member can open a tab there, or while its members' threads
   * have tabs. A member with no thread in the channel yet has no tab there.
   */
  const channelBrowserPane = () => !channel || channel.browserOwner() !== null || browserTabs().length > 0;
  /**
   * The panes this chat can open. The web client has a Files pane only when its runtime has the storage
   * calls, and a chat without a thread has no files.
   */
  const sidePanelPanes = createMemo((): SidePanelPane[] => [
    ...(props.browserEnabled !== false && channelBrowserPane() ? (["browser"] as const) : []),
    ...(filesServer() && filesSource() ? (["files"] as const) : []),
    ...(props.agent || channel ? (["settings"] as const) : []),
  ]);
  /** The subagent in the Subagent pane, from the newest turn that has it. */
  const panelSubagent = createMemo(() => {
    const subagentId = panelSubagentId();
    if (!subagentId) return undefined;
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const found = props.messages[index]?.subagents?.find((subagent) => subagent.id === subagentId);
      if (found) return found;
    }
    return undefined;
  });
  /** All panes of the side panel have one width, so they also have one largest width. */
  const sidePanelMaxWidth = () => settingsPanelMaxWidth(conversationPanelElement());
  /** Agent settings > Files. */
  const agentFiles = (server: ServerSummary | undefined, agentId: string): AgentFilesOptions | undefined => {
    if (!storageReachable() || !serverHasStorage(server)) return undefined;
    return {
      serverId: server.id,
      calls: props.runtime?.storageCalls,
      canManage: canManageStorage(server),
      onOpenWorkspace:
        server.kind === "local"
          ? () =>
              void conversationPort()
                .storage.openLocation({ agentId })
                .catch((error) =>
                  actionToast.error(t("conversation.panels.openWorkspaceFailed"), {
                    ...{
                      description: errorMessage(error, t("conversation.panels.tryAgain")),
                    },
                    report: { operation: "turn", source: "action", cause_code: classifyFailure(error) },
                  }),
                )
          : undefined,
      onPreviewFile: (file) => void previewAttachment(file),
      onShowMessage: (messageId) => void openRoutineRunMessage(messageId),
      // The agent's chat is behind the settings, so closing them opens it.
      onOpenConversation: () => setActiveRightPanel("none"),
    };
  };
  createEffect(
    () => ({ expanded: browserExpandedOpen(), suspended: props.globalOverlayOpen || props.remoteDesktopVisible }),
    ({ expanded, suspended }) => {
      if (!expanded || suspended) return;
      const frame = conversationPanelElement()?.closest<HTMLElement>(".app-frame");
      if (!frame) return;
      const wasInert = frame.inert;
      frame.inert = true;
      return () => {
        frame.inert = wasInert;
      };
    },
  );
  createEffect(browserSidebarOpen, (open, previous) => {
    if (open && previous === false) onSettled(() => browserPreviewTrigger?.focus());
  });
  /**
   * A plain accessor, not a conditional in the prop: the compiler makes that a memo, and the tabs read
   * it first in an effect callback when the last tab closes, which halts the reactive system.
   */
  const selectedPane = () => (activeRightPanel() === "side-panel" ? null : sidePanel().selected);
  /** The side thread that shows, and whose tab is selected. */
  const shownThread = () => (activeRightPanel() === "thread" ? shownPanelThreadId() : null);
  /** The browser tabs that an agent acts in now. Their previews show the page more often. */
  const busyBrowserTabIds = createMemo(
    () => new Set(props.browserControlState.sessions.flatMap((session) => (session.tabId ? [session.tabId] : []))),
  );
  /** With no side thread to show, the side panel lists the panes. */
  const launcherShown = () =>
    activeRightPanel() === "side-panel" || (activeRightPanel() === "thread" && shownPanelThreadId() === null);
  /** The file that shows, and whose tab is selected. */
  const shownFile = () => (filePreviewOpen() ? sidePanel().file : null);
  /** Opens the routine's side thread in the chat, and closes the settings that cover it. */
  const openRoutineThread = async (routineId: string): Promise<boolean> => {
    const opened = (await props.threads?.onOpenRoutineThread(routineId)) ?? false;
    if (opened) setActiveRightPanel("none");
    return opened;
  };
  const sideThreadTabs = () => props.threads?.side.tabs ?? [];
  const moveSideThread = (id: string, index: number) => props.threads?.side.onMove(id, index);
  return (
    <>
      <HostFolderPicker request={folderPick()} browse={browsePickFolders} onDone={finishFolderPick} />
      <Show when={sidePanelOpen()}>
        <SidePanelHeader
          panes={sidePanel().panes}
          selected={selectedPane()}
          available={sidePanelPanes()}
          maximized={sidePanel().maximized}
          settingsLabel={channel ? t("channel.settings.title") : undefined}
          onSelect={openSidePanelPane}
          onClose={closeSidePanelPane}
          threads={{
            items: sideThreadTabs(),
            selectedId: shownThread(),
            onSelect: openPanelThread,
            onClose: closePanelThread,
            onMove: moveSideThread,
            onToChat: movePanelThreadToChat,
          }}
          files={{
            items: sidePanel().files,
            selectedKey: shownFile(),
            onSelect: openSidePanelFile,
            onClose: closeSidePanelFile,
            onMove: moveSidePanelFile,
          }}
          onToggleMaximized={() => setSidePanelMaximized(!sidePanel().maximized)}
          onCollapse={toggleSidePanel}
          onNewBrowserTab={() => {
            // The new tab shows in the Browser pane, so the pane comes to the front first.
            openSidePanelPane("browser");
            void openBrowserAddress(BROWSER_NEW_TAB_URL, true);
          }}
        />
      </Show>

      <Show when={launcherShown()}>
        <aside
          id="side-panel-launcher"
          class="browser-panel side-panel-empty"
          aria-label={t("conversation.sidePanel.label")}
        >
          {/* The list has the width of the panes, so a drag here also sets the width of each pane. */}
          <PanelResizer
            class="right-panel-resizer"
            label={t("conversation.sidePanel.resize")}
            controls="side-panel-launcher"
            direction="right"
            value={sidePanelWidth()}
            defaultValue={SIDE_PANEL_DEFAULT}
            min={SIDE_PANEL_DEFAULT}
            max={sidePanelMaxWidth}
            onResize={setSidePanelWidth}
            onResizeEnd={saveSidePanelWidth}
            // A narrower chat makes the panel narrower only for now. When the chat gets wider, the panel goes
            // back to the width from the last drag.
            onParentResize={() => setSidePanelWidth(Math.round(Math.min(sidePanelMaxWidth(), readSidePanelWidth())))}
            onReset={() => {
              resetSidePanelWidth();
              setSidePanelWidth(SIDE_PANEL_DEFAULT);
            }}
          />
          <SidePanelLauncher
            available={sidePanelPanes()}
            settingsLabel={channel ? t("channel.settings.title") : undefined}
            onOpen={openSidePanelPane}
          />
        </aside>
      </Show>

      <Show when={filePreviewOpen() && sidebarFilePreview()}>
        {(file) => {
          const attached = () => {
            const source = file().source;
            return source.kind === "attachment" ? source.attachment : null;
          };
          return (
            <Loading>
              <FilePreviewPanel
                allowExternalOpen={!props.runtime}
                macWindowControls={props.platform === "darwin"}
                preview={file().preview}
                directory={file().directory ?? null}
                agents={props.agents}
                maxWidth={sidePanelMaxWidth}
                onWidthChange={setSidePanelWidth}
                onOpenLink={(url) => void openExternalMessageUrl(url)}
                onOpenSharedFile={(path) => openSharedFile(path, "here")}
                onOpenWorkspaceFile={previewWorkspaceAgentId() ? openWorkspaceFolderEntry : undefined}
                onOpenWorkspaceFolder={openWorkspaceFolder}
                onBack={sidebarFileBack() === null ? undefined : openSidebarFileBack}
                sourceUrl={attached()?.previewUrl ?? null}
                pageUrl={htmlAttachmentPageUrl(attached()) ?? file().preview?.pageUrl}
                pageHtml={props.runtime?.visualPage ? htmlAttachmentPageHtml(attached(), file().preview) : undefined}
                fileKey={previewFileKey()}
                selectionQuoteId={previewQuoteId()}
                // A page quotes as a passage of its file, so the quote opens the page again.
                onPageQuote={(text) => {
                  const quoteId = previewQuoteId();
                  if (quoteId) quoteSelection(quoteId, text);
                }}
                // The page state goes with the message that holds the page, as in the chat.
                onPageContext={(text) => {
                  const id = attached()?.id;
                  const message = id && props.messages.find((item) => item.attachments?.some((file) => file.id === id));
                  if (message) setPageContext(message, text);
                }}
                onPageMessage={addPageText}
                isPageAppShortcut={isChatVisualAppShortcut}
                quoteShortcut={deviceQuoteShortcut(props.platform)}
                onOpenExternally={openSidebarFileExternally}
                onDownload={downloadSidebarFile}
                /* A browser cannot show a file in the file manager. */
                onReveal={props.runtime ? undefined : revealSidebarFile}
                onClose={closeShownSidePanelFile}
              />
            </Loading>
          );
        }}
      </Show>

      <Show when={filesOpen() && filesServer()}>
        {(server) => (
          <Show when={filesSource()}>
            {(source) => (
              <Loading>
                <ChatFilesPanel
                  serverId={server().id}
                  source={source()}
                  conversationTitle={filesTitle()}
                  canManage={canManageStorage(server())}
                  onClose={() => closeSidePanelPane("files")}
                  onPreviewFile={(file) => void previewAttachment(file)}
                  onShowMessage={showFileMessage}
                  calls={props.runtime?.storageCalls}
                />
              </Loading>
            )}
          </Show>
        )}
      </Show>

      <Show when={activeRightPanel() === "question" && props.agent}>
        {(agent) => (
          <SideQuestionPanel
            agent={agent()}
            bubbleStyle={bubbleStyle()}
            agents={props.agents}
            exchanges={sideQuestion().exchanges}
            skills={installedSkills()}
            skillsLoadFailed={installedSkillsLoadFailed()}
            mcpServers={mcpServers()}
            error={sideQuestion().error}
            draft={sideQuestion().draft}
            focusRequest={sideQuestion().focusRequest}
            onDraftChange={setSideQuestionDraft}
            onAsk={askSideQuestion}
            onClosePanel={() => closeSidePanelPane("question")}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            macWindowControls={props.platform === "darwin"}
          />
        )}
      </Show>

      {/* Keyed, so another agent or server gets its own conversation; End in the pill ends it. */}
      <Show when={voicePill()} keyed>
        {(shown) => (
          <VoiceConversationPane
            open={!voicePillClosing()}
            onClosed={() => {
              if (voicePill() !== shown) return;
              setVoicePill(null);
              setVoicePillClosing(false);
            }}
          />
        )}
      </Show>

      {/* Keyed, so each side thread gets its own messages and read state. */}
      <Show when={shownThread()} keyed>
        {(threadId) => <ConversationSideThread threadId={threadId} />}
      </Show>

      <Show when={activeRightPanel() === "subagent"}>
        <SubagentPanel
          subagent={panelSubagent()}
          agentName={props.agent?.name ?? ""}
          onClosePanel={() => closeSidePanelPane("subagent")}
        />
      </Show>

      <Show when={browserSidebarOpen() || browserExpandedOpen()}>
        <BrowserPreviewSidebar
          tabs={browserTabs()}
          busyTabIds={busyBrowserTabIds()}
          hidden={browserExpandedOpen()}
          suspended={props.browserVisibilitySuspended || props.globalOverlayOpen || props.remoteDesktopVisible}
          contextKey={`${props.server?.id ?? "local"}:${props.agent?.id ?? ""}`}
          maxWidth={sidePanelMaxWidth}
          onWidthChange={setSidePanelWidth}
          capturePreview={props.runtime?.browser.capturePreview}
          onOpenTab={(tabId, trigger) => {
            browserPreviewTrigger = trigger;
            if (activeBrowserTab()?.id !== tabId) activateBrowserTab(tabId);
            setActiveRightPanel("browser-expanded");
          }}
          onCloseTab={(tabId) => void closeBrowserTab(tabId)}
          onNewTab={() => void openBrowserAddress(BROWSER_NEW_TAB_URL, true)}
        />
      </Show>

      <Show when={browserSidebarOpen() || browserExpandedOpen()}>
        <Portal>
          <div class="ui-dialog-overlay browser-expanded-backdrop" hidden={!browserExpandedOpen()} aria-hidden="true" />
          <BrowserFullViewAdapter />
        </Portal>
      </Show>

      {channel ? (
        <Show when={settingsOpen()}>
          <channel.SettingsPane
            maxWidth={sidePanelMaxWidth}
            onWidthChange={setSidePanelWidth}
            onClose={() => closeSidePanelPane("settings")}
          />
        </Show>
      ) : null}
      <Show when={settingsOpen() && props.agent}>
        {(agent) => (
          <Loading>
            <AgentSettingsPanel
              remoteClient={Boolean(props.runtime)}
              localHost={props.server?.kind === "local"}
              routineRunPlace={
                props.server?.kind === "remote" && serverSupportsCapability(props.server, "routine-run-place-v1")
              }
              routinesOnce={
                props.server?.kind === "remote" && serverSupportsCapability(props.server, "routines-once-v1")
              }
              routineResultsServerId={routineResultsServerId()}
              routineRunCommand={routineRunCommand()}
              folders={folderCalls()}
              instructionsFile={instructionsCalls()}
              sessionSettingsEditable={serverCanAdminister(props.server, "agent-session-settings-v1")}
              adminCalls={props.runtime?.admin}
              skillCatalog={props.runtime?.skillCatalog}
              skillsMarketplaceOpen={props.skillsMarketplaceOpen}
              workspaceCovered={props.workspaceCovered}
              onAddFromMarketplace={
                serverCanAdminister(props.server, "skills-admin-v1") ? props.onOpenMarketplace : undefined
              }
              skillsMode={agentSkillsMode(props.server, props.runtime)}
              skillsServerId={props.server?.id}
              previewWorkspaceFile={(path) =>
                conversationRuntime(props).agent.previewWorkspaceFile({ agentId: agent().id, path })
              }
              tablesVisible={
                (!props.runtime || props.runtime.admin !== undefined) &&
                serverCanAdminister(props.server, "shared-tables-v1")
              }
              autoApprove={props.agentAutoApproves}
              onUpdatePermissions={props.onUpdateAgentPermissions}
              computerUseEditable={props.server?.kind === "local" || props.remoteComputerUseLoaded === true}
              automationEditable={
                props.server?.kind === "local" ||
                (serverCanAdminister(props.server, "agent-host-settings-v1") && agent().allowAutomation !== undefined)
              }
              busyMessageModeEditable={props.server?.kind === "local" || props.remoteBusyMessageModeLoaded === true}
              busyMessageDefaultIsHost={props.server?.kind === "remote"}
              newChatEditable={props.server?.kind === "local" || props.remoteNewChatLoaded === true}
              quickAcknowledgementEditable={props.server?.kind === "local" || props.remotePlanCardLoaded === true}
              // The same speed and Speed select as the model picker of the chat header.
              fastMode={fastMode()}
              ultrafast={ultrafast()}
              onFastModeChange={fastModeChange()}
              backupModelsEditable={props.server?.kind === "local" || props.remoteBackupModelsLoaded === true}
              usageLimited={props.usageLimited}
              providerFailed={props.providerFailed}
              defaultBusyMessageMode={props.defaultBusyMessageMode}
              agentDefaults={localAgentDefaults()}
              memoryLimit={agentMemoryLimit()}
              agents={props.agents}
              onStartNewChat={props.onClearAgentContext}
              onDeleteHistory={props.onDeleteAgentHistory}
              onCreateSkill={
                serverCanAdminister(props.server, "skills-admin-v1") &&
                agentReady() &&
                !controller.submitting() &&
                controller.voicePhase() === "idle" &&
                !controller.editingDeliveryId()
                  ? () => {
                      if (!props.agent || !props.server) return;
                      controller.startSkillCreation({ serverId: props.server.id, agentId: props.agent.id });
                      setActiveRightPanel("none");
                    }
                  : undefined
              }
              onTrySkill={
                serverCanAdminister(props.server, "skills-admin-v1") &&
                agentReady() &&
                !controller.submitting() &&
                controller.voicePhase() === "idle" &&
                !controller.editingDeliveryId()
                  ? (skill) => {
                      if (!props.agent || !props.server) return;
                      controller.appendSkillExample({ serverId: props.server.id, agentId: props.agent.id }, skill);
                      setActiveRightPanel("none");
                    }
                  : undefined
              }
              onOpenUsage={panelProps.onOpenUsage}
              onPublish={canPublish() ? () => publishAgent.open(agent().id) : undefined}
              agent={agent()}
              runtimeSettings={{
                provider: settingsProvider(),
                model: settingsModel(),
                reasoningEffort: settingsReasoning(),
              }}
              agentStatus={props.agentStatus}
              providerRuntimeStatuses={props.providerRuntimeStatuses}
              customProviders={props.customProviders}
              customAgents={props.customAgents}
              onDownloadProvider={props.onDownloadProvider}
              onCancelProviderDownload={props.onCancelProviderDownload}
              onConnectProvider={props.onConnectProvider}
              canConnectProvider={props.canConnectProvider}
              onManageProviders={props.onManageProviders}
              browserProfileCalls={
                serverCanAdminister(props.server, BROWSER_PROFILES_CAPABILITY) ? browserProfileCalls() : undefined
              }
              onManageBrowserProfiles={props.onManageBrowserProfiles}
              notificationLevelCalls={notificationLevelCalls()}
              serverNotificationLevel={props.server?.notificationLevel}
              onOpenNotificationSettings={
                props.onOpenNotificationSettings && props.server ? openNotificationSettings : undefined
              }
              modelOptions={props.modelOptions}
              working={agentActivity() === "Working"}
              maxWidth={sidePanelMaxWidth}
              onClose={() => closeSidePanelPane("settings")}
              onWidthChange={setSidePanelWidth}
              onUpdateAgent={props.onUpdateAgent}
              onUpdateRuntimeSettings={updateRuntimeSettings}
              onSetAgentAvatar={props.onSetAgentAvatar}
              skillSelectionRequest={skillSettingsRequest()?.agentId === agent().id ? skillSettingsRequest() : null}
              instructionsRequest={
                instructionsSettingsRequest()?.agentId === agent().id ? instructionsSettingsRequest() : null
              }
              routineSelectionRequest={
                routineSettingsRequest()?.agentId === agent().id ? routineSettingsRequest() : null
              }
              onRoutineSelectionRequestHandled={handleRoutineSettingsRequest}
              onOpenRoutineRun={props.onOpenSearchMessage ? openRoutineRunMessage : undefined}
              onOpenRoutineThread={props.threads ? openRoutineThread : undefined}
              files={agentFiles(props.server, agent().id)}
              eventRoutines={desktopChatEventRoutinesApi(props.server, props.runtime)}
              routines={props.runtime?.routines}
              memoriesApi={props.runtime?.agentMemories}
            />
          </Loading>
        )}
      </Show>

      {publishAgent.dialog()}
      {/* A sign-in link of the host's agent, when this computer cannot take its callback: the user pastes
          the address that the browser shows. */}
      <Show when={messageLinkRelay()} keyed>
        {(relay) => (
          <McpSignInRelayDialog
            name={relay.page.authorizeHost}
            hostName={props.server?.name ?? ""}
            page={relay.page}
            onOpen={openMessageLinkRelay}
            onPaste={pasteMessageLinkRelay}
            onCancel={cancelMessageLinkRelay}
          />
        )}
      </Show>
    </>
  );
}

const AgentSettingsPanel = lazy(loadAgentSettingsPanel);
const BrowserFullViewAdapter = lazy(() => import("./BrowserFullViewAdapter"));
const FilePreviewPanel = lazy(() => import("./FilePreviewPanel"));
const ChatFilesPanel = lazy(() => import("../files/ChatFilesPanel"));

const BrowserPreviewSidebar = lazy(() => import("./BrowserPreviewSidebar"));
