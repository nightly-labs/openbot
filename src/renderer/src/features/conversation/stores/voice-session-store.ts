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

export function createVoiceSessions() {
  const owner = getOwner();
  let session: VoiceSession | undefined;
  const [activeAgentId, setActiveAgentId] = createSignal<string | null>(null);

  function end(ended: VoiceSession | undefined = session): void {
    if (!ended || ended !== session) return;
    session = undefined;
    ended.dispose();
  }

  return {
    active(agentId: string): boolean {
      return activeAgentId() === agentId;
    },
    start(agentId: string): void {
      if (activeAgentId() === agentId) return;
      if (session?.agentId !== agentId) end();
      setActiveAgentId(agentId);
    },
    stop(agentId: string): void {
      if (activeAgentId() !== agentId) return;
      setActiveAgentId(null);
      if (session?.agentId === agentId) end();
    },
    running(agentId: string): VoiceConversationKind | null {
      return session?.agentId === agentId ? session.kind : null;
    },
    open(agentId: string, kind: VoiceConversationKind, create: () => VoiceConversation): VoiceConversation {
      if (session?.agentId === agentId && session.kind === kind) return session.conversation;
      end();
      const next = runWithOwner(owner, () =>
        createRoot((dispose): VoiceSession => {
          const opened: VoiceSession = { agentId, kind, conversation: create(), dispose };
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
    end(kind: VoiceConversationKind): void {
      if (session?.kind === kind) end();
    },
  };
}
