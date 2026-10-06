import {
  type AttachmentSummary,
  type BrowserBounds,
  canPreviewAttachment,
  type FileAction,
  type WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createMemo, createSignal } from "solid-js";
import { attachmentFilePreview } from "../attachment-preview";
import { conversationRuntime } from "../conversation-runtime";
import type { ConversationProps, ConversationTarget, RightPanelMode, SidebarFilePreview } from "../conversation-types";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

export interface RoutineSettingsRequest {
  agentId: string;
  routineId: string;
  routineName: string;
  nonce: number;
}

export interface PanelsStoreDeps {
  props: ConversationProps;
  rightPanels: () => Record<string, RightPanelMode>;
  setRightPanels: (update: (current: Record<string, RightPanelMode>) => Record<string, RightPanelMode>) => void;
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
  const [skillSettingsRequest, setSkillSettingsRequest] = createSignal<{ agentId: string; skillId: string } | null>(
    null,
  );
  function openSkillSettings(skill: { skillId: string }): void {
    const agentId = deps.props.agent?.id;
    if (!agentId || deps.props.server?.id !== "local") return;
    setSkillSettingsRequest({ agentId, skillId: skill.skillId });
    setActiveRightPanel("settings", agentId);
  }
  const [routineSettingsRequest, setRoutineSettingsRequest] = createSignal<RoutineSettingsRequest | null>(null);
  let routineSettingsRequestNonce = 0;

  const activeRightPanel = createMemo<RightPanelMode>(() => {
    const agentId = deps.props.agent?.id;
    return agentId ? (deps.rightPanels()[agentId] ?? "none") : "none";
  });
  const settingsOpen = () => activeRightPanel() === "settings";
  const profileOpen = () => activeRightPanel() === "profile";
  const filesOpen = () => activeRightPanel() === "files";
  const filePreviewOpen = () =>
    activeRightPanel() === "file-preview" && deps.sidebarFilePreview()?.ownerAgentId === deps.props.agent?.id;

  function setActiveRightPanel(mode: RightPanelMode, agentId = deps.props.agent?.id) {
    if (!agentId) return;
    if (mode !== "settings") {
      setSkillSettingsRequest(null);
      setRoutineSettingsRequest((current) => (current?.agentId === agentId ? null : current));
    }
    deps.setRightPanels((current) => (current[agentId] === mode ? current : { ...current, [agentId]: mode }));
  }

  function toggleFilesPanel(): void {
    setActiveRightPanel(filesOpen() ? "none" : "files");
  }

