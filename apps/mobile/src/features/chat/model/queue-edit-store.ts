import type { ChatAttachment } from "../components/use-chat-attachments";
import type { QueueEditTarget } from "./queue-edit-operations";

interface ComposerState {
  draft: string;
  items: ChatAttachment[];
  preparing: boolean;
  sending: boolean;
  focusRequest: number;
  queueEdit: (QueueEditTarget & { text: string; files: ChatAttachment[] }) | null;
}

// The workspace owns this store so navigation cannot discard a message taken from the host.
export function createQueueEditStore() {
  const states = new Map<string, ComposerState>();
  const listeners = new Set<() => void>();
  function get(key: string): ComposerState {
    let state = states.get(key);
    if (!state) {
      state = { draft: "", items: [], preparing: false, sending: false, focusRequest: 0, queueEdit: null };
      states.set(key, state);
    }
    return state;
  }
  return {
    get,
    update(key: string, patch: Partial<ComposerState>) {
      states.set(key, { ...get(key), ...patch });
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type QueueEditStore = ReturnType<typeof createQueueEditStore>;
