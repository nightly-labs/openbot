import { LOCAL_SERVER_ID, type ServerSummary } from "@openbot/contracts/ipc";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { ROUTINE_RUN_COMMAND_CAPABILITY } from "@openbot/contracts/team-protocol/routine-run-command-v1";
import { WORKSPACE_DIRECTORY_CAPABILITY } from "@openbot/contracts/team-protocol/workspace-directory-v1";
import { classifyFailure } from "@openbot/telemetry";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { settingsPanelMaxWidth } from "@openbot/ui/components/SettingsPanel";
import {
  BrowserPageCover,
  type BrowserPageMenu,
  type CoverBrowserPage,
} from "@openbot/ui/features/browser/browser-page-cover";
import { BROWSER_NEW_TAB_URL, browserDisplayUrl } from "@openbot/ui/features/browser/browser-suggestions";
import {
  type SidePanelBrowsers,
  SidePanelHeader,
  SidePanelLauncher,
  type SidePanelMove,
  type SidePanelPane,
  type SidePanelPaneBadge,
  SidePanelToggle,
} from "@openbot/ui/features/conversation/SidePanel";
import { SideQuestionPanel } from "@openbot/ui/features/conversation/SideQuestionPanel";
import { SubagentPanel } from "@openbot/ui/features/conversation/Subagents";
import { ThreadsPane } from "@openbot/ui/features/conversation/threads/ThreadsPane";
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
import { moveBrowserTab, orderedBrowserTabs } from "../browser/browser-tab-session";
import type { AgentFilesOptions } from "../files/AgentFilesSettings";
import type { ChatFilesSource } from "../files/ChatFilesPanel";
import { canManageStorage, serverHasChannelStorage, serverHasStorage } from "../files/storage-usage";
import { useRemoteChatContent } from "../servers/remote-chat-content";
import { serverCanAdminister, serverCanManageMcp, serverSupportsCapability } from "../servers/server-capabilities";
import { codexLiveAccess } from "../speech/codex-live-access";
import { speechPort } from "../speech/speech-port";
import { cycleSpeechSpeed, speechSpeed } from "../speech/speech-speed";
import { openedAttachmentUrl } from "./attachment-preview";
import { ConversationSideThread } from "./ConversationSideThread";
import { isChatVisualAppShortcut } from "./chat-visual-shortcuts";
import { htmlAttachmentPageUrl, htmlFilePageHtml } from "./chat-visual-url";
import { useConversationController } from "./conversation-controller-context";
import { type AgentNotificationLevelCalls, conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import { agentSkillsMode } from "./installed-skills-source";
import { desktopChatEventRoutinesApi } from "./routine-webhooks-api";
import type { RoutineResultsCalls } from "./routines-port";
import { pageTabsShown, showPageTabs } from "./side-panel-page-tabs";
import { useSidePanelToggle } from "./side-panel-toggle";
import {
  lowerSplitShare,
  SIDE_MAIN_GROUP_MIN,
  SIDE_SPLIT_MIN,
  saveSideSplitLayout,
  setLowerSplitShare,
  setSideSplitShare,
  sideSplitShare,
} from "./side-split-layout";
import { type CodexLivePort, createCodexLiveConversation } from "./stores/codex-live-conversation-store";
import { MAX_SIDE_SPLITS } from "./stores/panels-store";
import type { VoiceConversationKind } from "./stores/voice-session-store";
import { useVoiceTalkKey } from "./voice-talk-key";
import { setVoiceTalkMode, useVoiceTalkMode } from "./voice-talk-mode";

const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { type HostFolderPick, HostFolderPicker } from "@openbot/ui/features/conversation/HostFolderPicker";
import { Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Loading, lazy, onSettled, Show, untrack } from "solid-js";
import {
  agentFolderCalls,
  agentInstructionsCalls,
  browseHostFolders,
  type HostFolderPickFn,
  remoteAgentFolderCalls,
} from "./agent-folders-port";
import { conversationPort } from "./conversation-port";
import { conversationOwnerId } from "./stores/composer-store";

function VoiceConversationPane(pill: VoicePillPresence) {
  const controller = useConversationController();
  const { props, channel } = useConversationViewScope();
  const running = untrack(() => {
    const ownerId = conversationOwnerId(props);
    return ownerId ? controller.voiceSessions.running(ownerId) : null;
  });
  if (channel) return <VoiceConversation kind={running ?? "transcribed"} open={pill.open} onClosed={pill.onClosed} />;
  const runtimeLive = untrack(() => props.runtime?.liveVoice);
  if (runtimeLive) {
    const liveKind: VoiceConversationKind = running ?? "codex-live";
    return <VoiceConversation kind={liveKind} port={runtimeLive} open={pill.open} onClosed={pill.onClosed} />;
  }
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

interface VoicePillPresence {
  open: boolean;
  onClosed: () => void;
}

function VoiceConversation(paneProps: VoicePillPresence & { kind: VoiceConversationKind; port?: CodexLivePort }) {
  const controller = useConversationController();
  const { props, channel, startVoiceConversation, endVoiceConversation } = useConversationViewScope();
  const agentId = untrack(() => conversationOwnerId(props));
  if (!agentId) return null;
  const serverId = untrack(() => props.server?.id ?? LOCAL_SERVER_ID);
  const kind = untrack(() => paneProps.kind);
  const port = untrack(() => paneProps.port);
  const conversation = controller.voiceSessions.open(agentId, kind, () =>
    kind === "codex-live"
      ? createCodexLiveConversation({ agentId, serverId, ...(port ? { port } : {}) })
      : startVoiceConversation(agentId),
  );
  const talkMode = useVoiceTalkMode();
  createEffect(talkMode, (mode) => conversation.setTalkMode(mode));
  const talkKey = useVoiceTalkKey(() => props.platform);
  const transcribed = kind === "transcribed";
  const replySpeed = () => (transcribed ? speechSpeed() : undefined);
  const cycleSpeed = transcribed ? cycleSpeechSpeed : undefined;
  const pillAgent = () => (channel ? channel.voiceAgent() : props.agent);
  return (
    <Show when={pillAgent()}>
      {(agent) => (
        <VoicePill
          agent={agent()}
          phase={conversation.phase()}
          muted={conversation.muted()}
          levels={conversation.levels()}
          error={conversation.error()}
          downloadProgress={conversation.downloadProgress()}
          onToggleMute={conversation.toggleMute}
          talkMode={talkMode()}
          onTalkModeChange={setVoiceTalkMode}
          talkKey={talkKey()}
          talking={conversation.talking()}
          onTalkStart={conversation.startTalking}
          onTalkEnd={conversation.stopTalking}
          onTalkCancel={conversation.cancelTalking}
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

export function ConversationPanels(panelProps: { onOpenUsage?: ((trigger: HTMLButtonElement) => void) | undefined }) {
  const controller = useConversationController();
  const bubbleStyle = useChatBubbleStyle();
  const {
    agentReady,
    activateBrowserTab,
    activeBrowserTab,
    allBrowserTabs,
    agentActivity,
    browserSidebarOpen,
    browserExpandedOpen,
    browserWindowShown,
    browserCanDetach,
    openBrowserWindow,
    browserTabs,
    closeShownSidePanelFile,
    closeBrowserTab,
    downloadSidebarFile,
    revealSidebarFile,
    conversationPanelElement,
    filePreviewOpen,
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
    addPreviewPageText,
    setPreviewPageContext,
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
    clearSkillSettingsRequest,
    instructionsSettingsRequest,
    agentSettingRowRequest,
    handleAgentSettingRowRequest,
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
    sideSplits,
    paneSplit,
    moveSidePanelPane,
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
    moveThreadToPanel,
    startNewThread,
    channel,
    replyJump,
  } = useConversationViewScope();
  const remoteChatContent = useRemoteChatContent();
  const { t, errorMessage } = useText();
  const sidePanelToggle = useSidePanelToggle();
  const chatAgentKey = () => {
    const ownerId = conversationOwnerId(props);
    return ownerId ? `${props.server?.id ?? "local"}:${ownerId}` : null;
  };
  const voiceKey = () => (voiceConversationOpen() && chatAgentKey()) || null;
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
  const localAgentDefaults = () => (props.server?.kind === "local" ? props.agentDefaults : undefined);
  const localFolderCalls = agentFolderCalls();
  const [folderPick, setFolderPick] = createSignal<
    (HostFolderPick & { serverId: string; agentId: string; done: (path: string | null) => void }) | null
  >(null);
  const finishFolderPick = (path: string | null) => {
    const pick = folderPick();
    setFolderPick(null);
    pick?.done(path);
  };
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
  const browserProfileServerId = createMemo(() =>
    props.server && serverSupportsCapability(props.server, BROWSER_PROFILES_CAPABILITY) ? props.server.id : undefined,
  );
  const browserProfileCalls = createMemo(() => {
    if (props.runtime) return props.runtime.browserProfiles;
    const serverId = browserProfileServerId();
    return serverId === undefined ? undefined : desktopBrowserProfileCalls(serverId);
  });
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
  const storageReachable = () => !props.runtime || props.runtime.storageCalls !== undefined;
  let browserPreviewTrigger: HTMLButtonElement | undefined;
  const filesSource = (): ChatFilesSource | undefined => {
    if (channel) return { scope: "channel", channelId: channel.id };
    const threadId = props.agent?.threadId;
    return threadId ? { scope: "conversation", conversationId: threadId } : undefined;
  };
  const filesServer = () => {
    const server = props.server;
    if (!storageReachable()) return undefined;
    if (channel) return serverHasChannelStorage(server) ? server : undefined;
    return serverHasStorage(server) ? server : undefined;
  };
  const filesTitle = () => channel?.name() ?? props.agent?.name ?? "this chat";
  const workspaceAgents = createMemo(() => {
    if (!serverSupportsCapability(props.server, WORKSPACE_DIRECTORY_CAPABILITY)) return [];
    if (!channel) return props.agent ? [props.agent] : [];
    const agentIds = channel.memberAgentIds();
    return props.agents.filter((agent) => agentIds.has(agent.id));
  });
  const openAgentWorkspace = (agentId: string) => openWorkspaceFolder(".", agentId, "tab");
  function showFileMessage(messageId: string) {
    if (channel) void replyJump.reveal(messageId, undefined, undefined);
    else void props.onOpenSearchMessage?.(messageId);
  }
  const channelBrowserPane = () => !channel || channel.browserOwner() !== null || browserTabs().length > 0;
  const sidePanelPanes = createMemo((): SidePanelPane[] => [
    ...(props.browserEnabled !== false && channelBrowserPane() ? (["browser"] as const) : []),
    ...(filesServer() && filesSource() ? (["files"] as const) : []),
    ...(props.agent && !channel && props.threads ? (["threads"] as const) : []),
    ...(props.agent || channel ? (["settings"] as const) : []),
  ]);
  const panelSubagent = createMemo(() => {
    const subagentId = panelSubagentId();
    if (!subagentId) return undefined;
    const threads = props.threads;
    const sideMessages = (threads?.side.tabs ?? []).map(
      (tab) => threads?.side.thread(tab.id)?.conversation?.messages ?? [],
    );
    const openThreadMessages = threads?.conversation?.messages ?? [];
    for (const messages of [props.messages, openThreadMessages, ...sideMessages])
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const found = messages[index]?.subagents?.find((subagent) => subagent.id === subagentId);
        if (found) return found;
      }
    return undefined;
  });
  const sidePanelMaxWidth = () => settingsPanelMaxWidth(conversationPanelElement());
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
  const selectedPane = () => (activeRightPanel() === "side-panel" ? null : sidePanel().selected);
  const [pageCovers, setPageCovers] = createSignal<readonly { menu: BrowserPageMenu | undefined }[]>([]);
  const coverBrowserPage: CoverBrowserPage = (menu) => {
    const entry = { menu };
    setPageCovers((entries) => [...entries, entry]);
    return () => setPageCovers((entries) => entries.filter((current) => current !== entry));
  };
  const browserServerId = () => props.server?.id ?? "";
  const pageTabs = createMemo(() => orderedBrowserTabs(browserServerId(), browserTabs()));
  const movePageTab = (tabId: string, index: number) => {
    const full = orderedBrowserTabs(browserServerId(), allBrowserTabs());
    const rest = pageTabs().filter((tab) => tab.id !== tabId);
    const without = full.filter((tab) => tab.id !== tabId);
    const next = rest[index];
    const last = rest.at(-1);
    const at = next
      ? without.findIndex((tab) => tab.id === next.id)
      : without.findIndex((tab) => tab.id === last?.id) + 1;
    moveBrowserTab(browserServerId(), full, tabId, at);
  };
  const browserPages = (browserSelected: () => boolean): SidePanelBrowsers => ({
    items: pageTabs().map((tab) => ({
      id: tab.id,
      title:
        tab.loading && !tab.title
          ? t("common.loading")
          : tab.title || browserDisplayUrl(tab.url) || t("browser.preview.pageFallback"),
      loading: tab.loading,
    })),
    selectedId: browserSelected() ? (activeBrowserTab()?.id ?? null) : null,
    onSelect: (tabId) => {
      openSidePanelPane("browser");
      if (activeBrowserTab()?.id !== tabId) activateBrowserTab(tabId);
    },
    onClose: (tabId) => {
      if (pageTabs().every((tab) => tab.id === tabId)) closeSidePanelPane("browser");
      void closeBrowserTab(tabId);
    },
    onMove: movePageTab,
  });
  const shownThread = () => (activeRightPanel() === "thread" ? shownPanelThreadId() : null);
  const busyBrowserTabIds = createMemo(
    () => new Set(props.browserControlState.sessions.flatMap((session) => (session.tabId ? [session.tabId] : []))),
  );
  const launcherShown = () =>
    activeRightPanel() === "side-panel" || (activeRightPanel() === "thread" && shownPanelThreadId() === null);
  const shownFile = () => (filePreviewOpen() ? sidePanel().file : null);
  const openRoutineThread = async (routineId: string): Promise<boolean> => {
    const opened = (await props.threads?.onOpenRoutineThread(routineId)) ?? false;
    if (opened) setActiveRightPanel("none");
    return opened;
  };
  const sidePanelResizer = (controls: string) => (
    <PanelResizer
      class="right-panel-resizer"
      label={t("conversation.sidePanel.resize")}
      controls={controls}
      direction="right"
      value={sidePanelWidth()}
      defaultValue={SIDE_PANEL_DEFAULT}
      min={SIDE_PANEL_DEFAULT}
      max={sidePanelMaxWidth}
      onResize={setSidePanelWidth}
      onResizeEnd={saveSidePanelWidth}
      onParentResize={() => setSidePanelWidth(Math.round(Math.min(sidePanelMaxWidth(), readSidePanelWidth())))}
      onReset={() => {
        resetSidePanelWidth();
        setSidePanelWidth(SIDE_PANEL_DEFAULT);
      }}
    />
  );
  const sideThreadTabs = () => props.threads?.side.tabs ?? [];
  const moveSideThread = (id: string, index: number) => props.threads?.side.onMove(id, index);
  const sideThreadIds = createMemo(() => sideThreadTabs().map((thread) => thread.id));
  const listedThreads = createMemo(() => {
    const header = props.threads?.header;
    if (!header) return [];
    return [...header.tabs.filter((thread) => thread.kind === "draft"), ...header.threads];
  });
  const sidePanelBadges = createMemo((): Partial<Record<SidePanelPane, SidePanelPaneBadge>> => {
    const waiting = listedThreads().filter((thread) => thread.status.kind === "waiting").length;
    return waiting > 0
      ? { threads: { count: waiting, label: t("conversation.threads.waitingCount", { count: waiting }) } }
      : {};
  });
  const openListedThread = (id: string) => {
    if (sideThreadIds().includes(id)) movePanelThreadToChat(id);
    else props.threads?.header.onOpen(id);
  };
  const toggleListedThreadBeside = (id: string) => {
    if (sideThreadIds().includes(id)) movePanelThreadToChat(id);
    else moveThreadToPanel(id);
  };
  const keepPaneWidth = () => {};
  const mainPanes = () => sidePanelPanes().filter((pane) => !paneSplit(pane));
  const paneWidthChange = (split: boolean) => (split ? keepPaneWidth : setSidePanelWidth);
  const paneResizer = (split: boolean, controls: string) => (split ? undefined : sidePanelResizer(controls));
  const splitsShown = () => sidePanelOpen() && sideSplits().length > 0;
  const splitColumnHeight = () => {
    const element = conversationPanelElement();
    const header = element?.querySelector(":scope > .side-panel-header")?.getBoundingClientRect().height ?? 0;
    return Math.max(0, (element?.getBoundingClientRect().height ?? 0) - header);
  };
  const splitShare = () => {
    const count = sideSplits().length;
    return sideSplitShare(count) ?? count / (count + 1);
  };
  const splitAreaHeight = () => Math.round(splitShare() * splitColumnHeight());
  const splitAreaMax = () => splitColumnHeight() - SIDE_MAIN_GROUP_MIN;
  const shareOf = (height: number, whole: number) => Math.min(0.99, Math.max(0.01, height / whole));
  const resizeSplitArea = (height: number) => {
    const column = splitColumnHeight();
    if (column > 0) setSideSplitShare(sideSplits().length, shareOf(height, column));
  };
  const lowerGroupHeight = () => Math.round((lowerSplitShare() ?? 0.5) * splitAreaHeight());
  const resizeLowerGroup = (height: number) => {
    const area = splitAreaHeight();
    if (area > 0) setLowerSplitShare(shareOf(height, area));
  };
  const saveSplitResize = (resize: (height: number) => void) => (height: number) => {
    resize(height);
    saveSideSplitLayout();
  };
  const groupMoves = (group: number, tabCount: number): SidePanelMove[] => {
    const moves: SidePanelMove[] = [];
    if (tabCount > 1 && sideSplits().length < MAX_SIDE_SPLITS) moves.push("split");
    if (group >= 0) moves.push("up");
    if (group < sideSplits().length - 1) moves.push("down");
    return moves;
  };
  const moveFromGroup = (group: number) => (pane: SidePanelPane, move: SidePanelMove) =>
    moveSidePanelPane(
      pane,
      move === "split" ? { newGroupAt: group + 1 } : { group: move === "up" ? group - 1 : group + 1 },
    );
  const mainTabCount = () => sidePanel().panes.length + sidePanel().files.length + sideThreadTabs().length;
  const closeSplitGroup = (group: number) => {
    for (const pane of [...(sideSplits()[group]?.panes ?? [])]) closeSidePanelPane(pane);
  };
  const paneWindows = (): Partial<Record<SidePanelPane, () => void>> =>
    browserCanDetach()
      ? {
          browser: () => {
            openBrowserWindow();
            closeSidePanelPane("browser");
          },
        }
      : {};
  const filesPane = (split: boolean) => (
    <Show when={filesServer()}>
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
                workspaceAgents={workspaceAgents()}
                onOpenWorkspace={openAgentWorkspace}
                resizer={paneResizer(split, "conversation-files-panel")}
              />
            </Loading>
          )}
        </Show>
      )}
    </Show>
  );
  const questionPane = (split: boolean) => (
    <Show when={props.agent}>
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
          resizer={paneResizer(split, "side-question-panel")}
          onOpenLink={(url) => void openExternalMessageUrl(url)}
          macWindowControls={props.platform === "darwin"}
          remoteContent={remoteChatContent.enabled(props.server?.id ?? LOCAL_SERVER_ID)}
        />
      )}
    </Show>
  );
  const threadsPane = (split: boolean) => (
    <Show when={sidePanelPanes().includes("threads")}>
      <ThreadsPane
        threads={listedThreads()}
        activeId={props.threads?.header.activeId ?? ""}
        besideIds={sideThreadIds()}
        canStartNew={props.threads?.header.canStartNew ?? false}
        resizer={paneResizer(split, "threads-panel")}
        onOpen={openListedThread}
        onToggleBeside={toggleListedThreadBeside}
        onNew={startNewThread}
      />
    </Show>
  );
  const subagentPane = (split: boolean) => (
    <SubagentPanel
      subagent={panelSubagent()}
      agentName={props.agent?.name ?? ""}
      onClosePanel={() => closeSidePanelPane("subagent")}
      resizer={paneResizer(split, "subagent-panel")}
    />
  );
  const shownPages = (browserSelected: () => boolean) => (pageTabsShown() ? browserPages(browserSelected) : undefined);
  const pageTabsChoice = {
    get shown() {
      return pageTabsShown();
    },
    onChange: showPageTabs,
  };
  const browserPane = (split: boolean) => (
    <BrowserPreviewSidebar
      tabs={browserTabs()}
      busyTabIds={busyBrowserTabIds()}
      hidden={browserExpandedOpen()}
      suspended={props.browserVisibilitySuspended || props.globalOverlayOpen || props.remoteDesktopVisible}
      contextKey={`${props.server?.id ?? "local"}:${props.agent?.id ?? ""}`}
      maxWidth={sidePanelMaxWidth}
      onWidthChange={paneWidthChange(split)}
      capturePreview={props.runtime?.browser.capturePreview}
      onOpenTab={(tabId, trigger) => {
        browserPreviewTrigger = trigger;
        if (activeBrowserTab()?.id !== tabId) activateBrowserTab(tabId);
        setActiveRightPanel("browser-expanded");
      }}
      onCloseTab={(tabId) => void closeBrowserTab(tabId)}
      onNewTab={() => void openBrowserAddress(BROWSER_NEW_TAB_URL, true)}
      pageShown={pageTabsShown() && browserTabs().length > 0 && !browserWindowShown()}
    >
      <BrowserFullViewAdapter
        pane={{
          open: browserSidebarOpen() && !browserExpandedOpen(),
          coveringMenus: pageCovers().map((entry) => entry.menu),
        }}
      />
    </BrowserPreviewSidebar>
  );
  const settingsPane = (split: boolean) => (
    <>
      {channel ? (
        <channel.SettingsPane
          maxWidth={sidePanelMaxWidth}
          onWidthChange={paneWidthChange(split)}
          onClose={() => closeSidePanelPane("settings")}
        />
      ) : null}
      <Show when={props.agent}>
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
                conversationRuntime(props).agent.previewWorkspaceFile({ agentId: agent().id, path, exactPath: true })
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
              builtinMemoryEditable={props.server?.kind === "local" || props.remoteBuiltinMemoryLoaded === true}
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
              onDeleteAgent={props.onDeleteAgent}
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
              onOpenApps={serverCanManageMcp(props.server) ? props.onOpenMarketplace : undefined}
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
              onWidthChange={paneWidthChange(split)}
              onUpdateAgent={props.onUpdateAgent}
              onUpdateRuntimeSettings={updateRuntimeSettings}
              onSetAgentAvatar={props.onSetAgentAvatar}
              skillSelectionRequest={skillSettingsRequest()?.agentId === agent().id ? skillSettingsRequest() : null}
              onSkillsClosed={() => clearSkillSettingsRequest(agent().id)}
              instructionsRequest={
                instructionsSettingsRequest()?.agentId === agent().id ? instructionsSettingsRequest() : null
              }
              settingReveal={agentSettingRowRequest()?.agentId === agent().id ? agentSettingRowRequest() : null}
              onSettingRevealHandled={handleAgentSettingRowRequest}
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
    </>
  );
  const splitPane = (pane: SidePanelPane) => {
    if (pane === "files") return filesPane(true);
    if (pane === "question") return questionPane(true);
    if (pane === "threads") return threadsPane(true);
    if (pane === "subagent") return subagentPane(true);
    if (pane === "settings") return settingsPane(true);
    return <Show when={browserSidebarOpen()}>{browserPane(true)}</Show>;
  };
  return (
    <>
      <HostFolderPicker request={folderPick()} browse={browsePickFolders} onDone={finishFolderPick} />
      <Show when={sidePanelOpen()}>
        <BrowserPageCover value={coverBrowserPage}>
          <SidePanelHeader
            panes={sidePanel().panes}
            selected={selectedPane()}
            available={mainPanes()}
            badges={sidePanelBadges()}
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
              onArchive: props.threads?.header.onArchive,
              onDelete: props.threads?.header.onDelete,
            }}
            files={{
              items: sidePanel().files,
              selectedKey: shownFile(),
              onSelect: openSidePanelFile,
              onClose: closeSidePanelFile,
              onMove: moveSidePanelFile,
            }}
            browsers={shownPages(() => selectedPane() === "browser")}
            pageTabs={pageTabsChoice}
            onToggleMaximized={() => setSidePanelMaximized(!sidePanel().maximized)}
            onCollapse={toggleSidePanel}
            outerToggle={sidePanelToggle() !== undefined}
            moves={groupMoves(-1, mainTabCount())}
            onMove={moveFromGroup(-1)}
            windows={paneWindows()}
            onNewBrowserTab={() => {
              openSidePanelPane("browser");
              void openBrowserAddress(BROWSER_NEW_TAB_URL, true);
            }}
          />
        </BrowserPageCover>
      </Show>

      <Show when={sidePanelToggle()}>
        {(toggle) => (
          <div class="side-panel-toggle-slot no-drag">
            <SidePanelToggle {...toggle()} />
          </div>
        )}
      </Show>

      <Show when={launcherShown()}>
        <aside
          id="side-panel-launcher"
          class="browser-panel side-panel-empty"
          aria-label={t("conversation.sidePanel.label")}
        >
          {sidePanelResizer("side-panel-launcher")}
          <SidePanelLauncher
            available={mainPanes()}
            badges={sidePanelBadges()}
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
                remoteContent={remoteChatContent.enabled(props.server?.id ?? LOCAL_SERVER_ID)}
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
                sourceUrl={openedAttachmentUrl(attached()?.previewUrl)}
                pageUrl={htmlAttachmentPageUrl(attached()) ?? file().preview?.pageUrl}
                pageHtml={props.runtime?.visualPage ? htmlFilePageHtml(attached(), file().preview) : undefined}
                fileKey={previewFileKey()}
                selectionQuoteId={previewQuoteId()}
                onPageQuote={(text) => {
                  const quoteId = previewQuoteId();
                  if (quoteId) quoteSelection(quoteId, text);
                }}
                onPageContext={(text) => {
                  const id = attached()?.id;
                  if (id) setPreviewPageContext(id, text);
                }}
                onPageMessage={addPreviewPageText}
                isPageAppShortcut={isChatVisualAppShortcut}
                quoteShortcut={deviceQuoteShortcut(props.platform)}
                onOpenExternally={openSidebarFileExternally}
                onDownload={downloadSidebarFile}
                onReveal={props.runtime ? undefined : revealSidebarFile}
                onClose={closeShownSidePanelFile}
              />
            </Loading>
          );
        }}
      </Show>

      <Show when={activeRightPanel() === "files"}>{filesPane(false)}</Show>

      <Show when={activeRightPanel() === "question"}>{questionPane(false)}</Show>

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

      <Show when={shownThread()} keyed>
        {(threadId) => <ConversationSideThread threadId={threadId} resizer={sidePanelResizer("side-thread-panel")} />}
      </Show>

      <Show when={activeRightPanel() === "threads"}>{threadsPane(false)}</Show>

      <Show when={activeRightPanel() === "subagent"}>{subagentPane(false)}</Show>

      <Show
        when={
          (activeRightPanel() === "browser" && browserSidebarOpen()) || (browserExpandedOpen() && !paneSplit("browser"))
        }
      >
        {browserPane(false)}
      </Show>

      <Show when={browserSidebarOpen() || browserExpandedOpen()}>
        <Portal>
          <div class="ui-dialog-overlay browser-expanded-backdrop" hidden={!browserExpandedOpen()} aria-hidden="true" />
          <BrowserFullViewAdapter />
        </Portal>
      </Show>

      <Show when={browserWindowShown()}>
        <BrowserWindowBridge />
      </Show>

      <Show when={activeRightPanel() === "settings"}>{settingsPane(false)}</Show>

      <Show when={splitsShown()}>
        <BrowserPageCover value={coverBrowserPage}>
          <section id="side-splits" class="side-splits" data-side-split aria-label={t("conversation.sidePanel.groups")}>
            <PanelResizer
              class="side-splits-resizer"
              label={t("conversation.sidePanel.resizeGroups")}
              controls="side-splits"
              direction="bottom"
              value={splitAreaHeight()}
              defaultValue={splitAreaHeight()}
              min={SIDE_SPLIT_MIN * sideSplits().length}
              max={splitAreaMax}
              onResize={resizeSplitArea}
              onResizeEnd={saveSplitResize(resizeSplitArea)}
              onReset={() => {
                setSideSplitShare(sideSplits().length, null);
                saveSideSplitLayout();
              }}
            />
            <For each={sideSplits()} keyed={false}>
              {(group, index) => (
                <div class="side-split" id={`side-split-${index + 2}`}>
                  <Show when={index === 1}>
                    <PanelResizer
                      class="side-splits-resizer"
                      label={t("conversation.sidePanel.resizeGroup", { number: index + 2 })}
                      controls={`side-split-${index + 2}`}
                      direction="bottom"
                      value={lowerGroupHeight()}
                      defaultValue={Math.round(splitAreaHeight() / 2)}
                      min={SIDE_SPLIT_MIN}
                      max={() => splitAreaHeight() - SIDE_SPLIT_MIN}
                      onResize={resizeLowerGroup}
                      onResizeEnd={saveSplitResize(resizeLowerGroup)}
                      onReset={() => {
                        setLowerSplitShare(null);
                        saveSideSplitLayout();
                      }}
                    />
                  </Show>
                  <SidePanelHeader
                    split
                    label={t("conversation.sidePanel.group", { number: index + 2 })}
                    panes={group().panes}
                    selected={group().selected}
                    available={sidePanelPanes()}
                    badges={sidePanelBadges()}
                    maximized={false}
                    settingsLabel={channel ? t("channel.settings.title") : undefined}
                    onSelect={(pane) =>
                      group().panes.includes(pane) ? openSidePanelPane(pane) : moveSidePanelPane(pane, { group: index })
                    }
                    onClose={closeSidePanelPane}
                    onToggleMaximized={keepPaneWidth}
                    onCollapse={() => closeSplitGroup(index)}
                    moves={groupMoves(index, group().panes.length)}
                    onMove={moveFromGroup(index)}
                    windows={paneWindows()}
                    onCloseGroup={() => closeSplitGroup(index)}
                    browsers={shownPages(() => group().selected === "browser")}
                    pageTabs={pageTabsChoice}
                  />
                  <div class="side-split-body">
                    <Show when={group().selected} keyed>
                      {(pane) => splitPane(pane)}
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </section>
        </BrowserPageCover>
      </Show>

      {publishAgent.dialog()}
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
const BrowserWindowBridge = lazy(() => import("./BrowserWindowBridge"));
const FilePreviewPanel = lazy(() => import("./FilePreviewPanel"));
const ChatFilesPanel = lazy(() => import("../files/ChatFilesPanel"));

const BrowserPreviewSidebar = lazy(() => import("./BrowserPreviewSidebar"));
