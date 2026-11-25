import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { appendVoiceTranscript } from "@openbot/ui/voice-recording";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { useTurns } from "../../turns";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { remoteAgentError } from "../agents/agent-error-text";
import { attentionKey } from "../agents/agent-runtime-snapshot";
import { useAgents } from "../agents/agents-context";
import { createAttachmentDownloads } from "../conversation/attachment-downloads";
import { EMPTY_DRAFT } from "../conversation/composer-draft";
import { composerDraftKey } from "../conversation/conversation-keys";
import type { ComposerDraft } from "../conversation/conversation-types";
import { createVoiceStore, VOICE_LEVEL_COUNT, type VoiceStoreDeps } from "../conversation/stores/voice-store";
import { createServerResponseStyle } from "../servers/server-personality";
import { useServers } from "../servers/servers-context";
import { TasksView, type TasksVoiceAdapter, type TasksVoiceControls } from "./TasksView";
import { desktopTasksSource } from "./tasks-port";

const VOICE_TARGET_AGENT_ID = "tasks";

interface TasksPanelProps {
  serverId: string;
  hostName: string;
  onBack?: (() => void) | undefined;
}

export function TasksPanel(props: TasksPanelProps) {
  const { agentList } = useAgents();
  const { approvals, pendingPrompts, respondToApprovalRequest } = useTurns();
  const threads = useAgentTasks();
  const tabs = useAgentThreads();
  const { selectAgent } = useNavigation();
  const platform = usePlatform();
  const { servers } = useServers();
  const responseStyle = createServerResponseStyle(
    () => servers().find((server) => server.id === props.serverId),
    window.openbot.hostAdmin,
  );

  const attachmentFiles = createAttachmentDownloads({
    serverId: () => props.serverId,
    calls: () => ({
      open: (input) => window.openbot.agent.openAttachment(input, props.serverId),
      stop: (attachmentId) => window.openbot.agent.stopAttachmentDownload(attachmentId, props.serverId),
      subscribe: window.openbot.agent.onAttachmentDownload,
    }),
    target: () => undefined,
    onError: (error) => {
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t("attachment.error.open")));
    },
  });

  return (
    <TasksView
      {...props}
      source={desktopTasksSource()}
      failureText={props.serverId === LOCAL_SERVER_ID ? undefined : remoteAgentError}
      agents={agentList()}
      voice={createTasksVoice}
      onOpenLink={(url) => void appPort().openUrl(url)}
      onAttachmentAction={attachmentFiles.open}
      downloads={attachmentFiles.downloads}
      files={{
        accepted: threads.filesAccepted,
        import: (data, serverId) => window.openbot.agent.importAttachmentData(data, serverId),
        discard: (id, serverId) => window.openbot.agent.discardDraftAttachment(id, serverId),
      }}
      approvals={approvals()}
      waitsForAnswer={(task) => pendingPrompts()[attentionKey(task.agentId, task.threadId)] !== undefined}
      onOpenInChat={(task) => {
        tabs.open(task.agentId, task.id);
        selectAgent(task.agentId);
      }}
      sendShortcut={deviceSendShortcut(platform.appInfo()?.platform)}
      responseStyle={responseStyle()}
      onRead={(input, messageId) => threads.markTaskRead(input.agentId, input.taskId, messageId)}
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

function createTasksVoice(controls: TasksVoiceControls): TasksVoiceAdapter {
  const [phase, setPhase] = createSignal<ReturnType<VoiceStoreDeps["voicePhase"]>>("idle");
  const [taskId, setTaskId] = createSignal<string | undefined>();
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
    voiceThreadKey: taskId,
    setVoiceThreadKey: setTaskId,
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
    thread: {
      openDraftKey: () => (taskId() === undefined ? undefined : (controls.openTaskId() ?? undefined)),
      appendTranscript: controls.appendTaskTranscript,
      send: controls.sendTask,
      reportError: (message) => actionToast.error(message),
      reportLimit: () => actionToast.warning(currentText().t("composer.voice.limitReached")),
    },
  });
  createEffect(
    () => ({ open: controls.openTaskId(), owner: taskId(), recording: phase() === "recording" }),
    ({ open, owner, recording }) => {
      if (recording && owner !== undefined && owner !== open) store.stopVoiceRecording();
    },
  );

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
    get taskId() {
      return taskId();
    },
    onStart: () => void store.startVoiceRecording(),
    startTask: (id) => void store.startVoiceRecording(id),
    sendTask: store.stopVoiceRecordingAndSend,
    onCancel: store.cancelVoiceRecording,
    onFinish: store.stopVoiceRecording,
    submit() {
      if (phase() !== "recording") return;
      resources.voiceSubmitRequest = { ...target(), draft: draft(), queuedEdit: undefined };
      store.stopVoiceRecording();
    },
  };
}
