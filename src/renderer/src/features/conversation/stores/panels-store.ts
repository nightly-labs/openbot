import { type AttachmentSummary, type BrowserBounds, canPreviewAttachment } from "@openbot/contracts/ipc";
import { errorMessage } from "@openbot/ui/error-message";
import { createMemo, createSignal } from "solid-js";
import { attachmentFilePreview } from "../attachment-preview";
import { conversationRuntime } from "../conversation-runtime";
import type { ConversationProps, ConversationTarget, RightPanelMode, SidebarFilePreview } from "../conversation-types";

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
      deps.setComposerError(errorMessage(error, `Could not preview ${attachment.name}. Try again.`), target);
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
      deps.setComposerError(errorMessage(error, "Could not download attachments. Try again."), target);
    }
  }

  function attachmentAction(attachment: AttachmentSummary, action: "open" | "reveal" | "download") {
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    void conversationRuntime(deps.props)
      .agent.openAttachment({ attachmentId: attachment.id, action })
      .catch((error) =>
        deps.setComposerError(errorMessage(error, "Could not open or save this attachment. Try again."), target),
      );
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

  function openWorkspaceFile(path: string) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    const serverId = deps.props.server?.id ?? "local";
    const target = { agentId, serverId };
    const generation = deps.nextFilePreviewGeneration();
    deps.setComposerError(null, target);
    void conversationRuntime(deps.props)
      .agent.previewWorkspaceFile({ agentId, path })
      .then(
        (preview) => {
          if (generation !== deps.currentFilePreviewGeneration() || deps.props.agent?.id !== agentId) return;
          deps.setSidebarFilePreview({ ownerAgentId: agentId, source: { kind: "workspace", path }, preview });
          setActiveRightPanel("file-preview", agentId);
        },
        (error) => {
          if (generation !== deps.currentFilePreviewGeneration()) return;
          deps.setComposerError(filePreviewError(error, path), target);
        },
      );
  }

  function openSidebarFileExternally() {
    const file = deps.sidebarFilePreview();
    if (!file) return;
    const target = { agentId: file.ownerAgentId, serverId: deps.props.server?.id ?? "local" };
    const source = file.source;
    const request =
      source.kind === "attachment"
        ? conversationRuntime(deps.props).agent.openAttachment({ attachmentId: source.attachment.id, action: "open" })
        : source.kind === "shared"
          ? conversationRuntime(deps.props).agent.openSharedFile({ path: source.path })
          : conversationRuntime(deps.props).agent.openWorkspaceFile({ agentId: file.ownerAgentId, path: source.path });
    void request.catch((error) =>
      deps.setComposerError(errorMessage(error, "Could not open this file. Try again."), target),
    );
  }

  function downloadSidebarFile() {
    const source = deps.sidebarFilePreview()?.source;
    if (source?.kind !== "attachment") return;
    attachmentAction(source.attachment, "download");
  }

  function revealSidebarFile() {
    const source = deps.sidebarFilePreview()?.source;
    if (source?.kind !== "attachment") return;
    attachmentAction(source.attachment, "reveal");
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
    openSidebarFileExternally,
    downloadSidebarFile,
    revealSidebarFile,
    closeSidebarFilePreview,
  };
}

export type PanelsStore = ReturnType<typeof createPanelsStore>;

function filePreviewError(error: unknown, path: string): string {
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    // A literal percent sign can be part of a file name.
  }
  const name = decodedPath.replaceAll("\\", "/").split("/").pop() || "File";
  if (error instanceof Error && /\bENOENT\b/u.test(error.message)) {
    return `“${name}” was not found. Ask the agent to create or restore the file, then click the link again.`;
  }
  return errorMessage(error, `Could not preview “${name}”. Try again.`);
}
