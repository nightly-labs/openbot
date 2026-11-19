import { onCleanup } from "solid-js";
import { ConversationView } from "./ConversationView";
import { useConversationController } from "./conversation-controller-context";
import type { ConversationProps } from "./conversation-types";

export { createConversationController } from "./conversation-controller";

export function Conversation(props: ConversationProps) {
  const controller = useConversationController();
  const { resources } = controller;

  onCleanup(() => {
    controller.stopComposerTyping();
    controller.setComposerFocusRequest(0);
    const phase = controller.voicePhase();
    if (phase === "preparing" || phase === "requesting") {
      controller.setVoicePhase("idle");
      controller.setVoiceModelProgress(null);
    }
    if (resources.voiceRecordingTimer) clearTimeout(resources.voiceRecordingTimer);
    if (resources.voiceElapsedTimer) clearInterval(resources.voiceElapsedTimer);
    if (resources.voiceRecorder?.state === "recording") {
      controller.setVoicePhase("transcribing");
      resources.voiceRecorder.stop();
    }
    for (const track of resources.voiceStream?.getTracks() ?? []) track.stop();
    resources.voiceMeterStop?.();
  });

  return <ConversationView {...props} />;
}
