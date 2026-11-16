const COMPLETE_INTERNAL_CITATION = /\u{e200}cite(?:\u{e202}[^\u{e201}]*)?\u{e201}/gu;
const STREAMING_INTERNAL_CITATION = /\u{e200}(?:c(?:i(?:t(?:e(?:\u{e202}[^\u{e201}]*)?)?)?)?)?$/u;

/**
 * A file or page that Codex cites, such as `:codex-file-citation{path="/work/q1.xlsx" purpose="source"}`.
 * Codex apps draw it as a link, so it becomes a Markdown link here. Code keeps it as written, and a
 * quoted value can hold `}`.
 */
const FILE_CITATION_OR_CODE =
  /(```[\s\S]*?(?:```|$)|`[^`\r\n]*`)|(?<![:\\]):codex-file-citation\{((?:\s*[A-Za-z_][\w-]*=(?:"[^"<>\r\n]*"|[^\s"<>{}]+))*\s*)\}/gu;
const FILE_CITATION_ATTRIBUTE = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|(\S+))/gu;
/** The start of a citation that is still streaming. It shows as a link when it is complete. */
const STREAMING_FILE_CITATION = /(?<![:\\]):codex-file-citation\{[^}\r\n]*$/u;
const LABEL_MARKDOWN = /[\\`*_[\]<>~$&|]/gu;

export function cleanAgentMessageText(text: string): string {
  const cleaned = text.replace(COMPLETE_INTERNAL_CITATION, "").replace(STREAMING_INTERNAL_CITATION, "");
  if (!cleaned.includes(":codex-file-citation{")) return cleaned;
  return cleaned
    .replace(FILE_CITATION_OR_CODE, (match, code: string | undefined, attributes: string | undefined) =>
      code === undefined && attributes !== undefined ? (fileCitationLink(attributes) ?? match) : match,
    )
    .replace(STREAMING_FILE_CITATION, "");
}

function fileCitationLink(attributes: string): string | null {
  const values = new Map<string, string>();
  for (const [, name = "", quoted, bare] of attributes.matchAll(FILE_CITATION_ATTRIBUTE)) {
    values.set(name, quoted ?? bare ?? "");
  }
  const path = values.get("path")?.trim();
  if (!path) return null;
  const label = values.get("label")?.trim();
  if (/^https?:\/\/\S+$/iu.test(path)) {
    return label ? `[${label.replace(LABEL_MARKDOWN, "\\$&")}](<${path}>)` : `<${path}>`;
  }
  const name =
    path
      .replace(/[\\/]+$/u, "")
      .split(/[\\/]/u)
      .pop() || path;
  // The workspace file opener decodes a link target once. The shared file opener reads it as written.
  const target = /(?:^|\/)OpenBot\/Shared\//u.test(path.replaceAll("\\", "/")) ? path : path.replaceAll("%", "%25");
  return `[${(label || name).replace(LABEL_MARKDOWN, "\\$&")}](<${target}>)`;
}
