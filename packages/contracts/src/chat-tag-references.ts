/**
 * What a tag in a message names. `mcp` is one of the host's MCP servers: a tag is a hint for the
 * model, in the same way a skill tag is, and it changes no tool the provider is given. `quote` is
 * text the user selected in a message of the same chat: its name is that text and its id is the
 * message id. A quote of a file that the side panel shows has a file quote id in place of the
 * message id (see `fileQuoteId`).
 *
 * An app that predates a kind does not match its marker, so it shows the marker text rather than
 * the name. Message bodies are stored as written, so an older app reading a newer message is a
 * real case, and it stays readable.
 */
export type ChatTagKind = "agent" | "skill" | "mcp" | "quote";

export interface ChatTagReference {
  kind: ChatTagKind;
  id: string;
  name: string;
  start: number;
  end: number;
}

const CHAT_TAG_REFERENCE_PATTERN = /@\[([^\]\r\n]+)\]\((agent|skill|mcp|quote)(\+uri)?:([^)\r\n]+)\)/gu;

/*
 * Quoted text is any text, and Markdown reads the marker as a link. A bracket, a backslash, a
 * backtick or an angle bracket in it could end the link early or open a span past its end.
 */
const UNSAFE_QUOTE_NAME = /[[\]\\`<\r\n]/u;

/**
 * Encoded, a long passage could pass the message limit. At 9 encoded characters each, this many
 * stays far below it, and the start of the passage is enough to find it again.
 */
const QUOTE_TEXT_LIMIT = 2000;

/** The quoted text that a quote tag keeps. Code points keep a surrogate pair whole. */
export function limitedQuoteText(text: string): string {
  return Array.from(text).slice(0, QUOTE_TEXT_LIMIT).join("").trimEnd();
}

/**
 * A passage of a workspace file, a shared file or an attachment. The lines start at 1 and include
 * the last. An attachment has no path on the agent's computer, so its quote names it by its id and
 * file name.
 */
export type FileQuoteTarget = (
  | { source: "workspace" | "shared"; path: string }
  | { source: "attachment"; attachmentId: string; name: string }
) & { lines?: { start: number; end: number } | undefined };

const FILE_QUOTE_ID = /^(workspace|shared|attachment)-file:(.+?)(?:#L(\d+)(?:-(\d+))?)?$/u;

/**
 * The id of a quote of a file passage, for example `workspace-file:docs/plan.md#L12-18` or
 * `attachment-file:<attachment id>/notes.md#L3`.
 */
export function fileQuoteId(target: FileQuoteTarget): string {
  const lines = target.lines;
  const suffix = !lines ? "" : lines.end > lines.start ? `#L${lines.start}-${lines.end}` : `#L${lines.start}`;
  const file = target.source === "attachment" ? `${target.attachmentId}/${target.name}` : target.path;
  return `${target.source}-file:${file}${suffix}`;
}

/** The file passage that a quote id names, or null for a quote of a message. */
export function fileQuoteTarget(id: string): FileQuoteTarget | null {
  const match = FILE_QUOTE_ID.exec(id);
  const file = match?.[2];
  if (!file) return null;
  const start = Number(match[3]);
  const lines = match[3] && start >= 1 ? { start, end: Math.max(start, Number(match[4] ?? start)) } : undefined;
  if (match[1] !== "attachment") return { source: match[1] === "shared" ? "shared" : "workspace", path: file, lines };
  const slash = file.indexOf("/");
  if (slash < 1 || slash === file.length - 1) return null;
  return { source: "attachment", attachmentId: file.slice(0, slash), name: file.slice(slash + 1), lines };
}

export function serializeChatTagReference(kind: ChatTagKind, name: string, id: string): string {
  const unsafeName = kind === "quote" ? UNSAFE_QUOTE_NAME : /[\]\r\n]/u;
  if (name && id && !unsafeName.test(name) && !/[)\r\n]/u.test(id)) return `@[${name}](${kind}:${id})`;
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

/**
 * Addresses a message to every member of a channel. It is plain text, not a tag, so a client of
 * any version can write it and an app that predates it shows the same text.
 */
export const EVERYONE_MENTION = "@everyone";

