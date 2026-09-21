// @vitest-environment node

import type { ComputerUseState, MacPermissionId } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";

type TrustedInvoke = (event: { senderFrame: { url: string }; sender?: { id: number } }, payload: unknown) => unknown;

// The real binder is used, so each endpoint is reached the way a renderer reaches it. `ipcMain` has
// no injectable seam outside an Electron process, so this stand-in records what the registrar bound.
const bound = new Map<string, TrustedInvoke>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, listener: TrustedInvoke) => bound.set(channel, listener) },
}));

const { computerUseIpcHandlers } = await import("./computer-use-handlers");

const APP_FRAME = { senderFrame: { url: "openbot-app://app/index.html" } };
const HELP_WINDOW_FRAME = { ...APP_FRAME, sender: { id: 7 } };

const READY: ComputerUseState = {
  status: "ready",
  permissions: [{ id: "screen-recording", granted: true }],
  message: null,
};

function bind(options: { show?: (permission: MacPermissionId) => Promise<void> } = {}) {
  const opened: string[] = [];
  const shown: MacPermissionId[] = [];
  const close = vi.fn();
  const startDrag = vi.fn(async (sender: { id: number }) => {
    if (sender.id !== 7) throw new Error("The Computer Use drag must start in the help window.");
  });
  const reveal = vi.fn();
  const permissionHelp = {
    show: async (permission: MacPermissionId) => {
      shown.push(permission);
      await options.show?.(permission);
    },
    close,
    permissionApp: async () => ({ name: "Electron", iconDataUrl: null }),
    startDrag,
    reveal,
  };
  bound.clear();
  const { computerUse: endpoints } = computerUseIpcHandlers({
    cuaDriver: { state: async () => READY },
    openExternal: async (url) => {
      opened.push(url);
    },
    permissionHelp,
  });
  for (const [name, register] of Object.entries(endpoints)) register(name);
  return { opened, shown, close, startDrag, reveal };
}

describe("the Computer Use endpoints", () => {
  // System Settings opens in front of everything, which leaves the panel that asked for the grant
  // behind it. Without the help window the user is in another application with no steps to read.
  it("opens the pane for the permission, and brings the steps with it", async () => {
    const { opened, shown } = bind();

    const state = await bound.get("openPermissionPane")?.(APP_FRAME, "accessibility");

    expect(opened).toEqual([
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
    ]);
    expect(shown).toEqual(["accessibility"]);
    expect(state).toEqual(READY);
  });

  // The pane is open either way, and the grant is what the user went to System Settings to give.
  it("answers with the state when the help window cannot come up", async () => {
    const { opened } = bind({
      show: async () => {
        throw new Error("no display");
      },
    });

    await expect(bound.get("openPermissionPane")?.(APP_FRAME, "screen-recording")).resolves.toEqual(READY);
    expect(opened).toHaveLength(1);
  });

  it("opens no pane for a permission the renderer invents", () => {
    const { opened, shown } = bind();

    expect(() => bound.get("openPermissionPane")?.(APP_FRAME, "camera")).toThrow(/Unknown macOS permission/u);
    expect(opened).toEqual([]);
    expect(shown).toEqual([]);
  });

  it("takes the steps away when the renderer is done with them", async () => {
    const { close } = bind();

    await bound.get("closePermissionHelp")?.(APP_FRAME, undefined);

    expect(close).toHaveBeenCalledTimes(1);
  });

  // The card the user drags carries the bundle macOS holds responsible, which in a development
  // build is Electron and not OpenBot.
  it("names the application the System Settings list will show", async () => {
    bind();

    await expect(bound.get("getPermissionApp")?.(APP_FRAME, undefined)).resolves.toEqual({
      name: "Electron",
      iconDataUrl: null,
    });
  });

  // A drag puts a file wherever the pointer is let go, so the sender is checked past the trusted
  // URL gate: every window of the app shares one origin.
  it("drags the application only for the help window", async () => {
    const { startDrag } = bind();

    await bound.get("startPermissionAppDrag")?.(HELP_WINDOW_FRAME, undefined);
    await expect(
      bound.get("startPermissionAppDrag")?.({ ...APP_FRAME, sender: { id: 99 } }, undefined),
    ).rejects.toThrow(/must start in the help window/u);

    expect(startDrag).toHaveBeenCalledTimes(2);
  });

  it("shows the application in Finder for the user who cannot drag", async () => {
    const { reveal } = bind();

    await bound.get("revealPermissionApp")?.(APP_FRAME, undefined);

    expect(reveal).toHaveBeenCalledTimes(1);
  });
});
