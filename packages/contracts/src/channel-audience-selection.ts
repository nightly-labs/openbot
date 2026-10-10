import { chatTagReferences } from "./chat-tag-references";
import type { ChannelAudience } from "./ipc-chat-channels";

/** Only a contiguous leading member cluster is an audience; body and quoted tags are references. */
export function channelAudienceSelection(text: string): ChannelAudience | null {
  if (/^\s*@all(?=\s|$)/iu.test(text)) return { kind: "all" };
  const agentIds: string[] = [];
  let cursor = 0;
  for (const reference of chatTagReferences(text)) {
    if (reference.kind !== "agent" || text.slice(cursor, reference.start).trim()) break;
    if (!agentIds.includes(reference.id)) agentIds.push(reference.id);
    cursor = reference.end;
  }
  return agentIds.length ? { kind: "members", agentIds } : null;
}
