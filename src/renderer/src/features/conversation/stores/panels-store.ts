import {
  type AttachmentSummary,
  type BrowserBounds,
  canPreviewAttachment,
  type FileAction,
  type FilePreview,
  type WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import type { MessageImageFile } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, type Store, type StoreSetter, untrack } from "solid-js";
import { createScopeGuard } from "../../../scope-lifetime";
import { attachmentFilePreview } from "../attachment-preview";
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
import { filePreviewQuoteId } from "../quoted-text";
import { conversationOwnerId } from "./composer-store";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

export interface RoutineSettingsRequest {
  agentId: string;
  /** Null starts a new routine. */
  routineId: string | null;
  routineName: string;
  nonce: number;
}

/** The panes of one agent's side panel. The panel keeps them while it is closed. */
export interface SidePanelState {
  panes: readonly SidePanelPane[];
  /** The pane on screen, or the last one before the panel closed. */
  selected: SidePanelPane | null;
  maximized: boolean;
}

/** The side panel of each agent, the subagent in its Subagent pane, and the side thread that it shows. */
export interface SidePanelsState {
  side: Record<string, SidePanelState>;
  subagents: Record<string, string>;
  threads: Record<string, string>;
}

/** While the agent's turn runs, the shown file is read again at most this often. */
const FILE_PREVIEW_REFRESH_MS = 750;
/**
 * A larger file is not read again while the turn runs: a turn seldom changes a video or a large PDF,
 * and each read can download all of it from a remote host.
 */
const FILE_PREVIEW_REFRESH_BYTES = 8 * 1024 * 1024;

const SIDE_PANEL_EMPTY: SidePanelState = { panes: [], selected: null, maximized: false };

/** The panel mode of each pane. */
export const SIDE_PANEL_MODES = {
  browser: "browser",
  files: "files",
  settings: "settings",
  question: "question",
  voice: "voice",
  subagent: "subagent",
} as const satisfies Record<SidePanelPane, RightPanelMode>;

function isSidePanelPane(value: string): value is SidePanelPane {
  return value in SIDE_PANEL_MODES;
}

/** The pane that shows a panel mode, or null for a mode outside the side panel. */
function paneOfMode(mode: RightPanelMode): SidePanelPane | null {
  for (const [pane, paneMode] of Object.entries(SIDE_PANEL_MODES)) {
    if (paneMode === mode && isSidePanelPane(pane)) return pane;
  }
  return null;
}

export interface PanelsStoreDeps {
  props: ConversationProps;
  rightPanels: () => Record<string, RightPanelMode>;
  setRightPanels: (update: (current: Record<string, RightPanelMode>) => Record<string, RightPanelMode>) => void;
  /** Owned with `rightPanels`, so that the tabs stay with the open pane when the view of the chat closes. */
  panels: Store<SidePanelsState>;
  setPanels: StoreSetter<SidePanelsState>;
  settingsProvider: () => import("@openbot/contracts/ipc").AgentProviderId;
  settingsModel: () => import("@openbot/contracts/ipc").AgentModelId;
  settingsReasoning: () => import("@openbot/contracts/ipc").AgentReasoningEffort;
  setBrowserPipBounds: (bounds: BrowserBounds | null) => void;
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
  const [instructionsSettingsRequest, setInstructionsSettingsRequest] = createSignal<{ agentId: string } | null>(null);
  /** Opens Settings > Instructions of the chat's agent. A new object opens the page again. */
  function openInstructionsSettings(agentId: string): void {
    if (deps.props.agent?.id !== agentId) return;
    setInstructionsSettingsRequest({ agentId });
    setActiveRightPanel("settings", agentId);
  }
  const [routineSettingsRequest, setRoutineSettingsRequest] = createSignal<RoutineSettingsRequest | null>(null);
  let routineSettingsRequestNonce = 0;

