import { createEffect, createRoot, createSignal, getOwner, runWithOwner } from "solid-js";
import type { createCodexLiveConversation } from "./codex-live-conversation-store";
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
 * The voice conversation of this server. It starts from the message box and stops with End: the pill
 * at the top of the agent's chat shows it, and another chat or another page keeps it.
 * One runs at a time, because it holds the microphone.
 */
export function createVoiceSessions() {
  const owner = getOwner();
  let session: VoiceSession | undefined;
  /** The agent whose voice conversation is on, also before the conversation starts. */
  const [activeAgentId, setActiveAgentId] = createSignal<string | null>(null);

  function end(ended: VoiceSession | undefined = session): void {
    if (!ended || ended !== session) return;
    session = undefined;
    ended.dispose();
  }

  return {
    /** True while the voice conversation with this agent is on. */
    active(agentId: string): boolean {
      return activeAgentId() === agentId;
    },
    /** Turns on the voice conversation with this agent. Another one ends first. */
    start(agentId: string): void {
      if (activeAgentId() === agentId) return;
      if (session?.agentId !== agentId) end();
      setActiveAgentId(agentId);
    },
    /** Ends the voice conversation with this agent. */
    stop(agentId: string): void {
      if (activeAgentId() !== agentId) return;
      setActiveAgentId(null);
      if (session?.agentId === agentId) end();
    },
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
          const opened: VoiceSession = { agentId, kind, conversation: create(), dispose };
          // A conversation that is turned off, also one that opened after End, must not keep the microphone.
          createEffect(
            () => activeAgentId() === agentId,
            (on) => {
              if (!on) queueMicrotask(() => end(opened));
            },
          );
          return opened;
        }),
      );
      session = next;
      return next.conversation;
    },
    /** Ends the conversation of this kind. It stays on, so it starts again when its chat opens again. */
    end(kind: VoiceConversationKind): void {
      if (session?.kind === kind) end();
    },
  };
}
