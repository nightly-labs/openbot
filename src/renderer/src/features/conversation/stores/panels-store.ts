import { isOpenableAttachmentName } from "@openbot/contracts/attachment-files";
import {
  type AttachmentSummary,
  type BrowserBounds,
  canPreviewAttachment,
  type FileAction,
  type FilePreview,
  type WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import { ATTACHMENT_PREVIEW_CAPABILITY } from "@openbot/contracts/team-protocol/attachment-preview-v1";
import { matchingSourceKeys } from "@openbot/i18n";
import type { AgentSettingLinkId, AgentSettingReveal } from "@openbot/ui/features/conversation/agent-setting-links";
import type { ImageCopies } from "@openbot/ui/features/conversation/ImageLightbox";
import type { MessageImageFile } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { isSidePanelPane } from "@openbot/ui/features/conversation/SidePanel";
import { currentText } from "@openbot/ui/text";
import { normalizeMessage } from "@openbot/user-errors/reference";
import { createEffect, createMemo, createSignal, onCleanup, type Store, type StoreSetter, untrack } from "solid-js";
import { createScopeGuard } from "../../../scope-lifetime";
import { serverSupportsCapability } from "../../servers/server-capabilities";
import { createAttachmentDownloads } from "../attachment-downloads";
import { attachmentFilePreview, localAttachmentCopyUrl, remoteAttachmentUrlWith } from "../attachment-preview";
import { BROWSER_PIP_STORAGE_KEY, BROWSER_WINDOW_STORAGE_KEY, storeBounds } from "../browser-bounds-storage";
import { releaseFilePreviewPage } from "../conversation-port";
import { conversationRuntime } from "../conversation-runtime";
import type {
  ConversationProps,
  ConversationTarget,
  RightPanelMode,
  SidebarFilePreview,
  SidePanelPane,
} from "../conversation-types";
import { agentSkillsMode } from "../installed-skills-source";
import { decodedPath, SHARED_FOLDER_PATH } from "../message-image-files";
import { filePreviewQuoteId } from "../quoted-text";
import { conversationOwnerId } from "./composer-store";

const { t, errorMessage } = currentText();

export interface AgentSettingRowRequest extends AgentSettingReveal {
  agentId: string;
}

export interface RoutineSettingsRequest {
  agentId: string;
  routineId: string | null;
  routineName: string;
  nonce: number;
}

export interface SidePanelFile {
  key: string;
  name: string;
  folder: boolean;
  source: SidebarFilePreview["source"];
  unavailable: boolean;
  threadId?: string | undefined;
}

export interface SidePanelState {
  panes: readonly SidePanelPane[];
  selected: SidePanelPane | null;
  files: readonly SidePanelFile[];
  file: string | null;
  maximized: boolean;
}

export interface SideSplitState {
  panes: readonly SidePanelPane[];
  selected: SidePanelPane | null;
}

export type SidePanelTarget = { group: number } | { newGroupAt: number };

export const MAX_SIDE_SPLITS = 2;

type FileTabPlace = "tab" | "here" | "open";

export interface SidePanelsState {
  side: Record<string, SidePanelState>;
  splits: Record<string, readonly SideSplitState[]>;
  subagents: Record<string, string>;
  threads: Record<string, string>;
}

const FILE_PREVIEW_REFRESH_MS = 750;
const FILE_PREVIEW_REFRESH_BYTES = 8 * 1024 * 1024;

export function isSidePanelMode(mode: RightPanelMode | undefined): boolean {
  return (
    mode === "side-panel" ||
    mode === "thread" ||
    mode === "file-preview" ||
    (mode !== undefined && isSidePanelPane(mode))
  );
}

const SIDE_PANEL_EMPTY: SidePanelState = { panes: [], selected: null, files: [], file: null, maximized: false };
const NO_SPLITS: readonly SideSplitState[] = [];

export interface PanelsStoreDeps {
  props: ConversationProps;
  rightPanels: () => Record<string, RightPanelMode>;
  setRightPanels: (update: (current: Record<string, RightPanelMode>) => Record<string, RightPanelMode>) => void;
  panels: Store<SidePanelsState>;
  setPanels: StoreSetter<SidePanelsState>;
  settingsProvider: () => import("@openbot/contracts/ipc").AgentProviderId;
  settingsModel: () => import("@openbot/contracts/ipc").AgentModelId;
  settingsReasoning: () => import("@openbot/contracts/ipc").AgentReasoningEffort;
  setBrowserPipBounds: (bounds: BrowserBounds | null) => void;
  browserWindowOpen: () => boolean;
  setBrowserWindowOpen: (open: boolean) => void;
  setBrowserWindowBounds: (bounds: BrowserBounds | null) => void;
  sidebarFilePreview: () => SidebarFilePreview | null;
  setSidebarFilePreview: (preview: SidebarFilePreview | null) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  nextFilePreviewGeneration: () => number;
  currentFilePreviewGeneration: () => number;
  invalidateFilePreviewGeneration: () => void;
}

export function createPanelsStore(deps: PanelsStoreDeps) {
  const scopeActive = createScopeGuard();
  const [skillSettingsRequest, setSkillSettingsRequest] = createSignal<{ agentId: string; skillId: string } | null>(
    null,
  );
  function openSkillSettings(skill: { skillId: string }): void {
    const agentId = deps.props.agent?.id;
    if (!agentId || agentSkillsMode(deps.props.server, deps.props.runtime) === "hidden") return;
    setSkillSettingsRequest({ agentId, skillId: skill.skillId });
    setActiveRightPanel("settings", agentId);
  }
  function clearSkillSettingsRequest(agentId: string): void {
    setSkillSettingsRequest((current) => (current?.agentId === agentId ? null : current));
  }
  const [instructionsSettingsRequest, setInstructionsSettingsRequest] = createSignal<{ agentId: string } | null>(null);
  function openInstructionsSettings(agentId: string): void {
    if (deps.props.agent?.id !== agentId) return;
    setInstructionsSettingsRequest({ agentId });
    setActiveRightPanel("settings", agentId);
  }
  const [agentSettingRowRequest, setAgentSettingRowRequest] = createSignal<AgentSettingRowRequest | null>(null);
  let agentSettingRowNonce = 0;
  function openAgentSettingRow(agentId: string, settingId: AgentSettingLinkId): void {
    if (deps.props.agent?.id !== agentId) return;
    agentSettingRowNonce += 1;
    setAgentSettingRowRequest({ agentId, settingId, nonce: agentSettingRowNonce });
    setActiveRightPanel("settings", agentId);
  }
  function handleAgentSettingRowRequest(nonce: number): void {
    setAgentSettingRowRequest((current) => (current?.nonce === nonce ? null : current));
  }
  const [routineSettingsRequest, setRoutineSettingsRequest] = createSignal<RoutineSettingsRequest | null>(null);
  let routineSettingsRequestNonce = 0;

  const channel = untrack(() => deps.props.channel);
  const activeRightPanel = createMemo<RightPanelMode>(() => {
    if (channel?.readOnly()) return "none";
    const agentId = conversationOwnerId(deps.props);
    return agentId ? (deps.rightPanels()[agentId] ?? "none") : "none";
  });
  const { panels, setPanels } = deps;
  const sidePanel = (): SidePanelState => {
    const agentId = conversationOwnerId(deps.props);
    return (agentId && panels.side[agentId]) || SIDE_PANEL_EMPTY;
  };
  const sidePanelOpen = () => isSidePanelMode(activeRightPanel());
  function updateSidePanel(agentId: string, update: (state: SidePanelState) => SidePanelState) {
    setPanels((draft) => {
      draft.side[agentId] = update(draft.side[agentId] ?? SIDE_PANEL_EMPTY);
    });
  }
  function setSidePanelMaximized(maximized: boolean) {
    const agentId = conversationOwnerId(deps.props);
    if (agentId) updateSidePanel(agentId, (state) => ({ ...state, maximized }));
  }
  function removeSidePanelPane(pane: SidePanelPane): SidePanelPane | null {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return null;
    const state = panels.side[agentId] ?? SIDE_PANEL_EMPTY;
    const index = state.panes.indexOf(pane);
    const panes = state.panes.filter((item) => item !== pane);
    const selected =
      state.selected === pane ? (panes[Math.min(Math.max(index, 0), panes.length - 1)] ?? null) : state.selected;
    updateSidePanel(agentId, () => ({
      ...state,
      panes,
      selected,
      maximized: panes.length + state.files.length > 0 && state.maximized,
    }));
    return selected;
  }
  function removeSidePanelFile(key: string): string | null {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return null;
    const state = panels.side[agentId] ?? SIDE_PANEL_EMPTY;
    const index = state.files.findIndex((item) => item.key === key);
    const files = state.files.filter((item) => item.key !== key);
    const file = state.file === key ? (files[Math.min(Math.max(index, 0), files.length - 1)]?.key ?? null) : state.file;
    updateSidePanel(agentId, () => ({
      ...state,
      files,
      file,
      maximized: state.panes.length + files.length > 0 && state.maximized,
    }));
    return file;
  }

  function moveSidePanelFile(key: string, index: number) {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return;
    updateSidePanel(agentId, (state) => {
      const file = state.files.find((item) => item.key === key);
      if (!file) return state;
      const files = state.files.filter((item) => item !== file);
      files.splice(Math.min(Math.max(index, 0), files.length), 0, file);
      return { ...state, files };
    });
  }
  const sideSplits = (): readonly SideSplitState[] => {
    const agentId = conversationOwnerId(deps.props);
    return (agentId && !channel?.readOnly() && panels.splits[agentId]) || NO_SPLITS;
  };
  const paneSplit = (pane: SidePanelPane) => sideSplits().some((group) => group.panes.includes(pane));
  const paneShown = (pane: SidePanelPane) =>
    activeRightPanel() === pane || (sidePanelOpen() && sideSplits().some((group) => group.selected === pane));
  function splitIndex(agentId: string, pane: SidePanelPane): number {
    return (panels.splits[agentId] ?? NO_SPLITS).findIndex((group) => group.panes.includes(pane));
  }
  function splitShows(agentId: string, pane: SidePanelPane): boolean {
    return (panels.splits[agentId] ?? NO_SPLITS).some((group) => group.selected === pane);
  }
  function updateSplits(agentId: string, update: (groups: SideSplitState[]) => SideSplitState[]) {
    setPanels((draft) => {
      const groups = (draft.splits[agentId] ?? NO_SPLITS).map((group) => ({
        panes: [...group.panes],
        selected: group.selected,
      }));
      draft.splits[agentId] = update(groups).filter((group) => group.panes.length > 0);
    });
  }
  function withoutPane(group: SideSplitState, pane: SidePanelPane): SideSplitState {
    const index = group.panes.indexOf(pane);
    if (index < 0) return group;
    const panes = group.panes.filter((item) => item !== pane);
    const selected = group.selected === pane ? (panes[Math.min(index, panes.length - 1)] ?? null) : group.selected;
    return { panes, selected };
  }
  const splitReturn: Record<string, RightPanelMode> = {};
  function mainGroupMode(agentId: string): RightPanelMode {
    const state = panels.side[agentId] ?? SIDE_PANEL_EMPTY;
    return state.selected && state.panes.includes(state.selected) ? state.selected : "side-panel";
  }
  function returnFromBrowserScreen(agentId: string, pane: SidePanelPane) {
    const current = deps.rightPanels()[agentId] ?? "none";
    if (pane !== "browser" || !isBrowserScreenMode(current)) return;
    const back = splitReturn[agentId] ?? "none";
    delete splitReturn[agentId];
    showInMainGroup(isSidePanelMode(back) ? back : mainGroupMode(agentId), agentId);
  }
  function selectSplitPane(agentId: string, pane: SidePanelPane) {
    const index = splitIndex(agentId, pane);
    if (index < 0) return;
    if (panels.splits[agentId]?.[index]?.selected === "settings" && pane !== "settings") clearSettingsRequests(agentId);
    updateSplits(agentId, (groups) =>
      groups.map((group, position) => (position === index ? { ...group, selected: pane } : group)),
    );
    const current = deps.rightPanels()[agentId] ?? "none";
    if (pane === "browser" && isBrowserScreenMode(current)) returnFromBrowserScreen(agentId, pane);
    else if (!isSidePanelMode(current)) showInMainGroup(mainGroupMode(agentId), agentId, pane === "settings");
  }
  function removeSplitPane(pane: SidePanelPane, agentId = conversationOwnerId(deps.props)): void {
    if (!agentId) return;
    if (pane === "settings") clearSettingsRequests(agentId);
    updateSplits(agentId, (groups) => groups.map((group) => withoutPane(group, pane)));
    returnFromBrowserScreen(agentId, pane);
  }
  function takeFromMainGroup(agentId: string, pane: SidePanelPane): () => void {
    const shownInMain = deps.rightPanels()[agentId] === pane;
    const next = removeSidePanelPane(pane);
    return () => {
      if (shownInMain) showInMainGroup(next ?? "side-panel", agentId, pane === "settings");
    };
  }
  function moveSidePanelPane(pane: SidePanelPane, target: SidePanelTarget) {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return;
    const groups = panels.splits[agentId] ?? NO_SPLITS;
    const from = splitIndex(agentId, pane);
    if ("group" in target) {
      if (target.group === from || target.group >= groups.length) return;
      if (target.group < 0) {
        removeSplitPane(pane, agentId);
        deps.invalidateFilePreviewGeneration();
        showInMainGroup(pane, agentId);
        return;
      }
    } else if (groups.length >= MAX_SIDE_SPLITS) return;
    const reshowMain = from < 0 ? takeFromMainGroup(agentId, pane) : undefined;
    updateSplits(agentId, (current) => {
      const next = current.map((group) => withoutPane(group, pane));
      if ("newGroupAt" in target) next.splice(target.newGroupAt, 0, { panes: [pane], selected: pane });
      else {
        const group = next[target.group];
        if (group) next[target.group] = { panes: [...group.panes, pane], selected: pane };
      }
      return next;
    });
    reshowMain?.();
  }
  const settingsOpen = () => paneShown("settings");
  const filesOpen = () => paneShown("files");
  const panelSubagentId = (): string | null => {
    const agentId = conversationOwnerId(deps.props);
    return agentId ? (panels.subagents[agentId] ?? null) : null;
  };
  const panelThreadId = (): string | null => {
    const agentId = conversationOwnerId(deps.props);
    return agentId ? (panels.threads[agentId] ?? null) : null;
  };
  const filePreviewOpen = () =>
    activeRightPanel() === "file-preview" &&
    deps.sidebarFilePreview()?.ownerAgentId === conversationOwnerId(deps.props);

  function setActiveRightPanel(mode: RightPanelMode, agentId = conversationOwnerId(deps.props)) {
    if (mode === "browser-expanded" && deps.browserWindowOpen()) {
      void conversationRuntime(deps.props).browser.focusWindow();
      return;
    }
    showRightPanel(mode, agentId);
  }

  function showRightPanel(mode: RightPanelMode, agentId = conversationOwnerId(deps.props)) {
    if (!agentId) return;
    if (mode === "browser-pip") deps.setBrowserWindowOpen(false);
    if (mode !== "file-preview") deps.invalidateFilePreviewGeneration();
    if (isSidePanelPane(mode) && splitIndex(agentId, mode) >= 0) {
      selectSplitPane(agentId, mode);
      return;
    }
    showInMainGroup(mode, agentId);
  }

  function showInMainGroup(mode: RightPanelMode, agentId: string, keepSettingsRequests = false) {
    if (isBrowserScreenMode(mode) && splitIndex(agentId, "browser") >= 0) {
      const current = deps.rightPanels()[agentId] ?? "none";
      if (!isBrowserScreenMode(current)) splitReturn[agentId] = current;
    }
    if (mode !== "settings" && !keepSettingsRequests && !splitShows(agentId, "settings"))
      clearSettingsRequests(agentId);
    deps.setRightPanels((current) => (current[agentId] === mode ? current : { ...current, [agentId]: mode }));
    if (isSidePanelPane(mode))
      updateSidePanel(agentId, (state) => ({
        ...state,
        panes: state.panes.includes(mode) ? state.panes : [...state.panes, mode],
        selected: mode,
        file: null,
      }));
    else if (mode === "side-panel" || mode === "thread")
      updateSidePanel(agentId, (state) => ({ ...state, selected: null, file: null }));
    else if (mode === "none" && panels.side[agentId]?.maximized) {
      updateSidePanel(agentId, (state) => ({ ...state, maximized: false }));
    }
  }

  function clearSettingsRequests(agentId: string) {
    setSkillSettingsRequest(null);
    setInstructionsSettingsRequest(null);
    setAgentSettingRowRequest(null);
    setRoutineSettingsRequest((current) => (current?.agentId === agentId ? null : current));
  }

  function openSubagentPanel(subagentId: string): void {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return;
    setPanels((draft) => {
      draft.subagents[agentId] = subagentId;
    });
    setActiveRightPanel("subagent", agentId);
  }

  function openPanelThread(threadId: string): void {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return;
    setPanels((draft) => {
      draft.threads[agentId] = threadId;
    });
    setActiveRightPanel("thread", agentId);
  }

  function openRoutineSettings(routine: { routineId: string; name: string } | "new"): void {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    routineSettingsRequestNonce += 1;
    setRoutineSettingsRequest({
      agentId,
      routineId: routine === "new" ? null : routine.routineId,
      routineName: routine === "new" ? "" : routine.name,
      nonce: routineSettingsRequestNonce,
    });
    setActiveRightPanel("settings", agentId);
  }

  function handleRoutineSettingsRequest(nonce: number): void {
    setRoutineSettingsRequest((current) => (current?.nonce === nonce ? null : current));
  }

  function clearRoutineSettingsRequest(): void {
    setRoutineSettingsRequest(null);
  }

  async function openRoutineRunMessage(messageId: string, routineId?: string): Promise<void> {
    setActiveRightPanel("none");
    const threads = deps.props.threads;
    if (routineId && threads && (await threads.onOpenRoutineRun(routineId, messageId).catch(() => false))) return;
    await deps.props.onOpenSearchMessage?.(messageId);
  }

  function showBrowserPip() {
    setActiveRightPanel("browser-pip");
  }

  function saveBrowserPipBounds(bounds: BrowserBounds) {
    deps.setBrowserPipBounds(bounds);
    storeBounds(BROWSER_PIP_STORAGE_KEY, bounds);
  }

  function saveBrowserWindowBounds(bounds: BrowserBounds) {
    deps.setBrowserWindowBounds(bounds);
    storeBounds(BROWSER_WINDOW_STORAGE_KEY, bounds);
  }

  function openBrowserWindow() {
    if (isBrowserScreenMode(activeRightPanel())) showRightPanel("none");
    deps.setRightPanels(withoutBrowserScreens);
    deps.setBrowserWindowOpen(true);
  }

  function reattachBrowserWindow() {
    deps.setBrowserWindowOpen(false);
    showRightPanel("browser-expanded");
  }

  function hideBrowserPanel() {
    setActiveRightPanel("none");
    if (deps.props.browserEnabled !== false)
      void conversationRuntime(deps.props).browser.setVisible({ visible: false, target: "main" });
  }

  let openingThreadId: string | undefined;
  function openFileFromThread(threadId: string | undefined, open: () => void): void {
    const previous = openingThreadId;
    openingThreadId = threadId;
    try {
      open();
    } finally {
      openingThreadId = previous;
    }
  }

  async function previewAttachment(attachment: AttachmentSummary, place: FileTabPlace = "tab") {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!ownerAgentId || !canPreviewAttachment(attachment)) return;
    const threadId = openingThreadId;
    const target = { agentId: ownerAgentId, serverId: deps.props.server?.id ?? "local" };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    try {
      const preview = await (deps.props.runtime?.previewAttachment?.(attachment) ?? attachmentFilePreview(attachment));
      if (generation !== deps.currentFilePreviewGeneration() || conversationOwnerId(deps.props) !== ownerAgentId)
        return;
      showSidebarFile({ ownerAgentId, threadId, source: { kind: "attachment", attachment }, preview }, place);
    } catch (error) {
      if (generation !== deps.currentFilePreviewGeneration()) return;
      deps.setComposerError(errorMessage(error, t("attachment.error.preview", { name: attachment.name })), target);
      fileTabReadFailed(place);
    }
  }

  const attachmentFiles = createAttachmentDownloads({
    serverId: () => deps.props.server?.id ?? "local",
    calls: () => {
      const agent = conversationRuntime(deps.props).agent;
      const stop = agent.stopAttachmentDownload;
      return {
        open: (input) => agent.openAttachment(input),
        stop: stop && ((attachmentId) => stop(attachmentId)),
        subscribe: agent.onAttachmentDownload,
      };
    },
    target: () => {
      const agentId = conversationOwnerId(deps.props);
      return agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    },
    onError: (error, target) => deps.setComposerError(errorMessage(error, t("attachment.error.open")), target),
  });
  const attachmentDownloads = attachmentFiles.downloads;
  const remoteImageCopies: ImageCopies = {
    copyUrl: (image) => {
      const server = deps.props.server;
      const url = image.previewUrl;
      if (!url) return undefined;
      const local = localAttachmentCopyUrl(url);
      if (local) return local;
      if (server?.kind !== "remote" || !serverSupportsCapability(server, ATTACHMENT_PREVIEW_CAPABILITY))
        return undefined;
      const copy = remoteAttachmentUrlWith(url, "preview");
      return copy === url ? undefined : copy;
    },
    fullUrl: (image) => image.previewUrl,
  };
  const imageCopies = () => (deps.props.runtime ? deps.props.runtime.imageCopies : remoteImageCopies);

  function attachmentAction(attachment: AttachmentSummary, action: FileAction) {
    if (action === "open" && previewsInsteadOfReveal(attachment)) {
      void previewAttachment(attachment);
      return;
    }
    attachmentFileAction(attachment, action);
  }

  function previewsInsteadOfReveal(attachment: AttachmentSummary) {
    return canPreviewAttachment(attachment) && !isOpenableAttachmentName(attachment.name);
  }

  function attachmentFileAction(attachment: AttachmentSummary, action: FileAction) {
    if (action === "open" && deps.props.runtime && canPreviewAttachment(attachment)) {
      void previewAttachment(attachment);
      return;
    }
    attachmentFiles.open(attachment, action);
  }

  function openSharedFile(path: string, place: FileTabPlace = "tab", fallback?: () => void) {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!ownerAgentId) return;
    const threadId = openingThreadId;
    const serverId = deps.props.server?.id ?? "local";
    const target = { agentId: ownerAgentId, serverId };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    void conversationRuntime(deps.props)
      .agent.previewSharedFile({ path })
      .then(
        (preview) => {
          if (
            !scopeActive() ||
            generation !== deps.currentFilePreviewGeneration() ||
            conversationOwnerId(deps.props) !== ownerAgentId
          ) {
            releaseFilePreviewPage(preview.pageUrl);
            return;
          }
          showSidebarFile({ ownerAgentId, threadId, source: { kind: "shared", path }, preview }, place);
        },
        (error) => {
          if (!scopeActive() || generation !== deps.currentFilePreviewGeneration()) return;
          const showError = () => {
            if (!scopeActive() || generation !== deps.currentFilePreviewGeneration()) return;
            if (fallback) {
              if (conversationOwnerId(deps.props) === ownerAgentId) openFileFromThread(threadId, fallback);
            } else {
              deps.setComposerError(filePreviewError(error, path), target);
              fileTabReadFailed(place);
            }
          };
          if (serverId !== "local" || deps.props.runtime) {
            showError();
            return;
          }
          void conversationRuntime(deps.props).agent.openSharedFile({ path, action: "reveal" }).catch(showError);
        },
      );
  }

  function openWorkspaceFile(
    path: string,
    folder?: string,
    agentId = deps.props.agent?.id,
    place: FileTabPlace = "tab",
    attachment?: AttachmentSummary,
    fallback?: () => void,
  ) {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!agentId || !ownerAgentId) return;
    const threadId = openingThreadId;
    const next = SHARED_FOLDER_PATH.test(path) ? () => openSharedFile(decodedPath(path), place, fallback) : fallback;
    const serverId = deps.props.server?.id ?? "local";
    const target = { agentId: ownerAgentId, serverId };
    const generation = deps.nextFilePreviewGeneration();
    const current = () =>
      scopeActive() &&
      generation === deps.currentFilePreviewGeneration() &&
      conversationOwnerId(deps.props) === ownerAgentId;
    const agent = conversationRuntime(deps.props).agent;
    deps.setComposerError(null, target);
    void agent.previewWorkspaceFile({ agentId, path }).then(
      (preview) => {
        if (!current()) {
          releaseFilePreviewPage(preview.pageUrl);
          return;
        }
        showSidebarFile(
          { ownerAgentId, threadId, source: { kind: "workspace", agentId, path, folder }, preview },
          place,
        );
      },
      (error) =>
        agent.listWorkspaceDirectory({ agentId, path }).then(
          (directory) => {
            if (!current()) return;
            showWorkspaceFolder(ownerAgentId, agentId, path, directory, place, threadId);
          },
          () => {
            if (!scopeActive() || generation !== deps.currentFilePreviewGeneration()) return;
            if (!attachment || !canPreviewAttachment(attachment)) {
              if (next) {
                if (current()) openFileFromThread(threadId, next);
              } else {
                deps.setComposerError(filePreviewError(error, path), target);
                fileTabReadFailed(place);
              }
              return;
            }
            if (current()) openFileFromThread(threadId, () => void previewAttachment(attachment, place));
          },
        ),
    );
  }

  function openThreadFile(kind: "shared" | "workspace", agentId: string | undefined, path: string, asWritten?: string) {
    const written = asWritten && agentId ? () => openWorkspaceFile(asWritten, undefined, agentId) : undefined;
    if (kind === "shared") openSharedFile(path, "tab", written);
    else if (agentId) openWorkspaceFile(path, undefined, agentId, "tab", undefined, written);
  }

  function previewWorkspaceAgentId(): string | undefined {
    const source = deps.sidebarFilePreview()?.source;
    return source?.kind === "workspace" || source?.kind === "workspace-folder" ? source.agentId : deps.props.agent?.id;
  }

  function openWorkspaceFolder(path: string, agentId = previewWorkspaceAgentId(), place: FileTabPlace = "here") {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!agentId || !ownerAgentId) return;
    const target = { agentId: ownerAgentId, serverId: deps.props.server?.id ?? "local" };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    void conversationRuntime(deps.props)
      .agent.listWorkspaceDirectory({ agentId, path })
      .then(
        (directory) => {
          if (generation !== deps.currentFilePreviewGeneration() || conversationOwnerId(deps.props) !== ownerAgentId)
            return;
          showWorkspaceFolder(ownerAgentId, agentId, path, directory, place);
        },
        (error) => {
          if (generation !== deps.currentFilePreviewGeneration()) return;
          deps.setComposerError(filePreviewError(error, path), target);
          fileTabReadFailed(place);
        },
      );
  }

  function showWorkspaceFolder(
    ownerAgentId: string,
    agentId: string,
    path: string,
    directory: WorkspaceDirectory,
    place: FileTabPlace,
    threadId?: string,
  ) {
    showSidebarFile(
      { ownerAgentId, threadId, source: { kind: "workspace-folder", agentId, path }, preview: null, directory },
      place,
    );
  }

  function showSidebarFile(file: SidebarFilePreview, place: FileTabPlace) {
    const { ownerAgentId, source } = file;
    const key = filePreviewKey(source);
    const shown = panels.side[ownerAgentId] ?? SIDE_PANEL_EMPTY;
    if (place === "open" && !shown.files.some((item) => item.key === key)) {
      releaseFilePreviewPage(file.preview?.pageUrl);
      return;
    }
    const existing = shown.files.find((item) => item.key === key);
    const replaced = place === "here" ? shown.files.find((item) => item.key === shown.file) : undefined;
    const threadId = file.threadId ?? (place === "tab" ? undefined : (existing ?? replaced)?.threadId);
    const tab: SidePanelFile = {
      key,
      name: file.directory?.name ?? file.preview?.name ?? key,
      folder: source.kind === "workspace-folder",
      source,
      unavailable: false,
      threadId,
    };
    updateSidePanel(ownerAgentId, (state) => {
      const files = [...state.files];
      const index = files.findIndex((item) => item.key === key);
      const here = place === "here" ? files.findIndex((item) => item.key === state.file) : -1;
      if (index >= 0) files[index] = tab;
      else if (here >= 0) files[here] = tab;
      else files.push(tab);
      return { ...state, files, file: key, selected: null };
    });
    deps.setSidebarFilePreview({ ...file, threadId });
    setActiveRightPanel("file-preview", ownerAgentId);
  }

  let openingFileTab: { ownerAgentId: string; key: string } | null = null;
  function setFileTabUnavailable(ownerAgentId: string, key: string, unavailable: boolean) {
    updateSidePanel(ownerAgentId, (state) => ({
      ...state,
      files: state.files.map((item) => (item.key === key ? { ...item, unavailable } : item)),
    }));
  }
  function fileTabReadFailed(place: FileTabPlace) {
    if (place === "open" && openingFileTab)
      setFileTabUnavailable(openingFileTab.ownerAgentId, openingFileTab.key, true);
  }

  function openSidePanelFile(key: string) {
    const ownerAgentId = conversationOwnerId(deps.props);
    const tab = sidePanel().files.find((item) => item.key === key);
    if (!ownerAgentId || !tab) return;
    const shown = deps.sidebarFilePreview();
    if (shown?.ownerAgentId === ownerAgentId && filePreviewKey(shown.source) === key) {
      deps.invalidateFilePreviewGeneration();
      updateSidePanel(ownerAgentId, (state) => ({ ...state, file: key, selected: null }));
      setActiveRightPanel("file-preview", ownerAgentId);
      return;
    }
    openingFileTab = { ownerAgentId, key };
    if (tab.unavailable) setFileTabUnavailable(ownerAgentId, key, false);
    const source = tab.source;
    if (source.kind === "attachment") void previewAttachment(source.attachment, "open");
    else if (source.kind === "shared") openSharedFile(source.path, "open");
    else if (source.kind === "workspace") openWorkspaceFile(source.path, source.folder, source.agentId, "open");
    else openWorkspaceFolder(source.path, source.agentId, "open");
  }

  function openWorkspaceFolderEntry(path: string) {
    const file = deps.sidebarFilePreview();
    const folder = file?.directory?.path;
    const agentId = previewWorkspaceAgentId();
    const openInWorkspace = () => openWorkspaceFile(path, folder, agentId, "here");
    const sibling = file?.source.kind === "shared" ? sharedSiblingPath(file.source.path, path) : null;
    if (sibling) openSharedFile(sibling, "here", openInWorkspace);
    else openInWorkspace();
  }

  const turnStep = createMemo(() => {
    if (!filePreviewOpen()) return undefined;
    const turnId = deps.props.activeTurnId;
    if (!turnId) return null;
    return [turnId, deps.props.activityDetail, deps.props.turnStepLines?.[turnId]?.at(-1)?.id].join("\u0000");
  });
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(turnStep, (step, previous) => {
    if (step === undefined || previous === undefined || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refreshSidebarFilePreview();
    }, FILE_PREVIEW_REFRESH_MS);
  });
  onCleanup(() => clearTimeout(refreshTimer));

  let refreshRequest = 0;
  function refreshSidebarFilePreview() {
    const file = deps.sidebarFilePreview();
    if (!file || !filePreviewOpen() || file.source.kind === "attachment") return;
    const { ownerAgentId, source } = file;
    const generation = deps.currentFilePreviewGeneration();
    const request = ++refreshRequest;
    const current = () =>
      scopeActive() &&
      request === refreshRequest &&
      generation === deps.currentFilePreviewGeneration() &&
      deps.sidebarFilePreview()?.source === source;
    const agent = conversationRuntime(deps.props).agent;
    if (source.kind === "workspace-folder") {
      void agent.listWorkspaceDirectory({ agentId: source.agentId, path: source.path }).then(
        (directory) => {
          if (!current() || JSON.stringify(directory) === JSON.stringify(file.directory)) return;
          deps.setSidebarFilePreview({ ownerAgentId, threadId: file.threadId, source, preview: null, directory });
        },
        () => undefined,
      );
      return;
    }
    const read =
      source.kind === "shared"
        ? agent.previewSharedFile({ path: source.path, maxBytes: FILE_PREVIEW_REFRESH_BYTES })
        : agent.previewWorkspaceFile({
            agentId: source.agentId,
            path: source.path,
            maxBytes: FILE_PREVIEW_REFRESH_BYTES,
          });
    void read.then(
      (preview) => {
        const overLimit = preview.bytes === null && file.preview?.bytes;
        if (!current() || overLimit || (file.preview && samePreview(preview, file.preview))) {
          releaseFilePreviewPage(preview.pageUrl);
          return;
        }
        deps.setSidebarFilePreview({ ownerAgentId, threadId: file.threadId, source, preview });
      },
      () => undefined,
    );
  }

  function previewFileKey(): string | undefined {
    const source = deps.sidebarFilePreview()?.source;
    return source ? filePreviewKey(source) : undefined;
  }

  function previewQuoteId(): string | undefined {
    const file = deps.sidebarFilePreview();
    const source = file?.source;
    const workspacePath =
      deps.props.channel && source?.kind === "workspace"
        ? deps.props.agents.find((agent) => agent.id === source.agentId)?.workspacePath
        : undefined;
    return filePreviewQuoteId(file, workspacePath);
  }

  function sidebarFileBack(): string | null {
    const file = deps.sidebarFilePreview();
    if (file?.directory) return file.directory.parentPath;
    return file?.source.kind === "workspace" ? (file.source.folder ?? null) : null;
  }

  function openSidebarFileBack() {
    const path = sidebarFileBack();
    if (path !== null) openWorkspaceFolder(path, previewWorkspaceAgentId(), "here");
  }

  function openSidebarFileExternally() {
    sidebarFileAction("open");
  }

  function downloadSidebarFile() {
    sidebarFileAction("download");
  }

  function revealSidebarFile() {
    sidebarFileAction("reveal");
  }

  function sidebarFileAction(action: FileAction) {
    const file = deps.sidebarFilePreview();
    if (!file) return;
    const source = file.source;
    if (source.kind === "attachment") {
      attachmentFileAction(source.attachment, action);
      return;
    }
    if (source.kind === "workspace-folder") return;
    const target = { agentId: file.ownerAgentId, serverId: deps.props.server?.id ?? "local" };
    const agent = conversationRuntime(deps.props).agent;
    const request =
      source.kind === "shared"
        ? agent.openSharedFile({ path: source.path, action })
        : agent.openWorkspaceFile({ agentId: source.agentId, path: source.path, action });
    const fallback = action === "download" ? t("attachment.error.download") : t("attachment.error.openFile");
    void request.catch((error) => deps.setComposerError(errorMessage(error, fallback), target));
  }

  function downloadMessageImageFile(file: MessageImageFile, agentId: string | undefined) {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!ownerAgentId) return;
    const target = { agentId: ownerAgentId, serverId: deps.props.server?.id ?? "local" };
    const agent = conversationRuntime(deps.props).agent;
    let request: Promise<void>;
    if (file.kind === "shared") request = agent.openSharedFile({ path: file.path, action: "download" });
    else if (agentId) request = agent.openWorkspaceFile({ agentId, path: file.path, action: "download" });
    else return;
    void request.catch((error) => deps.setComposerError(errorMessage(error, t("attachment.error.download")), target));
  }

  function clearSidebarFilePreview() {
    deps.invalidateFilePreviewGeneration();
    deps.setSidebarFilePreview(null);
  }

  return {
    skillSettingsRequest,
    openSkillSettings,
    clearSkillSettingsRequest,
    instructionsSettingsRequest,
    openInstructionsSettings,
    agentSettingRowRequest,
    openAgentSettingRow,
    handleAgentSettingRowRequest,
    routineSettingsRequest,
    activeRightPanel,
    settingsOpen,
    filesOpen,
    sideSplits,
    paneSplit,
    paneShown,
    removeSplitPane,
    moveSidePanelPane,
    panelSubagentId,
    openSubagentPanel,
    panelThreadId,
    openPanelThread,
    sidePanel,
    sidePanelOpen,
    setSidePanelMaximized,
    removeSidePanelPane,
    removeSidePanelFile,
    moveSidePanelFile,
    openSidePanelFile,
    filePreviewOpen,
    setActiveRightPanel,
    openRoutineSettings,
    handleRoutineSettingsRequest,
    clearRoutineSettingsRequest,
    openRoutineRunMessage,
    showBrowserPip,
    saveBrowserPipBounds,
    saveBrowserWindowBounds,
    openBrowserWindow,
    reattachBrowserWindow,
    hideBrowserPanel,
    openFileFromThread,
    previewAttachment,
    attachmentAction,
    attachmentDownloads,
    imageCopies,
    openSharedFile,
    openThreadFile,
    openWorkspaceFile,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    previewQuoteId,
    previewFileKey,
    previewWorkspaceAgentId,
    sidebarFileBack,
    openSidebarFileBack,
    openSidebarFileExternally,
    downloadSidebarFile,
    downloadMessageImageFile,
    revealSidebarFile,
    clearSidebarFilePreview,
  };
}

