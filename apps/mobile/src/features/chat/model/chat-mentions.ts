import { chatTagReferences, serializeChatTagReference } from "@openbot/contracts/chat-tag-references";

export function mentionDraft(source: string) {
  let cursor = 0;
  let text = "";
  const mentions = [];
  for (const reference of chatTagReferences(source)) {
    if (
      reference.kind !== "agent" &&
      reference.kind !== "quote" &&
      reference.kind !== "skill" &&
      reference.kind !== "mcp"
    )
      continue;
    text += source.slice(cursor, reference.start);
    const start = text.length;
    // A quote keeps its marker through an edit, as a mention does. The phone cannot jump to its source.
    // A skill or an app reads as its name after @, as the desktop chip does; its marker goes to the host.
    text += reference.kind === "quote" ? `“${reference.name}”` : `@${reference.name}`;
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
  const query = match?.[1];
  if (query === undefined) return null;
  const start = cursor - query.length - 1;
  if (draft.mentions.some((mention) => start >= mention.start && start < mention.end)) return null;
  return { start, end: cursor, query: query.toLocaleLowerCase() };
}

/** Writes an agent mention, or a skill or app reference as the desktop chip sends it, over the typed `@query`. */
export function insertMention(
  source: string,
  range: { start: number; end: number },
  agent: { id: string; name: string },
  kind: "agent" | "skill" | "mcp" = "agent",
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
  return `${before}${serializeChatTagReference(kind, agent.name, agent.id)} ${after}`;
}

interface MentionMatcher {
  expression: RegExp;
  /** The place in the agent list of each lower-case name. */
  indexByName: ReadonlyMap<string, number>;
}

/** One matcher for each agent list: the text of every message token reads the same list. */
const mentionMatchers = new WeakMap<readonly { name: string }[], MentionMatcher | null>();

function mentionMatcher(agents: readonly { name: string }[]): MentionMatcher | null {
  const cached = mentionMatchers.get(agents);
  if (cached !== undefined) return cached;
  // The longest name first, so a name that starts another name does not take its match.
  const ordered = agents
    .map((agent, index) => ({ name: agent.name, index }))
    .filter((agent) => agent.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  let matcher: MentionMatcher | null = null;
  if (ordered.length) {
    const indexByName = new Map(ordered.map((agent) => [agent.name.toLocaleLowerCase(), agent.index]));
    const names = ordered.map((agent) => agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    matcher = { expression: new RegExp(`@(${names})(?=$|[\\s.,!?;:()\\[\\]{}])`, "giu"), indexByName };
  }
  mentionMatchers.set(agents, matcher);
  return matcher;
}

/** Display-only matching for prose from providers and older messages. Never changes stored text. */
export function plainMentionParts<T extends { id: string; name: string }>(body: string, agents: readonly T[]) {
  const matcher = mentionMatcher(agents);
  const parts: Array<{ text: string; agent: T | undefined }> = [];
  if (!matcher) return [{ text: body, agent: undefined }];
  let cursor = 0;
  // `matchAll` reads a copy of the expression, so the shared expression keeps no state.
  for (const match of body.matchAll(matcher.expression)) {
    if (match.index > 0 && /[\p{L}\p{N}_@]/u.test(body.charAt(match.index - 1))) continue;
    if (match.index > cursor) parts.push({ text: body.slice(cursor, match.index), agent: undefined });
    const index = matcher.indexByName.get((match[1] ?? "").toLocaleLowerCase());
    parts.push({ text: match[0], agent: index === undefined ? undefined : agents[index] });
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), agent: undefined });
  return parts;
}
