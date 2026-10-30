import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { useTurns } from "../../turns";
import { appendVoiceTranscript } from "../../voice-recording";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { attentionKey } from "../agents/agent-runtime-snapshot";
import { useAgents } from "../agents/agents-context";
import { EMPTY_DRAFT } from "../conversation/composer-draft";
import { composerDraftKey } from "../conversation/conversation-keys";
import type { ComposerDraft } from "../conversation/conversation-types";
import { createVoiceStore, VOICE_LEVEL_COUNT, type VoiceStoreDeps } from "../conversation/stores/voice-store";
import { TasksView, type TasksVoiceAdapter, type TasksVoiceControls } from "./TasksView";
import { desktopTasksSource } from "./tasks-port";

/** The voice store dictates for one composer. The Tasks composer is not an agent's, so it has its own key. */
const VOICE_TARGET_AGENT_ID = "tasks";

interface TasksPanelProps {
  serverId: string;
  hostName: string;
  onBack?: (() => void) | undefined;
  agentsOpen?: boolean | undefined;
  onToggleAgents?: (() => void) | undefined;
}

/** The Tasks page on desktop: the agents of the active server, the task IPC, and voice from this computer. */
export function TasksPanel(props: TasksPanelProps) {
  const { agentList } = useAgents();
  const { approvals, pendingPrompts, respondToApprovalRequest } = useTurns();
  const threads = useAgentTasks();
  const tabs = useAgentThreads();
  const { selectAgent } = useNavigation();
  const platform = usePlatform();
  const layout = useLayout();

  function openAttachment(attachment: AttachmentSummary, action: "open" | "reveal" | "download"): void {
    window.openbot.agent.openAttachment({ attachmentId: attachment.id, action }, props.serverId).catch((error) => {
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t("attachment.error.open")));
    });
  }

  return (
    <TasksView
      {...props}
      source={desktopTasksSource()}
      agents={agentList()}
      voice={createTasksVoice}
      onOpenLink={(url) => void appPort().openUrl(url)}
      onAttachmentAction={openAttachment}
      approvals={approvals()}
      // A question and a browser takeover wait by thread, as the thread tab reads them.
      waitsForAnswer={(task) => pendingPrompts()[attentionKey(task.agentId, task.threadId)] !== undefined}
      // The tab is written first, so the chat opens on it. Opening the chat closes the page.
      onOpenInChat={(task) => {
        tabs.open(task.agentId, task.id);
        // The Routines view covers the chat.
        layout.setSidebarView("agents");
        selectAgent(task.agentId);
      }}
      sendShortcut={deviceSendShortcut(platform.appInfo()?.platform)}
      // The thread state reaches the active server, which the page follows.
      onRead={(input, messageId) => threads.markTaskRead(input.agentId, input.taskId, messageId)}
      // The page covers the chat, so a failed answer shows as a toast, not in the chat.
      onRespondApproval={(approval, decision) =>
        respondToApprovalRequest(approval.agentId, approval.requestId, decision, {
          onError: (error) => {
            const { t, errorMessage } = currentText();
            actionToast.error(errorMessage(error, t("app.errorStatus.approval")));
          },
        })
      }
    />
  );
}

/**
 * The voice of the Tasks composer, with the voice store of the chat composer. The transcript goes into
 * the draft; a send while it records starts the task with the transcript.
 */
function createTasksVoice(controls: TasksVoiceControls): TasksVoiceAdapter {
  const [phase, setPhase] = createSignal<ReturnType<VoiceStoreDeps["voicePhase"]>>("idle");
  const [levels, setLevels] = createSignal<number[]>(Array.from({ length: VOICE_LEVEL_COUNT }, () => 0));
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
  const [liveText, setLiveText] = createSignal("");
  const [modelProgress, setModelProgress] = createSignal<number | null>(null);
  let mounted = true;
  const target = () => ({ agentId: VOICE_TARGET_AGENT_ID, serverId: controls.serverId() });
  const key = () => composerDraftKey(target());
  const draft = (): ComposerDraft => ({ ...EMPTY_DRAFT, text: controls.draft() });
  const resources: VoiceStoreDeps["resources"] = {
    voiceSubmitRequest: undefined,
    voiceDisposed: false,
    voiceRequestGeneration: 0,
    voiceRecorder: undefined,
    voiceStream: undefined,
    voiceRecordingTimer: undefined,
    voiceElapsedTimer: undefined,
    voiceChunks: [],
    voiceLiveRequest: undefined,
    voiceCloudStream: undefined,
    voiceMeterStop: undefined,
    voiceAgentId: undefined,
    voiceServerId: undefined,
    voiceThreadSend: false,
  };
  const showError = (message: string | null) => {
    if (message) controls.showError(message);
  };
  const store = createVoiceStore({
    props: {
      agent: { id: VOICE_TARGET_AGENT_ID },
      get server() {
        return { id: controls.serverId() };
      },
    },
    resources,
    voicePhase: phase,
    setVoicePhase: setPhase,
    setVoiceModelProgress: setModelProgress,
    voiceElapsedSeconds: elapsedSeconds,
    setVoiceElapsedSeconds: setElapsedSeconds,
    setVoiceLiveTranscript: (transcript) => setLiveText(transcript?.text ?? ""),
    // The Tasks composer has no side threads.
    voiceThreadKey: () => undefined,
    setVoiceThreadKey: () => {},
    setVoiceLevels: setLevels,
    drafts: () => ({ [key()]: draft() }),
    setDrafts: (update) => controls.setDraft(update({ [key()]: draft() })[key()]?.text ?? ""),
    setConversationErrors: (update) => showError(update({})[key()] ?? null),
    setComposerError: showError,
    setComposerFocusRequest: () => controls.focus(),
    clearConversationError: () => {},
    setConversationError: (_target, message) => showError(message),
    viewIsMounted: () => mounted,
    hooks: {
      saveEdit: async () => false,
      submit: async (override) => controls.start(override?.text ?? controls.draft()),
      restoreTranscript: (_target, transcript) =>
        controls.setDraft(appendVoiceTranscript(controls.draft(), transcript)),
    },
  });

  onCleanup(() => {
    mounted = false;
    resources.voiceDisposed = true;
    if (resources.voiceRecordingTimer) clearTimeout(resources.voiceRecordingTimer);
    if (resources.voiceElapsedTimer) clearInterval(resources.voiceElapsedTimer);
    if (resources.voiceRecorder?.state === "recording") resources.voiceRecorder.stop();
    for (const track of resources.voiceStream?.getTracks() ?? []) track.stop();
    resources.voiceMeterStop?.();
    store.cancelCloudStream();
  });

  return {
    get phase() {
      return phase();
    },
    get levels() {
      return levels();
    },
    get elapsedSeconds() {
      return elapsedSeconds();
    },
    get liveText() {
      return liveText();
    },
    get modelProgress() {
      return modelProgress();
    },
    onStart: () => void store.startVoiceRecording(),
    onCancel: store.cancelVoiceRecording,
    onFinish: store.stopVoiceRecording,
    submit() {
      if (phase() !== "recording") return;
      resources.voiceSubmitRequest = { ...target(), draft: draft(), queuedEdit: undefined };
      store.stopVoiceRecording();
    },
  };
}
