import type { RealtimeVoiceCall, RealtimeVoicePoll, RealtimeVoiceReply } from "@openbot/contracts/ipc";

export interface SubscriptionVoicePort {
  poll(input: RealtimeVoiceCall): Promise<RealtimeVoicePoll>;
  reply(input: RealtimeVoiceReply): Promise<void>;
  end(input: RealtimeVoiceCall): Promise<void>;
}

/** The host owns OAuth and delegation. Clients relay each request through their normal chat path. */
export function createSubscriptionVoiceSession(options: {
  call: RealtimeVoiceCall;
  port: SubscriptionVoicePort;
  onDelegation(id: string, request: string): boolean | undefined;
  onError(): void;
}) {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  function close(): void {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    void options.port.end(options.call).catch(() => undefined);
  }
  async function poll(): Promise<void> {
    if (closed) return;
    try {
      const state = await options.port.poll(options.call);
      if (closed) return;
      if (!state.active) throw new Error("Voice session ended.");
      const item = state.delegation;
      if (item && !seen.has(item.id)) {
        if (seen.size >= 300) throw new Error("Voice session limit reached.");
        if (options.onDelegation(item.id, item.request) !== false) seen.add(item.id);
      }
      timer = setTimeout(() => {
        void poll();
      }, 500);
    } catch {
      if (closed) return;
      close();
      options.onError();
    }
  }
  return {
    start: () => {
      void poll();
    },
    close,
    async respond(delegationId: string, text: string | null): Promise<void> {
      if (closed) return;
      try {
        await options.port.reply({ ...options.call, delegationId, text });
      } catch {
        if (closed) return;
        close();
        options.onError();
      }
    },
  };
}

export type SubscriptionVoiceSession = ReturnType<typeof createSubscriptionVoiceSession>;
