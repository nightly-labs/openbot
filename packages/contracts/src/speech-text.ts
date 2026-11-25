const SENTENCE_END = /[.!?…。！？]$/u;

export function speechTextFromMarkdown(markdown: string): string {
  const lines = markdown
    .replace(/```[\s\S]*?(```|$)/gu, "\n")
    .replace(/~~~[\s\S]*?(~~~|$)/gu, "\n")
    .replace(/<[^>\n]+>/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, " ")
    .split("\n");
  const sentences: string[] = [];
  for (const raw of lines) {
    if (/^\s*\|/u.test(raw)) continue;
    const line = raw
      .replace(/^\s*(?:>\s*)*(?:(?:#{1,6}|[-*+•◦▪‣⁃]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/u, "")
      .replace(/`([^`]*)`/gu, "$1")
      .replace(/(^|[\s(])@(?=[\p{L}\p{N}])/gu, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/gu, "$2")
      .replace(/(^|[^\p{L}\p{N}])[*_](\S(?:.*?\S)?)[*_](?=$|[^\p{L}\p{N}])/gu, "$1$2")
      .replace(/\s+/gu, " ")
      .trim();
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    sentences.push(SENTENCE_END.test(line) || /[:;,]$/u.test(line) ? line : `${line}.`);
  }
  return sentences.join(" ");
}
