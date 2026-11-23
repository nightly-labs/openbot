const COMPLETE_INTERNAL_CITATION = /\u{e200}cite(?:\u{e202}[^\u{e201}]*)?\u{e201}/gu;
const STREAMING_INTERNAL_CITATION = /\u{e200}(?:c(?:i(?:t(?:e(?:\u{e202}[^\u{e201}]*)?)?)?)?)?$/u;

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
  const target = /(?:^|\/)OpenBot\/Shared\//u.test(path.replaceAll("\\", "/")) ? path : path.replaceAll("%", "%25");
  return `[${(label || name).replace(LABEL_MARKDOWN, "\\$&")}](<${target.replaceAll("\\", "\\\\")}>)`;
}
