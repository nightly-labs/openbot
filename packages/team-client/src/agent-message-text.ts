const COMPLETE_INTERNAL_CITATION = /\u{e200}cite(?:\u{e202}[^\u{e201}]*)?\u{e201}/gu;
const STREAMING_INTERNAL_CITATION = /\u{e200}(?:c(?:i(?:t(?:e(?:\u{e202}[^\u{e201}]*)?)?)?)?)?$/u;

/**
 * A file or page that Codex cites, such as `:codex-file-citation{path="/work/q1.xlsx" purpose="source"}`.
 * Codex apps draw it as a link, so it becomes a Markdown link here. Code keeps it as written, and a
 * quoted value can hold `}`. The start of a citation that is still streaming, at the end of the text,
 * does not show until the citation is complete.
 */
// Attributes need a space between them, so that the pattern reads each one in a single way. The
// streaming end is at most as long as a path, so a long line of citation starts is read in linear time.
const FILE_CITATION_OR_CODE =
  /(```[\s\S]*?(?:```|$)|`[^`\r\n]*`)|(?<![:\\]):codex-file-citation\{(?:(\s*(?:[A-Za-z_][\w-]*=(?:"[^"<>\r\n]*"|[^\s"<>{}]+)(?:\s+[A-Za-z_][\w-]*=(?:"[^"<>\r\n]*"|[^\s"<>{}]+))*\s*)?)\}|[^}\r\n]{0,4096}$)/gu;
const FILE_CITATION_ATTRIBUTE = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|(\S+))/gu;
const LABEL_MARKDOWN = /[\\`*_[\]<>~$&|]/gu;

export function cleanAgentMessageText(text: string): string {
  const cleaned = text.replace(COMPLETE_INTERNAL_CITATION, "").replace(STREAMING_INTERNAL_CITATION, "");
  if (!cleaned.includes(":codex-file-citation{")) return cleaned;
  return cleaned.replace(FILE_CITATION_OR_CODE, (match, code: string | undefined, attributes: string | undefined) => {
    if (code !== undefined) return match;
    return attributes === undefined ? "" : (fileCitationLink(attributes) ?? match);
  });
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
  // Markdown removes a backslash before punctuation in a link target, such as `C:\repo\.github`.
  return `[${(label || name).replace(LABEL_MARKDOWN, "\\$&")}](<${target.replaceAll("\\", "\\\\")}>)`;
}
