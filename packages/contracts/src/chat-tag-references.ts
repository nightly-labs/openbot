/**
 * What a tag in a message names. `mcp` is one of the host's MCP servers: a tag is a hint for the
 * model, in the same way a skill tag is, and it changes no tool the provider is given.
 *
 * An app that predates a kind does not match its marker, so it shows the marker text rather than
 * the name. Message bodies are stored as written, so an older app reading a newer message is a
 * real case, and it stays readable.
 */
export type ChatTagKind = "agent" | "skill" | "mcp";

export interface ChatTagReference {
  kind: ChatTagKind;
  id: string;
  name: string;
  start: number;
  end: number;
}

const CHAT_TAG_REFERENCE_PATTERN = /@\[([^\]\r\n]+)\]\((agent|skill|mcp)(\+uri)?:([^)\r\n]+)\)/gu;

export function serializeChatTagReference(kind: ChatTagKind, name: string, id: string): string {
  if (name && id && !/[\]\r\n]/u.test(name) && !/[)\r\n]/u.test(id)) return `@[${name}](${kind}:${id})`;
  return `@[${encodeChatTagComponent(name)}](${kind}+uri:${encodeChatTagComponent(id)})`;
}

export function chatTagReferences(value: string): ChatTagReference[] {
  return [...value.matchAll(CHAT_TAG_REFERENCE_PATTERN)].map((match) => ({
    kind: chatTagKind(match[2]),
    id: decodeChatTagComponent(match[4] ?? "", match[3] !== undefined),
    name: decodeChatTagComponent(match[1] ?? "", match[3] !== undefined),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function chatTagKind(value: string | undefined): ChatTagKind {
  if (value === "skill") return "skill";
  return value === "mcp" ? "mcp" : "agent";
}

export function expandChatTagReferences(
  value: string,
  resolveName?: (reference: ChatTagReference) => string | undefined,
): string {
  return value.replace(
    CHAT_TAG_REFERENCE_PATTERN,
    (
      marker,
      encodedName: string,
      kind: ChatTagKind,
      encoding: string | undefined,
      encodedId: string,
      offset: number,
    ) => {
      const name = decodeChatTagComponent(encodedName, encoding !== undefined);
      const id = decodeChatTagComponent(encodedId, encoding !== undefined);
      const reference = { kind, id, name, start: offset, end: offset + marker.length };
      const resolvedName = resolveName?.(reference) ?? name;
      return expandedChatTag(kind, resolvedName);
    },
  );
}

/** What the provider reads in place of a marker. A name alone would not say what it names. */
function expandedChatTag(kind: ChatTagKind, name: string): string {
  if (kind === "agent") return `@${name}`;
  return kind === "mcp" ? `${name} (MCP server)` : `${name} (skill)`;
}

function encodeChatTagComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function decodeChatTagComponent(value: string, encoded: boolean): string {
  if (!encoded) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
