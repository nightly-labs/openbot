import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Effect } from "effect";

export interface DesktopTestPaths {
  root: string;
  profile: string;
  workspaces: string;
  temporary: string;
}

/** Fresh temporary roots only: an existing profile must never enter this mode. */
export function desktopTestPaths(root: string, temporaryRoot: string, packaged: boolean): DesktopTestPaths {
  if (
    packaged ||
    !isAbsolute(root) ||
    resolve(root) !== root ||
    dirname(root) !== temporaryRoot ||
    !/^truesmac-desktop-test-[a-z0-9-]{1,16}$/u.test(root.slice(temporaryRoot.length + 1))
  ) {
    throw new Error("Desktop test mode requires a fresh named directory in the canonical temporary directory.");
  }
  return { root, profile: join(root, "profile"), workspaces: join(root, "workspaces"), temporary: join(root, "tmp") };
}

export const admitDesktopTest = Effect.fn("DesktopTest.admit")(function* (
  root: string,
  packaged: boolean,
  filesystem = {
    temporaryRoot: () => realpathSync(process.platform === "darwin" ? "/tmp" : tmpdir()),
    createDirectory: (path: string) => mkdirSync(path, { mode: 0o700 }),
  },
) {
  return yield* Effect.try(() => {
    const paths = desktopTestPaths(root, filesystem.temporaryRoot(), packaged);
    // No recursive creation: EEXIST rejects files, symlinks and previous runs atomically.
    filesystem.createDirectory(paths.root);
    filesystem.createDirectory(paths.profile);
    filesystem.createDirectory(join(paths.profile, "crashes"));
    filesystem.createDirectory(paths.workspaces);
    filesystem.createDirectory(paths.temporary);
    return paths;
  });
});

// Only local bootstrap reads. New endpoints are refused until inspected for side effects.
const TEST_READS = new Set([
  "app:get-info",
  "app:get-setup-state",
  "app:get-analytics-preference",
  "app:get-analytics-default",
  "app:get-language-preference",
  "app:get-logo-color-preference",
  "app:get-appearance-preference",
  "app:get-interface-size-preference",
  "app:get-agent-defaults",
  "app:get-busy-message-mode",
  "agent:get-status",
  "agent:list",
  "agent:channels:list",
  "agent:get-sidebar-layout",
  "agent:sidebar-pins:get",
  "auth:get-state",
  "host:get-status",
  "provider-runtimes:get-status",
  "update:get-status",
]);
export function desktopTestRequestAllowed(channel: string): boolean {
  return TEST_READS.has(channel);
}
