import type { AgentDockVoice, AgentDockVoiceTarget } from "@openbot/ui/features/agent-dock/AgentDock";
import { createSignal, onCleanup } from "solid-js";
import { appendVoiceTranscript } from "../../voice-recording";
import { EMPTY_DRAFT } from "../conversation/composer-draft";
import { composerDraftKey } from "../conversation/conversation-keys";
import type { ComposerDraft } from "../conversation/conversation-types";
import { createVoiceStore, VOICE_LEVEL_COUNT, type VoiceStoreDeps } from "../conversation/stores/voice-store";

/**
 * The microphone of the dock chats, with the voice store of the chat composer. The words go into the
 * draft of the chat that started the recording; a send while it records sends the draft with them.
 * Call it in a component: the recording stops when the component goes.
 */
export function createAgentDockVoice(serverId: () => string): AgentDockVoice {
  const [phase, setPhase] = createSignal<ReturnType<VoiceStoreDeps["voicePhase"]>>("idle");
  const [levels, setLevels] = createSignal<number[]>(Array.from({ length: VOICE_LEVEL_COUNT }, () => 0));
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
  const [liveText, setLiveText] = createSignal("");
  const [modelProgress, setModelProgress] = createSignal<number | null>(null);
  /**
   * The chat of the last recording. It stays set while the words are transcribed. A plain value: the
   * store reads it in the same task that sets it, before a signal write would show.
   */
  let current: AgentDockVoiceTarget | undefined;
  const target = () => current;
  let mounted = true;
  /* The voice store keys its recording by agent id. The seat key stands in for it: it names an agent or
     a channel seat, and nothing outside this adapter reads it. */
  const recordingTarget = () => ({ agentId: target()?.seatKey ?? "", serverId: serverId() });
  const key = () => composerDraftKey(recordingTarget());
  const draft = (): ComposerDraft => ({ ...EMPTY_DRAFT, text: target()?.draft() ?? "" });
  const showError = (message: string | null) => {
    if (message) target()?.showError(message);
  };
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
  const store = createVoiceStore({
    props: {
      get agent() {
        const seatKey = target()?.seatKey;
        return seatKey ? { id: seatKey } : undefined;
      },
      get server() {
        return { id: serverId() };
      },
    },
    resources,
    voicePhase: phase,
    setVoicePhase: setPhase,
    setVoiceModelProgress: setModelProgress,
    voiceElapsedSeconds: elapsedSeconds,
    setVoiceElapsedSeconds: setElapsedSeconds,
    setVoiceLiveTranscript: (transcript) => setLiveText(transcript?.text ?? ""),
    // The dock chats have no side threads.
    voiceThreadKey: () => undefined,
    setVoiceThreadKey: () => {},
    setVoiceLevels: setLevels,
    drafts: () => ({ [key()]: draft() }),
    setDrafts: (update) => target()?.setDraft(update({ [key()]: draft() })[key()]?.text ?? ""),
    setConversationErrors: (update) => showError(update({})[key()] ?? null),
    setComposerError: showError,
    setComposerFocusRequest: () => target()?.focus(),
    clearConversationError: () => {},
    setConversationError: (_target, message) => showError(message),
    viewIsMounted: () => mounted,
    hooks: {
      saveEdit: async () => false,
      submit: async (override) => {
        const chat = target();
        if (!chat) return false;
        const text = override?.text ?? chat.draft();
        chat.setDraft(text);
        chat.send(text);
        return true;
      },
      restoreTranscript: (_target, transcript) => {
        const chat = target();
        chat?.setDraft(appendVoiceTranscript(chat.draft(), transcript));
      },
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
    get seatKey() {
      return phase() === "idle" ? null : (target()?.seatKey ?? null);
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
    onStart(next) {
      if (phase() !== "idle") return;
      current = next;
      void store.startVoiceRecording();
    },
    onCancel: store.cancelVoiceRecording,
    onFinish: store.stopVoiceRecording,
    onSend() {
      if (phase() !== "recording") return;
      resources.voiceSubmitRequest = { ...recordingTarget(), draft: draft(), queuedEdit: undefined };
      store.stopVoiceRecording();
    },
  };
}
