export type ChatTagKind = "agent" | "skill" | "mcp" | "quote" | "tab" | "thread";

export interface ChatTagReference {
  kind: ChatTagKind;
  id: string;
  name: string;
  start: number;
  end: number;
}

const CHAT_TAG_REFERENCE_PATTERN = /@\[([^\]\r\n]+)\]\((agent|skill|mcp|quote|tab|thread)(\+uri)?:([^)\r\n]+)\)/gu;

const UNSAFE_QUOTE_NAME = /[[\]\\`<\r\n]/u;

const QUOTE_TEXT_LIMIT = 2000;

export function limitedQuoteText(text: string): string {
  return Array.from(text).slice(0, QUOTE_TEXT_LIMIT).join("").trimEnd();
}

export type FileQuoteTarget = (
  | { source: "workspace" | "shared"; path: string }
  | { source: "attachment"; attachmentId: string; name: string }
) & { lines?: { start: number; end: number } | undefined };

const FILE_QUOTE_ID = /^(workspace|shared|attachment)-file:(.+?)(?:#L(\d+)(?:-(\d+))?)?$/u;

export function fileQuoteId(target: FileQuoteTarget): string {
  const lines = target.lines;
  const suffix = !lines ? "" : lines.end > lines.start ? `#L${lines.start}-${lines.end}` : `#L${lines.start}`;
  const file = target.source === "attachment" ? `${target.attachmentId}/${target.name}` : target.path;
  return `${target.source}-file:${file}${suffix}`;
}

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

const REFERENCE_NAME_LIMIT = 80;

export function referenceName(name: string): string {
  const characters = Array.from(name.replace(/\s+/gu, " ").trim());
  return characters.length > REFERENCE_NAME_LIMIT
    ? `${characters
        .slice(0, REFERENCE_NAME_LIMIT - 1)
        .join("")
        .trimEnd()}…`
    : characters.join("");
}

export function serializeChatTagReference(kind: ChatTagKind, name: string, id: string): string {
  const unsafeName = kind === "quote" || kind === "tab" || kind === "thread" ? UNSAFE_QUOTE_NAME : /[\]\r\n]/u;
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

export const EVERYONE_MENTION = "@everyone";

const ADDRESS_SEPARATORS = /^(?:[\s,]|and\b|&|@everyone(?![\p{L}\p{N}_'’-]))*/iu;

export function leadingAddress(value: string): { mentions: ChatTagReference[]; everyone: boolean; end: number } {
  const mentions: ChatTagReference[] = [];
  let end = 0;
  let everyone = false;
  for (const reference of [...chatTagReferences(value), undefined]) {
    const gap = value.slice(end, reference?.start);
    const separators = ADDRESS_SEPARATORS.exec(gap)?.[0] ?? "";
    everyone ||= separators.toLowerCase().includes(EVERYONE_MENTION);
    if ((reference?.kind !== "agent" && reference?.kind !== "quote") || separators.length !== gap.length) break;
    if (reference.kind === "agent") mentions.push(reference);
    end = reference.end;
  }
  return { mentions, everyone, end };
}

function chatTagKind(value: string | undefined): ChatTagKind {
  if (value === "skill" || value === "mcp" || value === "quote" || value === "tab" || value === "thread") return value;
  return "agent";
}

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
      if (kind === "tab" || kind === "thread") return resolveName?.(reference) ?? name;
      const resolvedName = resolveName?.(reference) ?? name;
      return expandedChatTag(kind, resolvedName);
    },
  );
}

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
  const afterQuote = text.quoteEnd >= 0 && /^[^\S\r\n]*$/u.test(value.slice(text.quoteEnd, start));
  const separated = start <= text.first || value.startsWith("\n\n", start - 2) || afterQuote;
  const prefix = separated ? "" : value[start - 1] === "\n" ? "\n" : "\n\n";
  const suffix = end >= text.last ? "" : value.startsWith("\n\n", end) ? "" : value[end] === "\n" ? "\n" : "\n\n";
  return `${prefix}${quote}${suffix}`;
}

function fileQuoteHeading(file: FileQuoteTarget): string {
  const name = file.source === "attachment" ? file.name : file.path;
  const quotedName = name.includes("`") ? name : `\`${name}\``;
  const kind = file.source === "attachment" ? "the attached file " : file.source === "shared" ? "the shared file " : "";
  const from = `From ${kind}${quotedName}`;
  const lines = file.lines;
  if (!lines) return `${from}:`;
  return lines.end > lines.start ? `${from}, lines ${lines.start}-${lines.end}:` : `${from}, line ${lines.start}:`;
}

function expandedChatTag(kind: "agent" | "skill" | "mcp", name: string): string {
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