  const channel = untrack(() => deps.props.channel);
  const activeRightPanel = createMemo<RightPanelMode>(() => {
    // A deleted channel takes no edit, so its panels stay closed.
    if (channel?.readOnly()) return "none";
    const agentId = conversationOwnerId(deps.props);
    return agentId ? (deps.rightPanels()[agentId] ?? "none") : "none";
  });
  const { panels, setPanels } = deps;
  const sidePanel = (): SidePanelState => {
    const agentId = conversationOwnerId(deps.props);
    return (agentId && panels.side[agentId]) || SIDE_PANEL_EMPTY;
  };
  const sidePanelOpen = () =>
    activeRightPanel() === "side-panel" || activeRightPanel() === "thread" || paneOfMode(activeRightPanel()) !== null;
  function updateSidePanel(agentId: string, update: (state: SidePanelState) => SidePanelState) {
    setPanels((draft) => {
      draft.side[agentId] = update(draft.side[agentId] ?? SIDE_PANEL_EMPTY);
    });
  }
  function setSidePanelMaximized(maximized: boolean) {
    const agentId = conversationOwnerId(deps.props);
    if (agentId) updateSidePanel(agentId, (state) => ({ ...state, maximized }));
  }
  /** Removes the tab of a pane. Returns the pane to show in its place, or null when no tab stays. */
  function removeSidePanelPane(pane: SidePanelPane): SidePanelPane | null {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return null;
    const state = panels.side[agentId] ?? SIDE_PANEL_EMPTY;
    const index = state.panes.indexOf(pane);
    const panes = state.panes.filter((item) => item !== pane);
    const selected =
      state.selected === pane ? (panes[Math.min(Math.max(index, 0), panes.length - 1)] ?? null) : state.selected;
    updateSidePanel(agentId, () => ({ panes, selected, maximized: panes.length > 0 && state.maximized }));
    return selected;
  }
  const settingsOpen = () => activeRightPanel() === "settings";
  const filesOpen = () => activeRightPanel() === "files";
  const panelSubagentId = (): string | null => {
    const agentId = conversationOwnerId(deps.props);
    return agentId ? (panels.subagents[agentId] ?? null) : null;
  };
  /** The side thread of the side panel, while it shows or when it showed last. It can be gone. */
  const panelThreadId = (): string | null => {
    const agentId = conversationOwnerId(deps.props);
    return agentId ? (panels.threads[agentId] ?? null) : null;
  };
  const filePreviewOpen = () =>
    activeRightPanel() === "file-preview" &&
    deps.sidebarFilePreview()?.ownerAgentId === conversationOwnerId(deps.props);

  function setActiveRightPanel(mode: RightPanelMode, agentId = conversationOwnerId(deps.props)) {
    if (!agentId) return;
    if (mode !== "settings") {
      setSkillSettingsRequest(null);
      setInstructionsSettingsRequest(null);
      setRoutineSettingsRequest((current) => (current?.agentId === agentId ? null : current));
    }
    deps.setRightPanels((current) => (current[agentId] === mode ? current : { ...current, [agentId]: mode }));
    const pane = paneOfMode(mode);
    if (pane)
      updateSidePanel(agentId, (state) => ({
        ...state,
        panes: state.panes.includes(pane) ? state.panes : [...state.panes, pane],
        selected: pane,
      }));
    else if (mode === "side-panel" || mode === "thread")
      updateSidePanel(agentId, (state) => ({ ...state, selected: null }));
    else if (mode === "none" && panels.side[agentId]?.maximized) {
      updateSidePanel(agentId, (state) => ({ ...state, maximized: false }));
    }
  }

  /** Opens the steps of a subagent of this chat in the side panel. */
  function openSubagentPanel(subagentId: string): void {
    const agentId = conversationOwnerId(deps.props);
    if (!agentId) return;
    setPanels((draft) => {
      draft.subagents[agentId] = subagentId;
    });
    setActiveRightPanel("subagent", agentId);
  }

  /** Shows a side thread in the side panel. */
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

  function openRoutineRunMessage(messageId: string): void {
    setActiveRightPanel("none");
    void deps.props.onOpenSearchMessage?.(messageId);
  }

  function showBrowserPip() {
    setActiveRightPanel("browser-pip");
  }

  function saveBrowserPipBounds(bounds: BrowserBounds) {
    deps.setBrowserPipBounds(bounds);
    window.localStorage.setItem(
      "openbot:browser-pip-native-bounds",
      [bounds.x, bounds.y, bounds.width, bounds.height].join(","),
    );
  }

  function hideBrowserPanel() {
    setActiveRightPanel("none");
    if (deps.props.browserEnabled !== false)
      void conversationRuntime(deps.props).browser.setVisible({ visible: false });
  }

