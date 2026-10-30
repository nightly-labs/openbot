import { isBoolean, isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

/**
 * `expectsReply` rides beside the frozen conversation projection, in the way `editing` rides beside
 * the queue: the shipped key lists drop it, so a client on protocol 1-3 reads every exchange as a
 * request, and only the current protocol learns that the sender asked for no answer.
 *
 * A present mark must be a boolean. The projection removes the key, so an unchecked value would
 * reach the client as an exchange that needs no answer, and hide that a teammate is waiting for a
 * result. Fail closed instead; an absent mark still means an older host, and a request.
 */
export function withExchangeExpectsReply(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const marks = new Map<string, boolean>();
  for (const message of [
    ...(Array.isArray(source.messages) ? source.messages : []),
    // A page names the messages its replies point at separately, and a reply to an exchange is
    // exactly where the mark is read.
    ...(isDynamicRecord(source.references) ? Object.values(source.references) : []),
  ]) {
    if (!isDynamicRecord(message) || !isDynamicRecord(message.exchange)) continue;
    const mark = message.exchange.expectsReply;
    if (mark === undefined) continue;
    if (!isBoolean(mark)) throw new Error("Invalid exchange reply mark.");
    if (isString(message.id)) marks.set(message.id, mark);
  }
  if (marks.size === 0) return projected;
  const withMark = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id) || !isDynamicRecord(message.exchange)) return message;
    const value = marks.get(message.id);
    return value === undefined ? message : { ...message, exchange: { ...message.exchange, expectsReply: value } };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withMark);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withMark(value)]),
    );
  }
  return result;
}
