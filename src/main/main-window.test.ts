// @vitest-environment node

import { tmpdir } from "node:os";
import { join } from "node:path";
import { translateFor } from "@openbot/i18n";
import { describe, expect, it, vi } from "vitest";
import { FilePreviewPages } from "./file-preview-pages";
import { createMainWindowController, createMainWindowHolder } from "./main-window";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Contents extends EventEmitter {
    setWindowOpenHandler() {}
  }
  class Window extends EventEmitter {
    webContents = new Contents();
    async loadURL(url: string) {
      this.webContents.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false });
    }
  }
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  return {
    BrowserWindow: Window,
    app: {},
    clipboard: {},
    Menu: {},
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getAllDisplays: () => [display],
      getDisplayNearestPoint: () => display,
    },
  };
});

function previewWindow() {
  const pages = new FilePreviewPages(1);
  const rendererLoadStarted = vi.fn(() => pages.clear());
  const controller = createMainWindowController({
    holder: createMainWindowHolder(),
    statePath: join(tmpdir(), "openbot-preview-window-state.json"),
    appIconPath: "",
    developmentProfile: "preview-test",
    developmentRemoteRole: null,
    developmentTestClientEnabled: false,
    isQuitting: () => false,
    getServices: () => null,
    getTranslate: () => translateFor("en"),
    forwardAgentEvent: () => {},
    onRendererLoadStarted: rendererLoadStarted,
    onRendererGone: () => pages.clear(),
    onMainWindowCreated: () => {},
    reportError: (_message, error) => {
      throw error;
    },
  });
  const window = controller.openMainWindow();
  const open = () => {
    const address = pages.add("text/html", new TextEncoder().encode("<h1>Preview</h1>"), pages.generation);
    expect(address).toBeDefined();
    return new Request(address ?? "");
  };
  return { pages, controller, window, open, rendererLoadStarted };
}

describe("main window preview lifetime", () => {
  it("clears pages on committed main-frame navigations and lets the next renderer open a page", () => {
    const { pages, window, open } = previewWindow();
    for (let reload = 0; reload < 10; reload += 1) {
      const request = open();
      window.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      expect(pages.response(request).status).toBe(200);
      window.webContents.emit("did-navigate", {}, "openbot-app://app/index.html", -1, "");
      expect(pages.response(request).status).toBe(404);
    }
    expect(pages.response(open()).status).toBe(200);
  });

  it.each(["file:///tmp/dropped-preview.html", "https://untrusted.invalid/"])(
    "keeps preview pages and renderer readiness when navigation to %s is cancelled",
    (url) => {
      const { pages, window, open, rendererLoadStarted } = previewWindow();
      const request = open();
      const preventDefault = vi.fn();
      window.webContents.emit("did-start-navigation", { url, isMainFrame: true, isSameDocument: false });
      window.webContents.emit("will-navigate", { preventDefault }, url);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(pages.response(request).status).toBe(200);
      expect(rendererLoadStarted).not.toHaveBeenCalled();
    },
  );

  it("clears pages when the application loads a replacement document", async () => {
    const { pages, controller, window, open } = previewWindow();
    const request = open();
    await controller.loadRenderer(window);
    expect(pages.response(request).status).toBe(404);
    expect(pages.response(open()).status).toBe(200);
  });

  it.each(["render-process-gone", "destroyed"])("clears pages after %s without renderer cleanup", (event) => {
    const { pages, window, open } = previewWindow();
    const request = open();
    window.webContents.emit(event, {}, { reason: "crashed", exitCode: 1 });
    expect(pages.response(request).status).toBe(404);
    expect(pages.response(open()).status).toBe(200);
  });

  it.each([
    { isMainFrame: false, isSameDocument: false },
    { isMainFrame: true, isSameDocument: true },
  ])("keeps pages through navigation that does not replace the main document: %j", (details) => {
    const { pages, window, open } = previewWindow();
    const request = open();
    window.webContents.emit("did-start-navigation", details);
    if (details.isSameDocument) {
      window.webContents.emit("did-navigate-in-page", {}, "openbot-app://app/index.html#preview", true, 1, 1);
    } else {
      window.webContents.emit("did-frame-navigate", {}, "openbot-visual://preview/frame", -1, "", false, 1, 2);
    }
    expect(pages.response(request).status).toBe(200);
  });

  it("keeps pages when the main window is hidden", () => {
    const { pages, window, open } = previewWindow();
    const request = open();
    window.emit("hide");
    window.emit("show");
    expect(pages.response(request).status).toBe(200);
  });
});
