import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

export type DevelopmentProfile = "app" | "test-client";

export function readDevelopmentProfile(value: string | undefined): DevelopmentProfile {
  return value === "test-client" ? "test-client" : "app";
}

export function readDevelopmentInstanceId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^(?:\d{4,5}|wt-[a-f0-9]{64})$/u.test(trimmed) ? trimmed : null;
}

export function readDevelopmentRemoteDebuggingPort(value: string | undefined): string | null {
  const port = Number(value?.trim());
  return Number.isInteger(port) && port >= 1_024 && port <= 65_535 ? String(port) : null;
}

export function readAnalyticsCaptureUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  return url.protocol === "http:" && loopback && url.pathname === "/" ? url.origin : null;
}

export function developmentInstanceIdForWorktree(projectRoot: string): string {
  return `wt-${createHash("sha256").update(projectRoot).digest("hex")}`;
}

export function developmentWorktreeColor(projectRoot: string): string {
  const hue = createHash("sha256").update(realProjectRoot(projectRoot)).digest().readUInt16BE(0) % 360;
  return hslToHex(hue, 0.62, 0.64);
}

function realProjectRoot(projectRoot: string): string {
  try {
    return realpathSync(projectRoot);
  } catch {
    return projectRoot;
  }
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function developmentUserDataName(profile: DevelopmentProfile, instanceId: string | null = null): string {
  const base = profile === "test-client" ? "OpenBot Dev Test Client" : "OpenBot Dev";
  return instanceId ? `${base} ${instanceId}` : base;
}

export function shouldAutoStartHost(input: {
  configured: boolean;
  enabledOnLaunch: boolean;
  remoteRole?: "host" | "client" | null;
}): boolean {
  return input.remoteRole !== "client" && input.configured && input.enabledOnLaunch;
}

export function shouldShowDevelopmentWindow(input: {
  remoteRole: "host" | "client" | null;
  testClientEnabled: boolean;
}): boolean {
  return input.remoteRole !== "host" || !input.testClientEnabled;
}
