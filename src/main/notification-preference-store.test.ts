// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestNotificationPermission } from "./desktop-notifications";
import { NotificationPreferenceStore } from "./notification-preference-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("notification permission request", () => {
  it("asks macOS once per install and remembers it across restarts", async () => {
    const path = await preferencePath();
    const showWelcome = vi.fn();
    const first = await loadedStore(path);
    await requestNotificationPermission({ platform: "darwin", preference: first, showWelcome });
    await requestNotificationPermission({ platform: "darwin", preference: first, showWelcome });
    const restarted = await loadedStore(path);
    await requestNotificationPermission({ platform: "darwin", preference: restarted, showWelcome });
    expect(showWelcome).toHaveBeenCalledTimes(1);
  });

  it("waits until the user turns desktop notifications on, and keeps the switch", async () => {
    const path = await preferencePath();
    // A file from a build before the request, with the switch off.
    await writeFile(path, '{"version":1,"desktopNotifications":false}\n');
    const store = await loadedStore(path);
    const showWelcome = vi.fn();
    await requestNotificationPermission({ platform: "darwin", preference: store, showWelcome });
    expect(showWelcome).not.toHaveBeenCalled();

    await store.set({ desktopNotifications: true });
    await requestNotificationPermission({ platform: "darwin", preference: store, showWelcome });
    expect(showWelcome).toHaveBeenCalledTimes(1);
    await store.set({ desktopNotifications: false });
    const restarted = await loadedStore(path);
    expect(restarted.get()).toEqual({ desktopNotifications: false });
    expect(restarted.permissionRequested()).toBe(true);
  });

  it("does not show the welcome on systems that do not ask", async () => {
    const store = await loadedStore(await preferencePath());
    const showWelcome = vi.fn();
    await requestNotificationPermission({ platform: "win32", preference: store, showWelcome });
    expect(showWelcome).not.toHaveBeenCalled();
  });
});

async function preferencePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-notification-preference-"));
  roots.push(root);
  return join(root, "notification-preference.json");
}

async function loadedStore(path: string): Promise<NotificationPreferenceStore> {
  const store = new NotificationPreferenceStore(path);
  await store.load();
  return store;
}