  function openRoutineSettings(routine: { routineId: string; name: string }): void {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    routineSettingsRequestNonce += 1;
    setRoutineSettingsRequest({
      agentId,
      routineId: routine.routineId,
      routineName: routine.name,
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
    const ownerAgentId = deps.props.agent?.id;
    if (!ownerAgentId || !canPreviewAttachment(attachment)) return;
    const target = { agentId: ownerAgentId, serverId: deps.props.server?.id ?? "local" };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    try {
      const preview = await (deps.props.runtime?.previewAttachment?.(attachment) ?? attachmentFilePreview(attachment));
      if (generation !== deps.currentFilePreviewGeneration() || deps.props.agent?.id !== ownerAgentId) return;
      deps.setSidebarFilePreview({ ownerAgentId, source: { kind: "attachment", attachment }, preview });
      setActiveRightPanel("file-preview", ownerAgentId);
    } catch (error) {
      if (generation !== deps.currentFilePreviewGeneration()) return;
      deps.setComposerError(errorMessage(error, t("attachment.error.preview", { name: attachment.name })), target);
    }
  }

  async function downloadAttachments(attachments: AttachmentSummary[]) {
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    try {
      await conversationRuntime(deps.props).agent.downloadAttachments({
        attachments: attachments.map(({ id, name }) => ({ id, name })),
      });
    } catch (error) {
      deps.setComposerError(errorMessage(error, t("attachment.error.download")), target);
    }
  }

  function attachmentAction(attachment: AttachmentSummary, action: FileAction) {
    // A runtime has no app to open a file in, so a file it can preview opens in the panel.
    if (action === "open" && deps.props.runtime && canPreviewAttachment(attachment)) {
      void previewAttachment(attachment);
      return;
    }
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    void conversationRuntime(deps.props)
      .agent.openAttachment({ attachmentId: attachment.id, action })
      .catch((error) => deps.setComposerError(errorMessage(error, t("attachment.error.open")), target));
  }

  function openSharedFile(path: string) {
    const ownerAgentId = deps.props.agent?.id;
    if (!ownerAgentId) return;
    const serverId = deps.props.server?.id ?? "local";
    const target = { agentId: ownerAgentId, serverId };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    void conversationRuntime(deps.props)
      .agent.previewSharedFile({ path })
      .then(
        (preview) => {
          if (generation !== deps.currentFilePreviewGeneration() || deps.props.agent?.id !== ownerAgentId) return;
          deps.setSidebarFilePreview({ ownerAgentId, source: { kind: "shared", path }, preview });
          setActiveRightPanel("file-preview", ownerAgentId);
        },
        (error) => {
          if (generation !== deps.currentFilePreviewGeneration()) return;
          deps.setComposerError(filePreviewError(error, path), target);
        },
      );
  }

  /**
   * A chip can name a folder as well as a file. When the file preview fails, the folder listing is
   * tried; when that fails too, the preview error stays, because it names the path the agent wrote.
   */
  function openWorkspaceFile(path: string, folder?: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    const serverId = deps.props.server?.id ?? "local";
    const target = { agentId, serverId };
    const generation = deps.nextFilePreviewGeneration();
    const current = () => generation === deps.currentFilePreviewGeneration() && deps.props.agent?.id === agentId;
    const agent = conversationRuntime(deps.props).agent;
    deps.setComposerError(null, target);
    void agent.previewWorkspaceFile({ agentId, path }).then(
      (preview) => {
        if (!current()) return;
        deps.setSidebarFilePreview({ ownerAgentId: agentId, source: { kind: "workspace", path, folder }, preview });
        setActiveRightPanel("file-preview", agentId);
      },
      (error) =>
        agent.listWorkspaceDirectory({ agentId, path }).then(
          (directory) => {
            if (!current()) return;
            showWorkspaceFolder(agentId, path, directory);
          },
          () => {
            if (generation !== deps.currentFilePreviewGeneration()) return;
            deps.setComposerError(filePreviewError(error, path), target);
          },
        ),
    );
  }

  function openWorkspaceFolder(path: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    const target = { agentId, serverId: deps.props.server?.id ?? "local" };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    void conversationRuntime(deps.props)
      .agent.listWorkspaceDirectory({ agentId, path })
      .then(
        (directory) => {
          if (generation !== deps.currentFilePreviewGeneration() || deps.props.agent?.id !== agentId) return;
          showWorkspaceFolder(agentId, path, directory);
        },
        (error) => {
          if (generation !== deps.currentFilePreviewGeneration()) return;
          deps.setComposerError(filePreviewError(error, path), target);
        },
      );
  }

  function showWorkspaceFolder(agentId: string, path: string, directory: WorkspaceDirectory) {
    deps.setSidebarFilePreview({
      ownerAgentId: agentId,
      source: { kind: "workspace-folder", path },
      preview: null,
      directory,
    });
    setActiveRightPanel("file-preview", agentId);
  }

  /** Opens a file of the folder view, so that the panel can go back to the folder. */
  function openWorkspaceFolderEntry(path: string) {
    const file = deps.sidebarFilePreview();
    openWorkspaceFile(path, file?.directory?.path);
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
        : agent.openWorkspaceFile({ agentId: file.ownerAgentId, path: source.path, action });
    const fallback = action === "download" ? t("attachment.error.download") : t("attachment.error.openFile");
    void request.catch((error) => deps.setComposerError(errorMessage(error, fallback), target));
  }

  function closeSidebarFilePreview() {
    deps.invalidateFilePreviewGeneration();
    deps.setSidebarFilePreview(null);
    setActiveRightPanel("none");
  }

  return {
    skillSettingsRequest,
    openSkillSettings,
    routineSettingsRequest,
    activeRightPanel,
    settingsOpen,
    profileOpen,
    filesOpen,
    toggleFilesPanel,
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
    downloadAttachments,
    openSharedFile,
    openWorkspaceFile,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    sidebarFileBack,
    openSidebarFileBack,
    openSidebarFileExternally,
    downloadSidebarFile,
    revealSidebarFile,
    closeSidebarFilePreview,
  };
}

function filePreviewError(error: unknown, path: string): string {
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    // A literal percent sign can be part of a file name.
  }
  const name = decodedPath.replaceAll("\\", "/").split("/").pop() || t("attachment.error.fileFallback");
  if (error instanceof Error && /\bENOENT\b/u.test(error.message)) {
    return t("attachment.error.fileNotFound", { name });
  }
  return errorMessage(error, t("attachment.error.previewFile", { name }));
}