  /**
   * Opens an attachment in the file preview panel, the same surface a shared or workspace file
   * uses. The bytes come from `previewUrl` rather than the preview IPC, because an attachment is
   * named by its id and has no path on the agent's computer.
   */
  async function previewAttachment(attachment: AttachmentSummary) {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!ownerAgentId || !canPreviewAttachment(attachment)) return;
    const target = { agentId: ownerAgentId, serverId: deps.props.server?.id ?? "local" };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    try {
      const preview = await (deps.props.runtime?.previewAttachment?.(attachment) ?? attachmentFilePreview(attachment));
      if (generation !== deps.currentFilePreviewGeneration() || conversationOwnerId(deps.props) !== ownerAgentId)
        return;
      deps.setSidebarFilePreview({ ownerAgentId, source: { kind: "attachment", attachment }, preview });
      setActiveRightPanel("file-preview", ownerAgentId);
    } catch (error) {
      if (generation !== deps.currentFilePreviewGeneration()) return;
      deps.setComposerError(errorMessage(error, t("attachment.error.preview", { name: attachment.name })), target);
    }
  }

  function attachmentAction(attachment: AttachmentSummary, action: FileAction) {
    // A runtime has no app to open a file in, so a file it can preview opens in the panel.
    if (action === "open" && deps.props.runtime && canPreviewAttachment(attachment)) {
      void previewAttachment(attachment);
      return;
    }
    const agentId = conversationOwnerId(deps.props);
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    void conversationRuntime(deps.props)
      .agent.openAttachment({ attachmentId: attachment.id, action })
      .catch((error) => deps.setComposerError(errorMessage(error, t("attachment.error.open")), target));
  }

  function openSharedFile(path: string) {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!ownerAgentId) return;
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
          deps.setSidebarFilePreview({ ownerAgentId, source: { kind: "shared", path }, preview });
          setActiveRightPanel("file-preview", ownerAgentId);
        },
        (error) => {
          if (!scopeActive() || generation !== deps.currentFilePreviewGeneration()) return;
          const showError = () => {
            if (!scopeActive() || generation !== deps.currentFilePreviewGeneration()) return;
            deps.setComposerError(filePreviewError(error, path), target);
          };
          // A link can name a folder. A local one is shown in the file manager; when that fails too,
          // the preview error stays. A remote or web host cannot show a folder on this computer.
          if (serverId !== "local" || deps.props.runtime) {
            showError();
            return;
          }
          void conversationRuntime(deps.props).agent.openSharedFile({ path, action: "reveal" }).catch(showError);
        },
      );
  }

  /**
   * A chip can name a folder as well as a file. When the file preview fails, the folder listing is
   * tried; when that fails too, the preview error stays, because it names the path the agent wrote.
   * `agentId` is the agent whose workspace holds the path; in a channel, the agent that wrote it.
   */
  function openWorkspaceFile(path: string, folder?: string, agentId = deps.props.agent?.id) {
    const ownerAgentId = conversationOwnerId(deps.props);
    if (!agentId || !ownerAgentId) return;
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
        // The host answers a path that is not there with a missing preview, so a chip for a file that
        // only the message's author has says so instead of opening an empty panel.
        if (preview.missing) {
          releaseFilePreviewPage(preview.pageUrl);
          deps.setComposerError(missingFileError(path), target);
          return;
        }
        deps.setSidebarFilePreview({ ownerAgentId, source: { kind: "workspace", agentId, path, folder }, preview });
        setActiveRightPanel("file-preview", ownerAgentId);
      },
      (error) =>
        agent.listWorkspaceDirectory({ agentId, path }).then(
          (directory) => {
            if (!current()) return;
            showWorkspaceFolder(ownerAgentId, agentId, path, directory);
          },
          () => {
            if (!scopeActive() || generation !== deps.currentFilePreviewGeneration()) return;
            deps.setComposerError(filePreviewError(error, path), target);
          },
        ),
    );
  }

  /** The agent whose workspace the shown file or folder is in, so that its links open there too. */
  function previewWorkspaceAgentId(): string | undefined {
    const source = deps.sidebarFilePreview()?.source;
    return source?.kind === "workspace" || source?.kind === "workspace-folder" ? source.agentId : deps.props.agent?.id;
  }

  function openWorkspaceFolder(path: string) {
    const agentId = previewWorkspaceAgentId();
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
          showWorkspaceFolder(ownerAgentId, agentId, path, directory);
        },
        (error) => {
          if (generation !== deps.currentFilePreviewGeneration()) return;
          deps.setComposerError(filePreviewError(error, path), target);
        },
      );
  }

  function showWorkspaceFolder(ownerAgentId: string, agentId: string, path: string, directory: WorkspaceDirectory) {
    deps.setSidebarFilePreview({
      ownerAgentId,
      source: { kind: "workspace-folder", agentId, path },
      preview: null,
      directory,
    });
    setActiveRightPanel("file-preview", ownerAgentId);
  }

  /**
   * Opens a file of the folder view, so that the panel can go back to the folder, or a link of the
   * shown file. Both are in the workspace of the agent the panel shows.
   */
  function openWorkspaceFolderEntry(path: string) {
    const file = deps.sidebarFilePreview();
    openWorkspaceFile(path, file?.directory?.path, previewWorkspaceAgentId());
  }

  /**
   * An agent changes files in the steps of its turn. While the panel is open, each new step of the
   * running turn, and the end of the turn, reads the shown file or folder again. Text that the turn
   * writes is not a step. A memo, because an effect runs again on an equal value: opening another
   * file, or a read that shows a change, must not start a read.
   */
  const turnStep = createMemo(() => {
    if (!filePreviewOpen()) return undefined;
    const turnId = deps.props.activeTurnId;
    if (!turnId) return null;
    return [turnId, deps.props.activityDetail, deps.props.turnStepLines?.[turnId]?.at(-1)?.id].join("\u0000");
  });
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(turnStep, (step, previous) => {
    // Opening the panel just read the file.
    if (step === undefined || previous === undefined || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refreshSidebarFilePreview();
    }, FILE_PREVIEW_REFRESH_MS);
  });
  onCleanup(() => clearTimeout(refreshTimer));

  let refreshRequest = 0;
  /**
   * Reads the shown file or folder again, and shows the result only when it changed. A file that the
   * user opened since, or a newer read, wins. A failed read keeps what the panel shows: a turn can
   * move or delete the file, and the open file stays readable until the user closes it.
   */
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
          deps.setSidebarFilePreview({ ownerAgentId, source, preview: null, directory });
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
        // No bytes from a file that showed bytes: the file is over the limit, so keep what shows.
        const overLimit = preview.bytes === null && file.preview?.bytes;
        // A file moved or deleted since it opened keeps what shows, as a failed read does.
        if (!current() || preview.missing || overLimit || (file.preview && samePreview(preview, file.preview))) {
          releaseFilePreviewPage(preview.pageUrl);
          return;
        }
        deps.setSidebarFilePreview({ ownerAgentId, source, preview });
      },
      () => undefined,
    );
  }

  /**
   * Names the file or folder that the side panel shows. A preview read again keeps the key, so the
   * panel keeps the source view of the file.
   */
  function previewFileKey(): string | undefined {
    const source = deps.sidebarFilePreview()?.source;
    if (!source) return undefined;
    if (source.kind === "attachment") return `attachment\u0000${source.attachment.id}`;
    if (source.kind === "shared") return `shared\u0000${source.path}`;
    return `${source.kind}\u0000${source.agentId}\u0000${source.path}`;
  }

  /** The quote id of the file that the side panel shows. See `filePreviewQuoteId`. */
  function previewQuoteId(): string | undefined {
    const file = deps.sidebarFilePreview();
    const source = file?.source;
    const workspacePath =
      deps.props.channel && source?.kind === "workspace"
        ? deps.props.agents.find((agent) => agent.id === source.agentId)?.workspacePath
        : undefined;
    return filePreviewQuoteId(file, workspacePath);
  }

  /** Back to the folder a file came from, or up one folder. Absent when there is nowhere to go. */
  function sidebarFileBack(): string | null {
    const file = deps.sidebarFilePreview();
    if (file?.directory) return file.directory.parentPath;
    return file?.source.kind === "workspace" ? (file.source.folder ?? null) : null;
  }

  function openSidebarFileBack() {
    const path = sidebarFileBack();
    if (path !== null) openWorkspaceFolder(path);
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
      attachmentAction(source.attachment, action);
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

  /** Downloads an image file that a message names. `agentId` is the agent whose workspace holds a workspace path. */
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

  function closeSidebarFilePreview() {
    deps.invalidateFilePreviewGeneration();
    deps.setSidebarFilePreview(null);
    setActiveRightPanel("none");
  }

  return {
    skillSettingsRequest,
    openSkillSettings,
    instructionsSettingsRequest,
    openInstructionsSettings,
    routineSettingsRequest,
    activeRightPanel,
    settingsOpen,
    filesOpen,
    panelSubagentId,
    openSubagentPanel,
    panelThreadId,
    openPanelThread,
    sidePanel,
    sidePanelOpen,
    setSidePanelMaximized,
    removeSidePanelPane,
    filePreviewOpen,
    setActiveRightPanel,
    openRoutineSettings,
    handleRoutineSettingsRequest,
    clearRoutineSettingsRequest,
    openRoutineRunMessage,
    showBrowserPip,
    saveBrowserPipBounds,
    hideBrowserPanel,
    previewAttachment,
    attachmentAction,
    openSharedFile,
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
    closeSidebarFilePreview,
  };
}

function filePreviewError(error: unknown, path: string): string {
  if (error instanceof Error && /\bENOENT\b/u.test(error.message)) return missingFileError(path);
  return errorMessage(error, t("attachment.error.previewFile", { name: fileName(path) }));
}

/** The sentence a chip shows for a path that is not in the workspace. */
function missingFileError(path: string): string {
  return t("attachment.error.fileNotFound", { name: fileName(path) });
}

function fileName(path: string): string {
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    // A literal percent sign can be part of a file name.
  }
  return decodedPath.replaceAll("\\", "/").split("/").pop() || t("attachment.error.fileFallback");
}

/** The same file content, so a read again need not replace the shown one. */
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
