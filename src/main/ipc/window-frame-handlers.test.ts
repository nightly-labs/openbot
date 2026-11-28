// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type FramedWindow, windowFrameIpcHandlers } from "./window-frame-handlers";

const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown) {
      registrations.set(channel, listener);
    },
  },
}));

const MAIN_ID = 1;
const CHAT_ID = 2;
const OVERLAY_ID = 3;

class RecordingWindow implements FramedWindow {
  readonly calls: string[] = [];
  maximized = false;
  minimize() {
    this.calls.push("minimize");
  }
  maximize() {
    this.maximized = true;
    this.calls.push("maximize");
  }
  unmaximize() {
    this.maximized = false;
    this.calls.push("unmaximize");
  }
  isMaximized() {
    return this.maximized;
  }
  close() {
    this.calls.push("close");
  }
}

function event(senderId: number, url = "openbot-app://app/index.html") {
  return { senderFrame: { url }, sender: { id: senderId } };
}

function register(drawsOwnButtons = true) {
  const windows = new Map<number, RecordingWindow>([
    [MAIN_ID, new RecordingWindow()],
    [CHAT_ID, new RecordingWindow()],
  ]);
  const { windowFrame } = windowFrameIpcHandlers({
    drawsOwnButtons,
    appWindowOf: (sender) => windows.get(sender.id) ?? null,
    state: (window) => ({ buttons: drawsOwnButtons, maximized: window.isMaximized() }),
  });
  for (const [name, bind] of Object.entries(windowFrame)) bind(`windowFrame:${name}`);
  const call = (name: string, senderId: number, url?: string) => {
    const listener = registrations.get(`windowFrame:${name}`);
    if (!listener) throw new Error(`No handler for ${name}.`);
    return listener(event(senderId, url));
  };
  const main = windows.get(MAIN_ID);
  const chat = windows.get(CHAT_ID);
  if (!main || !chat) throw new Error("Missing test windows.");
  return { main, chat, call };
}

beforeEach(() => registrations.clear());

describe("window frame handlers", () => {
  it("acts only on the window of the renderer that asks", () => {
    const { main, chat, call } = register();
    call("minimize", CHAT_ID);
    call("toggleMaximize", MAIN_ID);
    call("toggleMaximize", MAIN_ID);
    call("close", CHAT_ID);
    expect(main.calls).toEqual(["maximize", "unmaximize"]);
    expect(chat.calls).toEqual(["minimize", "close"]);
  });

  it("gives each window its own state", () => {
    const { call } = register();
    call("toggleMaximize", CHAT_ID);
    expect(call("getState", MAIN_ID)).toEqual({ buttons: true, maximized: false });
    expect(call("getState", CHAT_ID)).toEqual({ buttons: true, maximized: true });
  });

  it("rejects a renderer that is not the main window or a chat window", () => {
    const { main, chat, call } = register();
    for (const name of ["getState", "minimize", "toggleMaximize", "close"]) {
      expect(() => call(name, OVERLAY_ID)).toThrow("outside an app window");
    }
    expect([main.calls, chat.calls]).toEqual([[], []]);
  });

  it("refuses the button actions where the window has native buttons", () => {
    const { main, call } = register(false);
    for (const name of ["minimize", "toggleMaximize", "close"]) {
      expect(() => call(name, MAIN_ID)).toThrow("native buttons");
    }
    expect(call("getState", MAIN_ID)).toEqual({ buttons: false, maximized: false });
    expect(main.calls).toEqual([]);
  });

  it("rejects a renderer outside the app", () => {
    const { main, call } = register();
    expect(() => call("close", MAIN_ID, "https://evil.example/")).toThrow("untrusted renderer");
    expect(main.calls).toEqual([]);
  });
});
