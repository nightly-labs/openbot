import type { MacPermissionId } from "@openbot/contracts/ipc";
import { assert, describe, expect, it, vi } from "vitest";
import { ComputerUsePermissionHelpWindowController } from "./computer-use-permission-help-window";

let nextWebContentsId = 1;

function fakeWindow() {
  let destroyed = false;
  const listeners = new Map<string, () => void>();
  return {
    webContents: { id: nextWebContentsId++ },
    show: vi.fn(),
    close: vi.fn(() => {
      destroyed = true;
      listeners.get("closed")?.();
    }),
    isDestroyed: () => destroyed,
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
  };
}

type FakeWindow = ReturnType<typeof fakeWindow>;

function controller(
  loadWindow?: (window: FakeWindow, permission: MacPermissionId) => Promise<void>,
  bundlePath: () => string | null = () => "/Applications/OpenBot.app",
  bundleIcon: (path: string) => Promise<string> = async () => "data:image/png;base64,icon",
) {
  const windows: FakeWindow[] = [];
  const revealed: string[] = [];
  const created = new ComputerUsePermissionHelpWindowController<FakeWindow>({
    createWindow: () => {
      const window = fakeWindow();
      windows.push(window);
      return window;
    },
    loadWindow: loadWindow ?? (async () => undefined),
    bundlePath,
    bundleIcon,
    revealPath: (path) => revealed.push(path),
  });
  return { controller: created, windows, revealed };
}

describe("ComputerUsePermissionHelpWindowController", () => {
  it("shows one window, and reuses it for the other permission", async () => {
    const loaded: string[] = [];
    const { controller: help, windows } = controller(async (_window, permission) => {
      loaded.push(permission);
    });

    await help.show("screen-recording");
    await help.show("accessibility");

    expect(windows).toHaveLength(1);
    expect(loaded).toEqual(["screen-recording", "accessibility"]);
    expect(windows[0]?.show).toHaveBeenCalledTimes(2);
  });

  // The user presses one row and then the other. The first load finishes last, and a window that
  // showed the permission the user has left would send them back to the wrong pane.
  it("shows nothing for a permission the user moved on from", async () => {
    const releases: Array<() => void> = [];
    const { controller: help, windows } = controller(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );

    const first = help.show("screen-recording");
    const second = help.show("accessibility");
    const [releaseFirst, releaseSecond] = releases;
    assert(releaseFirst && releaseSecond);
    releaseSecond();
    await second;
    releaseFirst();
    await first;

    expect(windows[0]?.show).toHaveBeenCalledTimes(1);
  });

  // The window floats over everything, so one left behind by a load still running at teardown would
  // be the last thing on the desktop.
  it("shows nothing after it is closed", async () => {
    const releases: Array<() => void> = [];
    const { controller: help, windows } = controller(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );

    const pending = help.show("accessibility");
    help.close();
    const [release] = releases;
    assert(release);
    release();
    await pending;

    expect(windows[0]?.close).toHaveBeenCalledTimes(1);
    expect(windows[0]?.show).not.toHaveBeenCalled();
    expect(help.open).toBe(false);
  });

  // The card names what System Settings will list, which is the bundle, not the product.
  it("names the bundle the system holds responsible", async () => {
    const { controller: help } = controller(undefined, () => "/path/to/Electron.app");

    await expect(help.permissionApp()).resolves.toEqual({
      name: "Electron",
      iconDataUrl: "data:image/png;base64,icon",
    });
  });

  it("offers no card where there is no bundle to drag", async () => {
    const { controller: help } = controller(undefined, () => null);

    await expect(help.permissionApp()).resolves.toBeNull();
  });

  // Every window of the app shares one origin, so this check is the only thing that keeps a drag
  // from starting in a window the user is not dragging from.
  it("drags the bundle for the help window, and for no other sender", async () => {
    const { controller: help, windows } = controller();
    await help.show("accessibility");
    const startDrag = vi.fn();
    const [helpWindow] = windows;
    assert(helpWindow);

    await help.startDrag({ id: helpWindow.webContents.id, startDrag });
    await expect(help.startDrag({ id: helpWindow.webContents.id + 1000, startDrag })).rejects.toThrow(
      /must start in the help window/u,
    );

    expect(startDrag).toHaveBeenCalledTimes(1);
    expect(startDrag).toHaveBeenCalledWith({
      file: "/Applications/OpenBot.app",
      icon: "data:image/png;base64,icon",
    });
  });

  it("shows the bundle in Finder for the user who cannot drag", async () => {
    const { controller: help, revealed } = controller();

    help.reveal();

    expect(revealed).toEqual(["/Applications/OpenBot.app"]);
  });
  it("uses Sunshine only in its helper and restores the Computer Use bundle when reopened", async () => {
    const { controller: help, windows, revealed } = controller();
    await help.show("accessibility", "/runtime/Sunshine.app");
    const [helpWindow] = windows;
    assert(helpWindow);
    const senderId = helpWindow.webContents.id;
    expect(await help.permissionApp(senderId)).toMatchObject({ name: "Sunshine" });
    expect(await help.permissionApp(senderId + 1000)).toMatchObject({ name: "OpenBot" });
    const startDrag = vi.fn();
    await help.startDrag({ id: senderId, startDrag });
    expect(startDrag).toHaveBeenCalledWith({ file: "/runtime/Sunshine.app", icon: "data:image/png;base64,icon" });
    help.reveal(senderId);
    expect(revealed).toEqual(["/runtime/Sunshine.app"]);
    await help.show("screen-recording");
    expect(await help.permissionApp(senderId)).toMatchObject({ name: "OpenBot" });
    await help.show("accessibility", "/runtime/Sunshine.app");
    help.close();
    expect(await help.permissionApp(senderId)).toMatchObject({ name: "OpenBot" });
  });

  it("does not drag a stale bundle after the helper changes", async () => {
    const releases: Array<(icon: string) => void> = [];
    const { controller: help, windows } = controller(
      undefined,
      undefined,
      () => new Promise((resolve) => releases.push(resolve)),
    );
    await help.show("accessibility", "/runtime/Sunshine.app");
    const startDrag = vi.fn();
    const [helpWindow] = windows;
    assert(helpWindow);
    const pending = help.startDrag({ id: helpWindow.webContents.id, startDrag });
    await help.show("screen-recording");
    const [release] = releases;
    assert(release);
    release("icon");
    await expect(pending).rejects.toThrow("changed before the drag started");
    expect(startDrag).not.toHaveBeenCalled();
  });
});
