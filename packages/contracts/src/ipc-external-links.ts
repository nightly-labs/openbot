// Where OpenBot opens a web page for the user: links in chats, sign-in pages, billing pages and
// connector pages. Each computer has its own choice, because the page opens on that computer.

import { isDynamicRecord } from "./runtime-values";

/** The longest program path or command that the setting keeps. */
export const EXTERNAL_LINK_APP_PATH_LIMIT = 1024;

/**
 * - `default`: the browser that the operating system opens web pages with.
 * - `openbot`: links in chats open in the built-in browser. Other pages open as for `default`.
 * - `app`: one program. On macOS it is an application bundle, opened with `open -a`. On Linux and
 *   Windows it is a program path or a command name. It gets the address as its only argument, with
 *   no shell.
 */
export type ExternalLinkTarget = { kind: "default" } | { kind: "openbot" } | { kind: "app"; path: string };

export interface ExternalLinkPreference {
  target: ExternalLinkTarget;
}

export const DEFAULT_EXTERNAL_LINK_PREFERENCE: ExternalLinkPreference = { target: { kind: "default" } };

/** An application on this computer that opens web pages. */
export interface ExternalLinkBrowser {
  name: string;
  path: string;
}

export interface ExternalLinkBrowsers {
  /** The browser that opens web pages now. Null when the system does not tell. */
  defaultBrowser: ExternalLinkBrowser | null;
  browsers: ExternalLinkBrowser[];
}

/** Main sends it when the chosen program did not start, and the default browser opened the page. */
export interface ExternalLinkFallback {
  name: string;
}

/** A program path or command: one line, with no NUL character. */
export function isExternalLinkAppPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= EXTERNAL_LINK_APP_PATH_LIMIT &&
    !/[\0\r\n]/.test(value)
  );
}

export function decodeExternalLinkTarget(value: unknown): ExternalLinkTarget | null {
  if (!isDynamicRecord(value)) return null;
  if (value.kind === "default" || value.kind === "openbot") return { kind: value.kind };
  if (value.kind === "app" && isExternalLinkAppPath(value.path)) return { kind: "app", path: value.path };
  return null;
}

/** The name that the setting shows for a program: its file name, with no `.app` or `.exe`. */
export function externalLinkAppName(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return name.replace(/\.(app|exe)$/i, "");
}
