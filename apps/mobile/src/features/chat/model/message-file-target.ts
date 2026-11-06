import { isFileReference } from "@openbot/brand/file-reference";

/** A file that a message names: in the shared folder, or in the workspace of the agent that wrote it. */
export type MessageFileTarget = { kind: "shared"; path: string } | { kind: "workspace"; agentId: string; path: string };

/** The folder that bare file names of a message are in, as desktop `messageFileDirectory` finds it. */
export interface MessageFileDirectory {
  kind: "shared" | "workspace";
  path: string;
}

/** A path in the host's shared folder, as desktop `sharedFileTarget` reads it. */
function isSharedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.startsWith("~/OpenBot/Shared/") ||
    normalized.startsWith("OpenBot/Shared/") ||
    normalized.includes("/OpenBot/Shared/")
  );
}

/**
 * The one folder that the code spans of a message name, such as `research/eyeliner/`. A bare file
 * name in the same message is in it. Two or more folders give none, as on desktop.
 */
export function messageFileDirectory(body: string): MessageFileDirectory | null {
  const folders = new Map<string, MessageFileDirectory>();
  for (const match of body.matchAll(/`([^`\r\n]+[/\\])`/gu)) {
    const path = match[1]?.trim();
    if (!path || path.startsWith("#") || path.includes("\0")) continue;
    // A URL is no folder. A Windows drive path is one.
    if (!/^[A-Za-z]:[/\\]/u.test(path) && /^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) continue;
    folders.set(path, { path, kind: isSharedPath(`${path}file`) ? "shared" : "workspace" });
  }
  return folders.size === 1 ? (folders.values().next().value ?? null) : null;
}

/**
 * The file that the text of a file chip names, as desktop `mentionedFileTarget` resolves it. A
 * workspace file needs the agent that wrote the message: null without one.
 */
export function messageFileTarget(
  text: string,
  directory: MessageFileDirectory | null,
  agentId: string | undefined,
): MessageFileTarget | null {
  let path = text.trim();
  if (!isFileReference(path)) return null;
  let kind: MessageFileDirectory["kind"] = isSharedPath(path) ? "shared" : "workspace";
  if (kind === "workspace" && directory && !/^(?:~[/\\]|[/\\]|[A-Za-z]:[/\\])/u.test(path)) {
    const separator = directory.path.includes("\\") && !directory.path.includes("/") ? "\\" : "/";
    path = `${directory.path.replace(/[/\\]+$/u, "")}${separator}${path}`;
    kind = directory.kind;
  }
  if (kind === "shared") return { kind, path };
  return agentId ? { kind, agentId, path } : null;
}
