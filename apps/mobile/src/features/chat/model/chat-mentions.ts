import { chatTagReferences, serializeChatTagReference } from "@openbot/contracts/chat-tag-references";

export function mentionDraft(source: string) {
  let cursor = 0;
  let text = "";
  const mentions = [];
  for (const reference of chatTagReferences(source)) {
    if (reference.kind !== "agent") continue;
    text += source.slice(cursor, reference.start);
    const start = text.length;
    text += `@${reference.name}`;
    mentions.push({ start, end: text.length, reference, wire: source.slice(reference.start, reference.end) });
    cursor = reference.end;
  }
  return { text: text + source.slice(cursor), mentions };
}

// Preserve identities outside the edit. Editing a mention itself turns it into plain text.
export function editMentionDraft(source: string, next: string): string {
  const previous = mentionDraft(source);
  let start = 0;
  while (start < previous.text.length && start < next.length && previous.text[start] === next[start]) start++;
  let end = previous.text.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && previous.text[end - 1] === next[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  let result = next;
  for (const mention of [...previous.mentions].reverse()) {
    if (mention.end <= start || mention.start >= end) {
      const shift = mention.start >= end ? nextEnd - end : 0;
      result = result.slice(0, mention.start + shift) + mention.wire + result.slice(mention.end + shift);
    }
  }
  return result;
}

export function mentionQuery(source: string, cursor: number) {
  if (cursor < 0) return null;
  const draft = mentionDraft(source);
  const match = /(?:^|\s)@([^@\n]*)$/u.exec(draft.text.slice(0, cursor));
  if (!match) return null;
  const start = cursor - match[1].length - 1;
  if (draft.mentions.some((mention) => start >= mention.start && start < mention.end)) return null;
  return { start, end: cursor, query: match[1].toLocaleLowerCase() };
}

export function insertMention(
  source: string,
  range: { start: number; end: number },
  agent: { id: string; name: string },
) {
  const wireOffset = (position: number) => {
    let offset = position;
    for (const mention of mentionDraft(source).mentions) {
      if (mention.end <= position) offset += mention.wire.length - (mention.end - mention.start);
    }
    return offset;
  };
  const before = source.slice(0, wireOffset(range.start));
  const after = source.slice(wireOffset(range.end));
  return `${before}${serializeChatTagReference("agent", agent.name, agent.id)} ${after}`;
}

/** Display-only matching for prose from providers and older messages. Never changes stored text. */
export function plainMentionParts<T extends { id: string; name: string }>(body: string, agents: readonly T[]) {
  const ordered = agents.filter((agent) => agent.name.length > 0).sort((a, b) => b.name.length - a.name.length);
  const parts: Array<{ text: string; agent: T | undefined }> = [];
  if (!ordered.length) return [{ text: body, agent: undefined }];
  const byName = new Map(ordered.map((agent) => [agent.name.toLocaleLowerCase(), agent]));
  const names = ordered.map((agent) => agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const expression = new RegExp(`@(${names})(?=$|[\\s.,!?;:()\\[\\]{}])`, "giu");
  let cursor = 0;
  for (const match of body.matchAll(expression)) {
    if (match.index > 0 && /[\p{L}\p{N}_@]/u.test(body[match.index - 1])) continue;
    if (match.index > cursor) parts.push({ text: body.slice(cursor, match.index), agent: undefined });
    parts.push({ text: match[0], agent: byName.get(match[1].toLocaleLowerCase()) });
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), agent: undefined });
  return parts;
}
