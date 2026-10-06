// Fails when a Markdown link names a Markdown file in this repository that does not exist, or a
// `#anchor` that the file does not have. It reads every tracked `*.md` file, and checks relative
// links and same-file `#anchor` links. It does not check web links or links to other file types.
//
//   bun scripts/check-doc-links.ts

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const ROOT = resolve(import.meta.dirname, "..");
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const HTML_ANCHOR = /<a\s[^>]*(?:id|name)="([^"]+)"/g;

const logger = createOpenBotLogger("check-doc-links");

/** The anchor GitHub gives a heading: lower case, no punctuation, a hyphen for each space. */
function headingAnchor(heading: string): string {
  return heading
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replaceAll(" ", "-");
}

/** Lines outside fenced code blocks, with inline code removed. */
function proseLines(text: string): string[] {
  let fence: string | undefined;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (fence === undefined || marker.startsWith(fence))) {
      fence = fence === undefined ? marker : undefined;
      lines.push("");
      continue;
    }
    lines.push(fence === undefined ? line.replace(/(`+)[^`]*?\1/g, "") : "");
  }
  return lines;
}

const anchorCache = new Map<string, Set<string>>();
function anchors(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const found = new Set<string>();
  const seen = new Map<string, number>();
  const text = readFileSync(path, "utf8");
  for (const line of proseLines(text)) {
    const heading = HEADING.exec(line)?.[1];
    if (heading !== undefined) {
      const anchor = headingAnchor(heading);
      const count = seen.get(anchor) ?? 0;
      found.add(count === 0 ? anchor : `${anchor}-${count}`);
      seen.set(anchor, count + 1);
    }
  }
  for (const [, id] of text.matchAll(HTML_ANCHOR)) if (id) found.add(id);
  anchorCache.set(path, found);
  return found;
}

const files = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((file) => file !== "" && existsSync(join(ROOT, file)));
const failures: string[] = [];

for (const file of files) {
  const path = join(ROOT, file);
  proseLines(readFileSync(path, "utf8")).forEach((line, index) => {
    for (const [, target] of line.matchAll(LINK)) {
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/")) continue;
      const [linkPath = "", anchor] = target.split("#", 2);
      const targetPath = linkPath === "" ? path : normalize(join(dirname(path), decodeURIComponent(linkPath)));
      if (!targetPath.endsWith(".md")) continue;
      const where = `${file}:${index + 1}`;
      if (!existsSync(targetPath)) {
        failures.push(`${where}: ${target} names ${relative(ROOT, targetPath)}, which does not exist.`);
      } else if (anchor && !anchors(targetPath).has(decodeURIComponent(anchor).toLowerCase())) {
        failures.push(`${where}: ${target} names #${anchor}, which ${relative(ROOT, targetPath)} does not have.`);
      }
    }
  });
}

if (failures.length > 0) {
  logger.error(["Markdown links are broken:", ...failures.map((line) => `  ${line}`)].join("\n"));
  process.exitCode = 1;
} else {
  logger.info(`Checked the links in ${files.length} Markdown files.`);
}
