import { createHash } from "node:crypto";

export type DevelopmentProfile = "app" | "test-client";

export function readDevelopmentProfile(value: string | undefined): DevelopmentProfile {
  return value === "test-client" ? "test-client" : "app";
}

export function readDevelopmentInstanceId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^\d{4,5}$/u.test(trimmed) ? trimmed : null;
}

// The remote-debugging switch is development-only, and the port must be one
// `scripts/dev-automation` would accept, so a typo cannot open a listener on
// a privileged or out-of-range port.
export function readDevelopmentRemoteDebuggingPort(value: string | undefined): string | null {
  const port = Number(value?.trim());
  return Number.isInteger(port) && port >= 1_024 && port <= 65_535 ? String(port) : null;
}

// An instance id keyed to the worktree, for `bun run dev --isolated`. Without
// it the suffix comes from whichever renderer port the instance won, so the
// same worktree lands on `OpenBot Dev` one morning and `OpenBot Dev 5175` the
// next, depending on which sibling started first - and its conversations move
// with the suffix. This keeps one worktree on one profile for as long as it
// sits at that path.
//
// Five digits because `readDevelopmentInstanceId` accepts four or five, which
// is what a port-derived id needs. Two worktrees can collide, and then they
// share a profile: the same thing the default does for every worktree.
export function developmentInstanceIdForWorktree(projectRoot: string): string {
  const digest = createHash("sha256").update(projectRoot).digest();
  return String(10_000 + (digest.readUInt32BE(0) % 90_000));
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
