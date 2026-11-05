import { createEffect, createRoot, getOwner, runWithOwner, type Store } from "solid-js";
import type { createCodexLiveConversation } from "./codex-live-conversation-store";
import type { SidePanelsState } from "./panels-store";
import type { createVoiceConversation } from "./voice-conversation-store";

export type VoiceConversationKind = "transcribed" | "codex-live";
type VoiceConversation = ReturnType<typeof createCodexLiveConversation> | ReturnType<typeof createVoiceConversation>;

interface VoiceSession {
  readonly agentId: string;
  readonly kind: VoiceConversationKind;
  readonly conversation: VoiceConversation;
  readonly dispose: () => void;
}

/**
 * The voice conversation of this server. It lives as long as the Voice tab of its agent, not as long
 * as the pane on screen: another tab, a closed side panel, another chat or another page keeps it.
 * One runs at a time, because it holds the microphone.
 */
export function createVoiceSessions(sidePanels: Store<SidePanelsState>) {
  const owner = getOwner();
  let session: VoiceSession | undefined;

  function end(ended: VoiceSession | undefined = session): void {
    if (!ended || ended !== session) return;
    session = undefined;
    ended.dispose();
  }

  return {
    /** The kind of the conversation that runs with this agent, or null. */
    running(agentId: string): VoiceConversationKind | null {
      return session?.agentId === agentId ? session.kind : null;
    },
    /** The conversation with this agent. Another one ends first. */
    open(agentId: string, kind: VoiceConversationKind, create: () => VoiceConversation): VoiceConversation {
      if (session?.agentId === agentId && session.kind === kind) return session.conversation;
      end();
      const next = runWithOwner(owner, () =>
        createRoot((dispose): VoiceSession => {
          const conversation = create();
          const opened: VoiceSession = { agentId, kind, conversation, dispose };
          createEffect(
            () => sidePanels.side[agentId]?.panes.includes("voice") ?? false,
            (tab) => {
              // The root cannot end in its own effect.
              if (!tab) queueMicrotask(() => end(opened));
            },
          );
          return opened;
        }),
      );
      session = next;
      return next.conversation;
    },
    /** Ends the conversation of this kind. */
    end(kind: VoiceConversationKind): void {
      if (session?.kind === kind) end();
    },
  };
}
