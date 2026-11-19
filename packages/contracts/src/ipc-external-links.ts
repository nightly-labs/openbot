import { isDynamicRecord } from "./runtime-values";

export const EXTERNAL_LINK_APP_PATH_LIMIT = 1024;

export type ExternalLinkTarget = { kind: "default" } | { kind: "openbot" } | { kind: "app"; path: string };

export interface ExternalLinkPreference {
  target: ExternalLinkTarget;
}

export const DEFAULT_EXTERNAL_LINK_PREFERENCE: ExternalLinkPreference = { target: { kind: "default" } };

export interface ExternalLinkBrowser {
  name: string;
  path: string;
}

export interface ExternalLinkBrowsers {
  defaultBrowser: ExternalLinkBrowser | null;
  browsers: ExternalLinkBrowser[];
}

export interface ExternalLinkFallback {
  name: string;
}

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

export function externalLinkAppName(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return name.replace(/\.(app|exe)$/i, "");
}
