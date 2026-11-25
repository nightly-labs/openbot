import { isConversationMessageSender } from "../ipc-conversation-messages";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV5BaseJsonObject, TeamProtocolV5BaseJsonValue } from "./v5-base";

export function withConversationSenders(
  projected: TeamProtocolV5BaseJsonValue,
  source: unknown,
): TeamProtocolV5BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const senders = new Map<string, TeamProtocolV5BaseJsonObject>();
  for (const message of [
    ...(Array.isArray(source.messages) ? source.messages : []),
    ...(isDynamicRecord(source.references) ? Object.values(source.references) : []),
  ]) {
    if (!isDynamicRecord(message) || message.senderMember === undefined) continue;
    if (!isConversationMessageSender(message.senderMember)) throw new Error("Invalid conversation sender.");
    if (isString(message.id)) senders.set(message.id, { id: message.senderMember.id, name: message.senderMember.name });
  }
  if (senders.size === 0) return projected;
  const withSender = (message: TeamProtocolV5BaseJsonValue): TeamProtocolV5BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const senderMember = senders.get(message.id);
    return senderMember === undefined ? message : { ...message, senderMember };
  };
  const result: TeamProtocolV5BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withSender);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withSender(value)]),
    );
  }
  return result;
}
