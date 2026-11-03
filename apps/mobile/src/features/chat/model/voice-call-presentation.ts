import type { ConversationMessage } from "@openbot/contracts/ipc";
import type { ChatMessage } from "./chat-messages";
import { type VoiceCallRecord, voiceCallMessageIds } from "./voice-call-history";

export function presentVoiceCalls(
  messages: readonly ChatMessage[],
  calls: readonly VoiceCallRecord[],
  conversation: readonly ConversationMessage[],
  aliases: ReadonlyMap<string, string>,
  expanded: ReadonlySet<string>,
  focusId: string | null,
  failedRows: ReadonlySet<string> = new Set(),
): ChatMessage[] {
  const owners = new Map<string, VoiceCallRecord>();
  const focused = new Set<string>();
  for (const call of calls)
    for (const id of voiceCallMessageIds(call, conversation)) {
      const visibleId = aliases.get(id) ?? id;
      owners.set(visibleId, call);
      if (focusId === id || focusId === visibleId) focused.add(call.id);
    }
  const shown = new Set<string>();
  return messages.flatMap((message): ChatMessage[] => {
    const call = owners.get(message.id);
    // Questions, approvals, failures and unrelated messages keep their ordinary presentation.
    if (
      failedRows.has(message.id) ||
      !call ||
      message.kind !== "message" ||
      message.status === "failed" ||
      message.failureReason
    )
      return [message];
    const open = expanded.has(call.id) || focused.has(call.id);
    const marker: ChatMessage[] = shown.has(call.id)
      ? []
      : [{ id: `voice-call:${call.id}`, kind: "voice-call", callId: call.id, expanded: open }];
    shown.add(call.id);
    return open ? [...marker, message] : marker;
  });
}