/* `@everyone` is an address only as a whole word: "@everyone's notes" names no one. */
const ADDRESS_SEPARATORS = /^(?:[\s,]|and\b|&|@everyone(?![\p{L}\p{N}_'’-]))*/iu;

/**
 * Whom a message opens by addressing, as a reader addresses several people: "@A @B, @C what do
 * you think?" or "@everyone ideas?". Spaces, commas and "and" may separate them. A tag after the
 * first other word is a reference in the text, not an address.
 */
export function leadingAddress(value: string): { mentions: ChatTagReference[]; everyone: boolean } {
  const mentions: ChatTagReference[] = [];
  let end = 0;
  let everyone = false;
  for (const reference of [...chatTagReferences(value), undefined]) {
    const gap = value.slice(end, reference?.start);
    const separators = ADDRESS_SEPARATORS.exec(gap)?.[0] ?? "";
    everyone ||= separators.toLowerCase().includes(EVERYONE_MENTION);
    if (reference?.kind !== "agent" || separators.length !== gap.length) break;
    mentions.push(reference);
    end = reference.end;
  }
  return { mentions, everyone };
}

function chatTagKind(value: string | undefined): ChatTagKind {
  if (value === "skill" || value === "mcp" || value === "quote") return value;
  return "agent";
}

/**
 * The text with each marker as words. `resolveName` gives the current name of an agent, skill or
 * MCP server. For a quote it gives the whole replacement: a one-line preview uses it to keep the
 * quote out of a block quote. `fileHeadings` names the file and lines above a file quote. Only a
 * provider prompt asks for it: the heading is English, and a person reads the other results.
 */
export function expandChatTagReferences(
  value: string,
  resolveName?: (reference: ChatTagReference) => string | undefined,
  options: { fileHeadings?: boolean } = {},
): string {
  const text = { first: value.search(/\S/u), last: value.trimEnd().length, quoteEnd: -1 };
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
      if (kind === "quote") {
        const inline = resolveName?.(reference);
        if (inline !== undefined) return inline;
        const file = options.fileHeadings ? fileQuoteTarget(id) : null;
        const expanded = expandedQuote(name, file, value, offset, offset + marker.length, text);
        text.quoteEnd = offset + marker.length;
        return expanded;
      }
      const resolvedName = resolveName?.(reference) ?? name;
      return expandedChatTag(kind, resolvedName);
    },
  );
}

/**
 * A quote is a Markdown block quote on its own lines, so the provider reads it as quoted text and
 * the words after it as the user's answer to it. A quote of a file names the file and its lines
 * first, so the agent can find the passage. `text` holds offsets in `value`, so each quote costs
 * only the length of its own marker, also in a long message with many quotes.
 */
function expandedQuote(
  quoted: string,
  file: FileQuoteTarget | null,
  value: string,
  start: number,
  end: number,
  text: { first: number; last: number; quoteEnd: number },
): string {
  const lines = quoted.split(/\r?\n/u).map((line) => (line.trim() ? `> ${line}` : ">"));
  const quote = (file ? [fileQuoteHeading(file), ...lines] : lines).join("\n");
  // A quote just before this one already ends with a blank line.
  const afterQuote = text.quoteEnd >= 0 && /^[^\S\r\n]*$/u.test(value.slice(text.quoteEnd, start));
  const separated = start <= text.first || value.startsWith("\n\n", start - 2) || afterQuote;
  const prefix = separated ? "" : value[start - 1] === "\n" ? "\n" : "\n\n";
  const suffix = end >= text.last ? "" : value.startsWith("\n\n", end) ? "" : value[end] === "\n" ? "\n" : "\n\n";
  return `${prefix}${quote}${suffix}`;
}

/* The words stay in English: they are for the model, as the selection instructions are. */
function fileQuoteHeading(file: FileQuoteTarget): string {
  const name = file.source === "attachment" ? file.name : file.path;
  const quotedName = name.includes("`") ? name : `\`${name}\``;
  // A shared path starts at the shared folder that the agent's instructions name.
  const kind = file.source === "attachment" ? "the attached file " : file.source === "shared" ? "the shared file " : "";
  const from = `From ${kind}${quotedName}`;
  const lines = file.lines;
  if (!lines) return `${from}:`;
  return lines.end > lines.start ? `${from}, lines ${lines.start}-${lines.end}:` : `${from}, line ${lines.start}:`;
}

/** What the provider reads in place of a marker. A name alone would not say what it names. */
function expandedChatTag(kind: Exclude<ChatTagKind, "quote">, name: string): string {
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
