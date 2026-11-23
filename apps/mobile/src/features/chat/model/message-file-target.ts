import { fileReferenceName, isFileReference } from "@openbot/brand/file-reference";
import { parseFinishedChatMarkdown, walkChatMarkdown } from "./chat-markdown-parser";

export type MessageFileTarget = { kind: "shared"; path: string } | { kind: "workspace"; agentId: string; path: string };

export interface MessageFileDirectory {
  kind: "shared" | "workspace";
  path: string;
}

export function webLink(href: string): string | null {
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function isSharedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.startsWith("~/OpenBot/Shared/") ||
    normalized.startsWith("OpenBot/Shared/") ||
    normalized.includes("/OpenBot/Shared/")
  );
}

export function messageFileDirectory(body: string): MessageFileDirectory | null {
  const folders = new Map<string, MessageFileDirectory>();
  for (const match of body.matchAll(/`([^`\r\n]+[/\\])`/gu)) {
    const path = match[1]?.trim();
    if (!path || path.startsWith("#") || path.includes("\0")) continue;
    if (!/^[A-Za-z]:[/\\]/u.test(path) && /^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) continue;
    folders.set(path, { path, kind: isSharedPath(`${path}file`) ? "shared" : "workspace" });
  }
  return folders.size === 1 ? (folders.values().next().value ?? null) : null;
}

export function messageFileTarget(
  text: string,
  directory: MessageFileDirectory | null,
  agentId: string | undefined,
): { file: MessageFileTarget; written: MessageFileTarget | null } | null {
  const written = text.trim();
  if (!isFileReference(written)) return null;
  const shared = isSharedPath(written);
  if (shared || !directory || /^(?:~[/\\]|[/\\]|[A-Za-z]:[/\\])/u.test(written)) {
    if (shared) return { file: { kind: "shared", path: written }, written: null };
    return agentId ? { file: { kind: "workspace", agentId, path: written }, written: null } : null;
  }
  const separator = directory.path.includes("\\") && !directory.path.includes("/") ? "\\" : "/";
  const path = `${directory.path.replace(/[/\\]+$/u, "")}${separator}${written}`;
  const fallback: MessageFileTarget | null = agentId ? { kind: "workspace", agentId, path: written } : null;
  if (directory.kind === "shared") return { file: { kind: "shared", path }, written: fallback };
  return agentId ? { file: { kind: "workspace", agentId, path }, written: fallback } : null;
}

function fileUrlPath(value: string): string | null {
  const match = /^file:\/\/(?:localhost)?(\/.*)$/iu.exec(value.trim());
  if (!match?.[1]) return null;
  return /^\/[A-Za-z]:\//u.test(match[1]) ? match[1].slice(1) : match[1];
}

function decodedFileUrlPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function workspaceLinkPath(value: string): string | null {
  const path = value.trim();
  if (!path || /[\0\r\n]/u.test(path) || path.startsWith("#")) return null;
  if (/^[A-Za-z]:[/\\]/u.test(path)) return path;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) return null;
  return path;
}

export function messageLinkFileTarget(href: string, agentId: string | undefined): MessageFileTarget | null {
  if (webLink(href)) return null;
  const fileUrl = fileUrlPath(href);
  const shared = decodedFileUrlPath(fileUrl ?? href).trim();
  if (shared && !/[\0\r\n]/u.test(shared) && isSharedPath(shared)) return { kind: "shared", path: shared };
  const workspace = workspaceLinkPath(fileUrl ?? href);
  return workspace && agentId ? { kind: "workspace", agentId, path: workspace } : null;
}

export function isMessageFileLink(href: string): boolean {
  return !webLink(href) && workspaceLinkPath(fileUrlPath(href) ?? href) !== null;
}

export function messageLinkFilePath(href: string): string {
  return decodedFileUrlPath(fileUrlPath(href) ?? href);
}

export function messageTargetFileName(file: MessageFileTarget): string {
  return fileReferenceName(decodedFileUrlPath(file.path));
}

export function messageChipFileNames(body: string, agentId: string | undefined): Set<string> {
  const names = new Set<string>();
  if (!body.includes("`") && !body.includes("[") && !body.includes("<")) return names;
  const directory = messageFileDirectory(body);
  walkChatMarkdown(parseFinishedChatMarkdown(body), (token) => {
    const file =
      token.type === "link" && typeof token.href === "string"
        ? messageLinkFileTarget(token.href, agentId)
        : token.type === "codespan" && typeof token.text === "string"
          ? (messageFileTarget(token.text, directory, agentId)?.file ?? null)
          : null;
    if (file) names.add(messageTargetFileName(file));
  });
  return names;
}