export function filePreviewKey(source: SidebarFilePreview["source"]): string {
  if (source.kind === "attachment") return `attachment\u0000${source.attachment.id}`;
  if (source.kind === "shared") return `shared\u0000${source.path}`;
  return `${source.kind}\u0000${source.agentId}\u0000${source.path}`;
}

function filePreviewError(error: unknown, path: string): string {
  const name = decodedPath(path).replaceAll("\\", "/").split("/").pop() || t("attachment.error.fileFallback");
  if (error instanceof Error && /\bENOENT\b/u.test(error.message)) {
    return t("attachment.error.fileNotFound", { name });
  }
  const fallback = t("attachment.error.previewFile", { name });
  const message = errorMessage(error, fallback);
  return message === fallback && matchingSourceKeys(normalizeMessage(error)).some((key) => MISSING_PATH_KEYS.has(key))
    ? t("attachment.error.fileNotFound", { name })
    : message;
}

const MISSING_PATH_KEYS = new Set([
  "error.backend.workspacePathMissing",
  "error.backend.workspacePathMissingForMember",
]);

function sharedSiblingPath(documentPath: string, link: string): string | null {
  if (/^(?:[/\\~]|[A-Za-z]:)/u.test(link) || SHARED_FOLDER_PATH.test(link)) return null;
  const end = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
  if (end < 0) return null;
  return `${documentPath.slice(0, end + 1)}${decodedPath(link)}`;
}

function samePreview(next: FilePreview, shown: FilePreview): boolean {
  if (
    next.name !== shown.name ||
    next.size !== shown.size ||
    next.mimeType !== shown.mimeType ||
    next.previewKind !== shown.previewKind
  )
    return false;
  if (!next.bytes || !shown.bytes) return next.bytes === shown.bytes;
  if (next.bytes.length !== shown.bytes.length) return false;
  for (let index = 0; index < next.bytes.length; index += 1) {
    if (next.bytes[index] !== shown.bytes[index]) return false;
  }
  return true;
}

function isBrowserScreenMode(mode: RightPanelMode): boolean {
  return mode === "browser-expanded" || mode === "browser-pip";
}

function withoutBrowserScreens(current: Record<string, RightPanelMode>): Record<string, RightPanelMode> {
  const entries = Object.entries(current);
  if (!entries.some(([, mode]) => isBrowserScreenMode(mode))) return current;
  return Object.fromEntries(
    entries.map(([agentId, mode]): [string, RightPanelMode] => [agentId, isBrowserScreenMode(mode) ? "none" : mode]),
  );
}
