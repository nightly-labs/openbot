import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export interface VoiceCallRequest {
  clientId: string;
  deliveryId: string | null;
  turnId: string | null;
}
export interface VoiceCallRecord {
  id: string;
  target: string;
  requests: VoiceCallRequest[];
}
export interface CallHistoryStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
const MAX_CALLS = 80;
const MAX_REQUESTS = 100;
const MAX_STORED_LENGTH = 64_000;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const nullableId = (value: unknown): value is string | null => value === null || id(value);

function decode(text: string | null, owner: string): VoiceCallRecord[] {
  if (!text || text.length > MAX_STORED_LENGTH) return [];
  try {
    const value = JSON.parse(text);
    if (!isDynamicRecord(value) || value.version !== 1 || value.owner !== owner || !Array.isArray(value.calls))
      return [];
    return value.calls.slice(-MAX_CALLS).flatMap((call): VoiceCallRecord[] => {
      if (
        !isDynamicRecord(call) ||
        !id(call.id) ||
        typeof call.target !== "string" ||
        call.target.length > 1024 ||
        !Array.isArray(call.requests)
      )
        return [];
      const requests = call.requests
        .slice(0, MAX_REQUESTS)
        .flatMap((request): VoiceCallRequest[] =>
          isDynamicRecord(request) &&
          id(request.clientId) &&
          nullableId(request.deliveryId) &&
          nullableId(request.turnId)
            ? [{ clientId: request.clientId, deliveryId: request.deliveryId, turnId: request.turnId }]
            : [],
        );
      return [{ id: call.id, target: call.target, requests }];
    });
  } catch {
    return [];
  }
}

/** Local presentation metadata only. The host still owns the conversation and call context. */
export function createVoiceCallHistory(storage: CallHistoryStorage) {
  let owner: string | null = null;
  let epoch = 0;
  let loaded = false;
  let calls: VoiceCallRecord[] = [];
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  function persist(): void {
    const capturedOwner = owner;
    if (!capturedOwner || !loaded) return;
    let retained = calls.slice(-MAX_CALLS);
    let value = JSON.stringify({ version: 1, owner: capturedOwner, calls: retained });
    while (value.length > MAX_STORED_LENGTH && retained.length) {
      retained = retained.slice(1);
      value = JSON.stringify({ version: 1, owner: capturedOwner, calls: retained });
    }
    writes = writes
      .catch(() => {})
      .then(async () => {
        if (owner === capturedOwner) await storage.write(value);
      })
      .catch(() => {});
  }
  return {
    snapshot: () => calls,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async selectOwner(next: string | null): Promise<void> {
      if (next !== null && next === owner) return;
      owner = next;
      loaded = false;
      const own = ++epoch;
      calls = [];
      publish();
      if (!next) {
        writes = writes
          .catch(() => {})
          .then(() => storage.remove())
          .catch(() => {});
        await writes;
        return;
      }
      await writes;
      const text = await storage.read().catch(() => null);
      if (own !== epoch) return;
      const saved = decode(text, next);
      const currentIds = new Set(calls.map((call) => call.id));
      calls = [...saved.filter((call) => !currentIds.has(call.id)), ...calls].slice(-MAX_CALLS);
      loaded = true;
      publish();
      persist();
    },
    begin(target: string, callId: string): void {
      if (!owner || calls.some((call) => call.id === callId)) return;
      calls = [...calls, { id: callId, target, requests: [] }].slice(-MAX_CALLS);
      publish();
      persist();
    },
    bind(callId: string, clientId: string): void {
      calls = calls.map((call) =>
        call.id === callId && call.requests.length < MAX_REQUESTS && !call.requests.some((r) => r.clientId === clientId)
          ? { ...call, requests: [...call.requests, { clientId, deliveryId: null, turnId: null }] }
          : call,
      );
      publish();
      persist();
    },
    resolve(
      target: string,
      outbox: readonly { clientMessageId: string; messageId: string | null }[],
      messages: readonly ConversationMessage[],
      deliveries: readonly { id: string; turnId: string | null }[],
    ): void {
      let changed = false;
      const next = calls.map((call) =>
        call.target !== target
          ? call
          : {
              ...call,
              requests: call.requests.map((request) => {
                const deliveryId =
                  outbox.find((m) => m.clientMessageId === request.clientId)?.messageId ?? request.deliveryId;
                const turnId =
                  messages.find((m) => m.id === deliveryId)?.turnId ??
                  deliveries.find((d) => d.id === deliveryId)?.turnId ??
                  request.turnId;
                if (deliveryId === request.deliveryId && turnId === request.turnId) return request;
                changed = true;
                return { ...request, deliveryId, turnId };
              }),
            },
      );
      if (changed) {
        calls = next;
        publish();
        persist();
      }
    },
    settled: () => writes,
  };
}

/** Only the call's own requests and exclusively correlated agent replies can collapse. */
export function voiceCallMessageIds(call: VoiceCallRecord, messages: readonly ConversationMessage[]): Set<string> {
  const ids = new Set(
    call.requests.flatMap((request) => [
      `outbox:${request.clientId}`,
      ...(request.deliveryId ? [request.deliveryId] : []),
    ]),
  );
  const turns = new Set(call.requests.flatMap((request) => (request.turnId ? [request.turnId] : [])));
  for (const turn of turns) {
    const users = messages.filter((message) => message.turnId === turn && message.author === "user");
    if (!users.length || users.some((user) => !ids.has(user.id))) continue;
    for (const message of messages) if (message.turnId === turn && message.author === "assistant") ids.add(message.id);
  }
  return ids;
}
