import type { AgentSummary, BrowserPreview, BrowserTab, ServerSummary } from "@openbot/contracts/ipc";
import { TEAM_BROWSER_VIEW_CAPABILITY } from "@openbot/contracts/team-protocol/browser-view-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { expect, it, type Mock, vi } from "vitest";
import { App } from "./App";
import {
  AGENTS,
  attachment,
  browserTab,
  confirmOnboardingModel,
  emitAgentEvent,
  emitBrowserLiveView,
  emitBrowserPictureInPicture,
  installOpenbotStub,
  testServer,
} from "./app-test-harness";
import { toast } from "./components/ui";
import BrowserPreviewSidebar, { BrowserPreviewCard } from "./features/conversation/BrowserPreviewSidebar";
import { TestIntersectionObserver } from "./setupTests";

/** One byte stands in for the host's JPEG: jsdom decodes no image, and the test asserts no pixels. */
const IMAGE = new Uint8Array([0xff]);

async function openComputer(): Promise<void> {
  await fireEvent.click(screen.getByRole("button", { name: "Open computer" }));
}

/** jsdom lays nothing out, so a live view's panel is the rectangle the test says it is. */
function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

const LIVE_VIEW_LABEL = "Live view of the page on the host";
const nativeCanvasGetContext = HTMLCanvasElement.prototype.getContext;

/** A server list with one host that can stream its browser, which is what a live view needs. */
function listHostThatStreamsItsBrowser(): void {
  const studio = testServer("remote-1", true);
  vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([
    testServer("local", false),
    {
      ...studio,
      compatibility: {
        localAppVersion: "0.0.0",
        hostAppVersion: "0.0.0",
        localProtocol: { minimum: 1, maximum: 4 },
        hostProtocol: { minimum: 1, maximum: 4 },
        negotiatedProtocol: 4,
        capabilities: ["browser-control", TEAM_BROWSER_VIEW_CAPABILITY],
      },
    },
  ]);
}

/**
 * The two APIs a live view draws with, which jsdom does not implement. Without them the view never
 * draws a frame, and its pointer geometry - which follows the drawn frame - never becomes available.
 * `holdDecodes` leaves a frame arrived but undrawn, the state a host viewport resize passes through.
 */
function stubCanvasDrawing(): { drawn: Mock; decodes: Mock; closes: Mock; holdDecodes: () => () => void } {
  const drawn = vi.fn();
  // Only the live view's own canvas draws through this. Every other canvas keeps the null context
  // jsdom gives it, so `drawn` counts the frames on the panel and nothing else.
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLCanvasElement) {
      return this.getAttribute("aria-label") === LIVE_VIEW_LABEL ? { drawImage: drawn } : null;
    }),
  });
  let held: Promise<void> | undefined;
  // Every decoded frame is closed, drawn or not, so `closes` is where a decode ends.
  const closes = vi.fn();
  const decodes = vi.fn(async () => {
    await held;
    return { close: closes };
  });
  vi.stubGlobal("createImageBitmap", decodes);
  return {
    drawn,
    decodes,
    closes,
    holdDecodes() {
      let release = (): void => undefined;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

/** The two clicks that reach a live browser: the computer panel, then the preview card in it. */
async function openComputerAndCard(title: string): Promise<void> {
  await openComputer();
  await fireEvent.click(await screen.findByRole("button", { name: `Open ${title}` }));
}

describe("OpenBot connected desktop shell", () => {
  beforeEach(() => {
    installOpenbotStub();
  });

  afterEach(() => {
    toast.dismiss();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: nativeCanvasGetContext,
    });
  });

  it("shows a blocked popup reason and lets the user dismiss it", async () => {
    const tab = {
      ...browserTab("popup-parent", "Sign in"),
      popupFailure: {
        id: "blocked-1",
        message: "The browser tab limit was reached. Close a tab, then retry from the page.",
      },
    };
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Sign in");
    expect(await screen.findByRole("alert")).toHaveTextContent(tab.popupFailure.message);
    await fireEvent.click(screen.getByRole("button", { name: "Dismiss popup message" }));
    await waitFor(() => expect(screen.queryByText(tab.popupFailure.message)).not.toBeInTheDocument());
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [{ ...tab, popupFailure: { ...tab.popupFailure, id: "blocked-2" } }],
      activeTabId: tab.id,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(tab.popupFailure.message);
  });

  it("keeps notifications above the browser and restores the same tab after dismissal", async () => {
    const tab = browserTab("notification-tab", "Notification test");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Notification test");
    await waitFor(() =>
      expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true })),
    );

    toast.error("Provider error", { description: "Test notification", duration: Number.POSITIVE_INFINITY });
    const closeNotification = await screen.findByRole("button", { name: "Close notification" });
    await waitFor(() => expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith({ visible: false }));
    await fireEvent.click(closeNotification);
    await waitFor(() =>
      expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true })),
    );
    expect(screen.queryByRole("button", { name: "Close notification" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: tab.title, selected: true })).toBeInTheDocument();
    expect(window.openbot.browser.close).not.toHaveBeenCalled();
  });

  it("opens the selected preview and returns to the same card without losing the draft", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const tabs: BrowserTab[] = [
      browserTab("one", "First preview", { url: "https://example.com/one" }),
      browserTab("two", "Second preview", { url: "https://example.com/two" }),
      browserTab("other", "Other agent page", {
        url: "https://example.com/other",
        ownerAgentId: "other",
        ownerThreadId: "thread-other",
      }),
    ];
    vi.mocked(window.openbot.browser.activate).mockImplementation(async (tabId) => {
      emitAgentEvent?.({ type: "browser-changed", tabs, activeTabId: tabId });
    });
    emitAgentEvent?.({ type: "browser-changed", tabs, activeTabId: "one" });
    const composer = screen.getByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Keep this draft";
    await fireEvent.input(composer);
    await openComputer();
    const card = await screen.findByRole("button", { name: "Open Second preview" });
    expect(screen.queryByRole("button", { name: "Open Other agent page" })).not.toBeInTheDocument();
    expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith({ visible: false });
    await fireEvent.click(card);
    await waitFor(() =>
      expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith(
        expect.objectContaining({ visible: true, target: "main" }),
      ),
    );
    expect(await screen.findByRole("textbox", { name: "Browser address" })).toHaveValue("https://example.com/two");
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: tabs.map((tab) => ({ ...tab, title: `${tab.title} updated` })),
      activeTabId: "two",
    });
    await fireEvent.click(screen.getByRole("button", { name: "Hide browser" }));
    await waitFor(() => expect(card).toHaveFocus());
    expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith({ visible: false });

    // Escape is the other way out of the expanded browser, and it has to land on the same card.
    const updatedCard = await screen.findByRole("button", { name: "Open Second preview updated" });
    await fireEvent.click(updatedCard);
    await waitFor(() =>
      expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith(
        expect.objectContaining({ visible: true, target: "main" }),
      ),
    );
    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(updatedCard).toHaveFocus());
    expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith({ visible: false });
    expect(composer).toHaveTextContent("Keep this draft");
    expect(window.openbot.browser.close).not.toHaveBeenCalled();
  });

  it.each([
    ["whats up", "https://www.google.com/search?q=whats%20up"],
    ["https://whats up", "https://www.google.com/search?q=whats%20up"],
    ["weather", "https://www.google.com/search?q=weather"],
    ["  cats & dogs  ", "https://www.google.com/search?q=cats%20%26%20dogs"],
    ["example.com/docs", "https://example.com/docs"],
    ["http://localhost:3100/", "http://localhost:3100/"],
    ["localhost:5173", "https://localhost:5173"],
    ["127.0.0.1:3100", "https://127.0.0.1:3100"],
  ])("opens the address-bar input %s as %s", async (input, url) => {
    const tab = browserTab("address-tab", "Address test");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Address test");
    const address = screen.getByRole("textbox", { name: "Browser address" });
    address.focus();
    await fireEvent.input(address, { target: { value: input } });
    const form = address.closest("form");
    if (!form) throw new Error("Browser address form was not rendered.");
    await fireEvent.submit(form);
    expect(window.openbot.browser.navigate).toHaveBeenCalledWith({ tabId: tab.id, url });
    expect(window.openbot.browser.open).not.toHaveBeenCalled();
  });

  it("keeps a new address draft when navigation in another tab completes", async () => {
    const first = browserTab("slow-tab", "Slow page", { url: "https://example.com/first" });
    const second = { ...first, id: "draft-tab", title: "Draft page", url: "https://example.com/second" };
    const navigation = Promise.withResolvers<void>();
    vi.mocked(window.openbot.browser.navigate).mockReturnValueOnce(navigation.promise);
    vi.mocked(window.openbot.browser.activate).mockImplementation(async (tabId) => {
      emitAgentEvent?.({ type: "browser-changed", tabs: [first, second], activeTabId: tabId });
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [first, second], activeTabId: first.id });
    await openComputerAndCard("Slow page");
    const address = screen.getByRole("textbox", { name: "Browser address" });
    address.focus();
    await fireEvent.input(address, { target: { value: "example.com/loading" } });
    const form = address.closest("form");
    if (!form) throw new Error("Browser address form was not rendered.");
    await fireEvent.submit(form);
    expect(window.openbot.browser.navigate).toHaveBeenCalledWith({
      tabId: first.id,
      url: "https://example.com/loading",
    });
    await fireEvent.click(screen.getByRole("tab", { name: second.title }));
    await screen.findByRole("tab", { name: second.title, selected: true });
    address.focus();
    await fireEvent.input(address, { target: { value: "Keep this search draft" } });
    navigation.resolve();
    await navigation.promise;
    flush();
    expect(address).toHaveValue("Keep this search draft");
  });

  it("opens address searches on a remote host with an existing tab", async () => {
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([
      testServer("local", false),
      testServer("remote-1", true),
    ]);
    const tab = browserTab("remote-address-tab", "Remote address page");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote address page");
    const address = screen.getByRole("textbox", { name: "Browser address" });
    address.focus();
    await fireEvent.input(address, { target: { value: "remote search" } });
    const form = address.closest("form");
    if (!form) throw new Error("Browser address form was not rendered.");
    await fireEvent.submit(form);
    expect(window.openbot.browser.open).toHaveBeenCalledWith({
      url: "https://www.google.com/search?q=remote%20search",
      ownerAgentId: "chief",
      ownerThreadId: "thread-chief",
      focus: true,
    });
    expect(window.openbot.browser.navigate).not.toHaveBeenCalled();
  });

  it("moves the open tab to an address on a remote host that supports it", async () => {
    const studio = testServer("remote-1", true);
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([
      testServer("local", false),
      {
        ...studio,
        compatibility: {
          localAppVersion: "0.0.0",
          hostAppVersion: "0.0.0",
          localProtocol: { minimum: 1, maximum: 4 },
          hostProtocol: { minimum: 1, maximum: 4 },
          negotiatedProtocol: 4,
          capabilities: ["browser-control", TEAM_BROWSER_NAVIGATION_CAPABILITY],
        },
      },
    ]);
    const tab = browserTab("remote-address-tab", "Remote address page");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote address page");
    const address = screen.getByRole("textbox", { name: "Browser address" });
    address.focus();
    await fireEvent.input(address, { target: { value: "remote search" } });
    const form = address.closest("form");
    if (!form) throw new Error("Browser address form was not rendered.");
    await fireEvent.submit(form);

    expect(window.openbot.browser.navigate).toHaveBeenCalledWith({
      tabId: tab.id,
      url: "https://www.google.com/search?q=remote%20search",
    });
    expect(window.openbot.browser.open).not.toHaveBeenCalled();
  });

  it("draws a remote host's page and sends a click back as a fraction of the frame", async () => {
    listHostThatStreamsItsBrowser();
    const tab = browserTab("remote-live-tab", "Remote live page");
    const { drawn } = stubCanvasDrawing();
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote live page");
    await vi.waitFor(() => expect(window.openbot.browser.startLiveView).toHaveBeenCalledWith(tab.id));

    emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 1, width: 800, height: 600, image: IMAGE });
    const view = await screen.findByRole("img", { name: LIVE_VIEW_LABEL });
    await vi.waitFor(() => expect(drawn).toHaveBeenCalled());
    // The panel is a different size from the host's viewport, so the click is sent as the point on
    // the frame rather than the pixel it landed on here. jsdom has no layout to measure.
    //
    // The panel is 400x400 and the frame is 800x600, so `object-fit: contain` draws the frame as a
    // 400x300 band with a 50 bar above and below it. The centre of the panel is still the centre of
    // the frame; a point anywhere else is not the point the panel's own fraction would name.
    view.getBoundingClientRect = () => domRect(100, 50, 400, 400);
    await fireEvent.mouseDown(view, { clientX: 300, clientY: 250, button: 0, detail: 1 });

    expect(window.openbot.browser.sendLiveViewInput).toHaveBeenCalledWith({
      type: "pointer",
      action: "down",
      x: 0.5,
      y: 0.5,
      sequence: 1,
      button: "left",
      clickCount: 1,
      modifiers: 0,
    });

    // A quarter into the drawn band, not a quarter into the panel: the panel's own fraction would
    // call this point y 0.3125 and click 45 rows lower on the page than the user aimed.
    vi.mocked(window.openbot.browser.sendLiveViewInput).mockClear();
    await fireEvent.mouseDown(view, { clientX: 200, clientY: 175, button: 0, detail: 1 });

    expect(window.openbot.browser.sendLiveViewInput).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pointer", action: "down", x: 0.25, y: 0.25 }),
    );
  });

  it("sends a click on a live view that is letterboxed top and bottom as a point on the frame", async () => {
    listHostThatStreamsItsBrowser();
    const tab = browserTab("remote-live-tab", "Remote live page");
    const { drawn } = stubCanvasDrawing();
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote live page");
    await vi.waitFor(() => expect(window.openbot.browser.startLiveView).toHaveBeenCalledWith(tab.id));

    // The shape the browser panel actually has: a wide page in a tall, narrow panel. The frame is
    // drawn as a 380x237.5 band in the middle of a 380x800 panel, so all but a third of the panel
    // is bar, and a fraction of the panel would miss the page by most of its height.
    emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 1, width: 1280, height: 800, image: IMAGE });
    const view = await screen.findByRole("img", { name: LIVE_VIEW_LABEL });
    await vi.waitFor(() => expect(drawn).toHaveBeenCalled());
    view.getBoundingClientRect = () => domRect(0, 0, 380, 800);

    await fireEvent.mouseDown(view, { clientX: 190, clientY: 400, button: 0, detail: 1 });
    expect(window.openbot.browser.sendLiveViewInput).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pointer", action: "down", x: 0.5, y: 0.5 }),
    );

    // The top bar is not the top of the page. A point there placed on the frame's first row would
    // work whatever control the page keeps at the top, which is not what the user pointed at.
    vi.mocked(window.openbot.browser.sendLiveViewInput).mockClear();
    await fireEvent.mouseDown(view, { clientX: 190, clientY: 10, button: 0, detail: 1 });
    expect(window.openbot.browser.sendLiveViewInput).not.toHaveBeenCalled();
  });

  it("holds a click back until a frame is drawn on the live view", async () => {
    listHostThatStreamsItsBrowser();
    const tab = browserTab("remote-live-tab", "Remote live page");
    const { drawn, holdDecodes } = stubCanvasDrawing();
    const decode = holdDecodes();
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote live page");
    await vi.waitFor(() => expect(window.openbot.browser.startLiveView).toHaveBeenCalledWith(tab.id));

    // The frame arrived, so the panel stops saying it is connecting, but the decode has not finished
    // and the canvas is still blank. There is no page under the pointer to aim at yet.
    emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 1, width: 800, height: 600, image: IMAGE });
    const view = await screen.findByRole("img", { name: LIVE_VIEW_LABEL });
    view.getBoundingClientRect = () => domRect(0, 0, 400, 400);
    await fireEvent.mouseDown(view, { clientX: 100, clientY: 125, button: 0, detail: 1 });
    expect(window.openbot.browser.sendLiveViewInput).not.toHaveBeenCalled();

    decode();
    await vi.waitFor(() => expect(drawn).toHaveBeenCalled());
    await fireEvent.mouseDown(view, { clientX: 100, clientY: 125, button: 0, detail: 1 });
    expect(window.openbot.browser.sendLiveViewInput).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pointer", action: "down", x: 0.25, y: 0.25 }),
    );
  });

  it("names the drawn frame when a click is made while a newer frame decodes", async () => {
    listHostThatStreamsItsBrowser();
    const tab = browserTab("remote-live-tab", "Remote live page");
    const { drawn, decodes, holdDecodes } = stubCanvasDrawing();
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote live page");
    await vi.waitFor(() => expect(window.openbot.browser.startLiveView).toHaveBeenCalledWith(tab.id));

    emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 1, width: 800, height: 600, image: IMAGE });
    const view = await screen.findByRole("img", { name: LIVE_VIEW_LABEL });
    await vi.waitFor(() => expect(drawn).toHaveBeenCalled());
    view.getBoundingClientRect = () => domRect(0, 0, 400, 400);

    // The host's viewport changed shape, so the next frame is 400x800 where the drawn one is 800x600.
    // The panel still shows the wide frame, and the click belongs to that frame: the point goes back
    // named with its sequence, so the host expands it against the pixels the user aimed at rather
    // than against the frame that has not arrived on this side yet.
    const decode = holdDecodes();
    // A screencast repeats the page until something changes, and a frame that arrives while another
    // one decodes waits behind it. Offer the resized frame until it is the one being decoded; the
    // hold keeps it there, so no third decode can start behind it.
    await vi.waitFor(() => {
      emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 2, width: 400, height: 800, image: IMAGE });
      expect(decodes).toHaveBeenCalledTimes(2);
    });

    await fireEvent.mouseDown(view, { clientX: 100, clientY: 125, button: 0, detail: 1 });
    expect(window.openbot.browser.sendLiveViewInput).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pointer", action: "down", x: 0.25, y: 0.25, sequence: 1 }),
    );

    // Once the resized frame is drawn, a point names that frame instead. The screencast repeated
    // the resized frame while the first one decoded, so wait for the click rather than count draws.
    vi.mocked(window.openbot.browser.sendLiveViewInput).mockClear();
    decode();
    await vi.waitFor(async () => {
      await fireEvent.mouseDown(view, { clientX: 100, clientY: 125, button: 0, detail: 1 });
      expect(window.openbot.browser.sendLiveViewInput).toHaveBeenCalledWith(
        expect.objectContaining({ type: "pointer", action: "down", x: 0, y: 0.3125, sequence: 2 }),
      );
    });
  });

  it("draws the frame that arrived last while another was decoding", async () => {
    listHostThatStreamsItsBrowser();
    const tab = browserTab("remote-live-tab", "Remote live page");
    const { drawn, decodes, holdDecodes } = stubCanvasDrawing();
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote live page");
    await vi.waitFor(() => expect(window.openbot.browser.startLiveView).toHaveBeenCalledWith(tab.id));

    emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 1, width: 800, height: 600, image: IMAGE });
    const view = await screen.findByRole("img", { name: LIVE_VIEW_LABEL });
    await vi.waitFor(() => expect(drawn).toHaveBeenCalled());
    view.getBoundingClientRect = () => domRect(0, 0, 400, 400);

    // The page resized and then stopped changing, so the host has no reason to send anything more.
    // A view that only dropped the frames behind the one it was decoding would show the page from
    // before the resize for as long as the user keeps watching it.
    const decode = holdDecodes();
    await vi.waitFor(() => {
      emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 2, width: 800, height: 600, image: IMAGE });
      expect(decodes).toHaveBeenCalledTimes(2);
    });
    emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 3, width: 400, height: 800, image: IMAGE });
    decode();

    await vi.waitFor(() => expect(drawn).toHaveBeenCalledTimes(3));
    await fireEvent.mouseDown(view, { clientX: 100, clientY: 125, button: 0, detail: 1 });
    expect(window.openbot.browser.sendLiveViewInput).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pointer", action: "down", x: 0, y: 0.3125, sequence: 3 }),
    );
  });

  it("throws away a frame that finishes decoding after the live view stops", async () => {
    listHostThatStreamsItsBrowser();
    const tab = browserTab("remote-live-tab", "Remote live page");
    const { drawn, closes, holdDecodes } = stubCanvasDrawing();
    const decode = holdDecodes();
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({ type: "browser-changed", tabs: [tab], activeTabId: tab.id });
    await openComputerAndCard("Remote live page");
    await vi.waitFor(() => expect(window.openbot.browser.startLiveView).toHaveBeenCalledWith(tab.id));

    emitBrowserLiveView?.({ type: "frame", tabId: tab.id, sequence: 1, width: 800, height: 600, image: IMAGE });
    const view = await screen.findByRole("img", { name: LIVE_VIEW_LABEL });
    view.getBoundingClientRect = () => domRect(0, 0, 400, 400);

    // The stream ends while that frame is still decoding. Its page is gone, so drawing it late would
    // show pixels of somewhere nobody is watching and aim the pointer at them.
    emitBrowserLiveView?.({ type: "stopped", tabId: tab.id, reason: "The host stopped the live view." });
    decode();
    await vi.waitFor(() => expect(closes).toHaveBeenCalled());

    expect(drawn).not.toHaveBeenCalled();
    await fireEvent.mouseDown(view, { clientX: 100, clientY: 125, button: 0, detail: 1 });
    expect(window.openbot.browser.sendLiveViewInput).not.toHaveBeenCalled();
    expect(await screen.findByText("The host stopped the live view.")).toBeInTheDocument();
  });

  it("keeps existing previews when a new tab is added", async () => {
    const first = browserTab("existing", "Existing page");
    const [tabs, setTabs] = createSignal([first]);
    const capture = vi.mocked(window.openbot.browser.capturePreview);
    render(() => (
      <BrowserPreviewSidebar
        tabs={tabs()}
        hidden={false}
        suspended={false}
        contextKey="local:chief"
        defaultWidth={() => 320}
        maxWidth={() => 600}
        onWidthChange={() => undefined}
        onOpenTab={() => undefined}
        onCloseTab={() => undefined}
        onCollapse={() => undefined}
        onNewTab={() => setTabs([{ ...first }, { ...first, id: "new", title: "New page" }])}
      />
    ));
    await screen.findByRole("img", { name: "Preview of Existing page" });
    capture.mockClear();
    await fireEvent.click(screen.getByRole("button", { name: "New browser tab" }));
    await screen.findByRole("img", { name: "Preview of New page" });
    expect(capture.mock.calls.map(([id]) => id)).toEqual(["new"]);
    expect(screen.getByRole("img", { name: "Preview of Existing page" })).toBeInTheDocument();
  });

  it("refreshes preview images only while the card is visible and enabled", async () => {
    vi.useFakeTimers();
    const [enabled, setEnabled] = createSignal(true);
    const [tab, setTab] = createSignal<BrowserTab>(browserTab("preview", "Preview page", { ownerThreadId: "chief" }));
    const capture = vi.mocked(window.openbot.browser.capturePreview);
    const view = render(() => (
      <BrowserPreviewCard
        tab={tab()}
        contextKey="local:chief"
        enabled={enabled()}
        onOpen={() => undefined}
        onClose={() => undefined}
      />
    ));
    flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(capture).toHaveBeenCalledWith("preview");
    capture.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenLastCalledWith("preview");
    setEnabled(false);
    flush();
    await vi.advanceTimersByTimeAsync(6000);
    expect(capture).toHaveBeenCalledTimes(1);
    setEnabled(true);
    flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenLastCalledWith("preview");
    setTab((current) => ({ ...current, url: "https://example.com/new" }));
    flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(capture).toHaveBeenCalledTimes(3);
    expect(capture).toHaveBeenLastCalledWith("preview");
    view.unmount();
    await vi.advanceTimersByTimeAsync(6000);
    expect(capture).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("discards a late preview from another context and retries failed captures", async () => {
    vi.useFakeTimers();
    const [context, setContext] = createSignal("local:chief");
    const tab = browserTab("preview", "Preview page", { ownerThreadId: "chief" });
    let resolvePreview: ((preview: BrowserPreview) => void) | undefined;
    const capture = vi.mocked(window.openbot.browser.capturePreview);
    capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const view = render(() => (
      <BrowserPreviewCard tab={tab} contextKey={context()} enabled onOpen={() => undefined} onClose={() => undefined} />
    ));
    flush();
    setContext("remote:chief");
    flush();
    expect(capture).toHaveBeenCalledTimes(1);
    let rejectPreview: ((error: Error) => void) | undefined;
    capture.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPreview = reject;
        }),
    );
    resolvePreview?.({ dataUrl: "data:image/jpeg;base64,b2xk", width: 960, height: 600 });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole("img", { name: "Preview of Preview page" })).not.toBeInTheDocument();
    rejectPreview?.(new Error("Capture unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole("button", { name: "Open Preview page" })).toBeEnabled();
    capture.mockResolvedValue({ dataUrl: "data:image/jpeg;base64,bmV3", width: 960, height: 600 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByRole("img", { name: "Preview of Preview page" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,bmV3",
    );
    view.unmount();
    vi.useRealTimers();
  });

  it("does not capture a card outside the visible area", async () => {
    vi.spyOn(TestIntersectionObserver.prototype, "observe").mockImplementation(() => undefined);
    render(() => (
      <BrowserPreviewCard
        tab={browserTab("offscreen", "Offscreen", { ownerThreadId: "chief" })}
        contextKey="local:chief"
        enabled
        onOpen={() => undefined}
        onClose={() => undefined}
      />
    ));
    await screen.findByRole("button", { name: "Open Offscreen" });
    expect(window.openbot.browser.capturePreview).not.toHaveBeenCalled();
  });

  it("moves the live embedded browser between the sidebar and desktop Picture in Picture", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [browserTab("tab-pip", "Picture in Picture test", { url: "https://example.com/pip" })],
      activeTabId: "tab-pip",
    });

    await openComputerAndCard("Picture in Picture test");
    expect(await screen.findByRole("complementary", { name: "Browser" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Open browser Picture in Picture" }));

    await waitFor(() => expect(window.openbot.browser.openPictureInPicture).toHaveBeenCalledWith(undefined));
    expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument();
    expect(window.openbot.browser.close).not.toHaveBeenCalled();

    emitBrowserPictureInPicture?.({
      type: "bounds-changed",
      bounds: { x: 720, y: 360, width: 460, height: 340 },
    });
    expect(window.localStorage.getItem("openbot:browser-pip-native-bounds")).toBe("720,360,460,340");

    emitBrowserPictureInPicture?.({ type: "dock" });
    expect(await screen.findByRole("complementary", { name: "Browser" })).toBeInTheDocument();
    expect(window.openbot.browser.close).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Open browser Picture in Picture" }));
    await waitFor(() =>
      expect(window.openbot.browser.openPictureInPicture).toHaveBeenLastCalledWith({
        x: 720,
        y: 360,
        width: 460,
        height: 340,
      }),
    );
    emitBrowserPictureInPicture?.({ type: "hide" });
    expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument();
    expect(window.openbot.browser.close).not.toHaveBeenCalled();
  });

  it("keeps a newly opened browser tab active when the initial tab request resolves late", async () => {
    const googleTab = browserTab("tab-google", "Google", { url: "https://www.google.com" });
    const substackTab = browserTab("tab-substack", "Substack | Chat", { url: "https://substack.com/chat" });
    let resolveInitialState: (state: { tabs: BrowserTab[]; activeTabId: string | null }) => void = () => undefined;
    vi.mocked(window.openbot.browser.getDisplayState).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInitialState = resolve;
      }),
    );

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(window.openbot.browser.getDisplayState).toHaveBeenCalledTimes(1));
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [googleTab, substackTab],
      activeTabId: substackTab.id,
    });
    await openComputerAndCard("Substack | Chat");
    const substackTrigger = await screen.findByRole("tab", { name: "Substack | Chat" });
    expect(substackTrigger).toHaveAttribute("aria-selected", "true");

    resolveInitialState({ tabs: [googleTab], activeTabId: googleTab.id });

    await waitFor(() => expect(substackTrigger).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Google" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("textbox", { name: "Browser address" })).toHaveValue("https://substack.com/chat");
  });

  it("restores the active local browser tab after returning from a remote server", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolveRemoteTabs: ((state: { tabs: BrowserTab[]; activeTabId: string | null }) => void) | undefined;
    const firstTab = browserTab("tab-first", "First local tab", { url: "https://example.com/first" });
    const activeTab = browserTab("tab-active", "Active local tab", { url: "https://example.com/active" });
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.openbot.servers.select).mockImplementation(async (serverId) => [
      { ...local, active: serverId === "local" },
      { ...remote, active: serverId === "remote-1" },
    ]);
    // Main answers this for a remote server too, so the held read is the remote leg's display
    // state rather than a bare tab list.
    vi.mocked(window.openbot.browser.getDisplayState)
      .mockResolvedValueOnce({ tabs: [], activeTabId: null })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRemoteTabs = resolve;
        }),
      )
      .mockResolvedValueOnce({ tabs: [firstTab, activeTab], activeTabId: activeTab.id });

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(window.openbot.browser.getDisplayState).toHaveBeenCalledTimes(1));
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(window.openbot.servers.select).toHaveBeenCalledWith("remote-1"));
    await waitFor(() => expect(resolveRemoteTabs).toBeDefined());
    resolveRemoteTabs?.({ tabs: [], activeTabId: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Local server" }));
    await waitFor(() => expect(window.openbot.browser.getDisplayState).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Local server" })).toHaveAttribute("aria-pressed", "true"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await openComputerAndCard("Active local tab");

    expect(await screen.findByRole("tab", { name: "Active local tab" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "First local tab" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("textbox", { name: "Browser address" })).toHaveValue("https://example.com/active");
  });

  it("restores desktop Picture in Picture per conversation without overriding it during agent control", async () => {
    window.localStorage.setItem("openbot:browser-pip-native-bounds", "640,320,460,340");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [browserTab("tab-pip-restore", "Restored PiP")],
      activeTabId: "tab-pip-restore",
    });
    await openComputerAndCard("Restored PiP");
    await fireEvent.click(screen.getByRole("button", { name: "Open browser Picture in Picture" }));
    await waitFor(() =>
      expect(window.openbot.browser.openPictureInPicture).toHaveBeenLastCalledWith({
        x: 640,
        y: 320,
        width: 460,
        height: 340,
      }),
    );

    emitAgentEvent?.({
      type: "browser-control-changed",
      state: {
        sessions: [
          {
            id: "thread-chief:turn-pip",
            threadId: "thread-chief",
            turnId: "turn-pip",
            callId: "call-pip",
            tabId: "tab-pip-restore",
            action: "click",
            phase: "acting",
            startedAt: "2026-08-24T08:00:00.000Z",
          },
        ],
      },
    });
    expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    await waitFor(() => expect(window.openbot.browser.closePictureInPicture).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    await waitFor(() => expect(window.openbot.browser.openPictureInPicture).toHaveBeenCalledTimes(2));
  });

  it("shows the browser control indicator only while an agent acts", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [
        browserTab("tab-1", "Local smoke page", { url: "http://127.0.0.1:4321" }),
        browserTab("tab-2", "Second page", { url: "https://example.com/second" }),
        browserTab("tab-3", "Third page", { url: "https://example.com/third" }),
      ],
      activeTabId: "tab-1",
    });
    emitAgentEvent?.({
      type: "browser-control-changed",
      state: {
        sessions: [
          {
            id: "thread-chief:turn-1",
            threadId: "thread-chief",
            turnId: "turn-1",
            callId: "call-1",
            tabId: null,
            action: "type",
            phase: "acting",
            startedAt: "2026-08-12T10:00:00.000Z",
          },
        ],
      },
    });

    expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument();
    const browserControl = screen.getByRole("button", { name: "Chief is controlling the browser" });
    expect(browserControl).toHaveAttribute("aria-expanded", "false");
    expect(window.openbot.browser.open).not.toHaveBeenCalled();

    await fireEvent.click(browserControl);
    await fireEvent.click(await screen.findByRole("button", { name: "Open Local smoke page" }));
    const controlledTab = await screen.findByRole("tab", {
      name: "Local smoke page, controlled by Chief",
    });
    expect(controlledTab).toHaveAttribute("aria-description", "Press Delete or Control/Command W to close");
    await fireEvent.keyDown(screen.getByRole("tab", { name: "Third page" }), { key: "Delete" });
    expect(window.openbot.browser.close).toHaveBeenCalledWith("tab-3");
    await fireEvent.click(screen.getByRole("button", { name: "New browser tab" }));
    expect(window.openbot.browser.open).toHaveBeenCalledWith({
      url: "https://www.google.com",
      ownerThreadId: "thread-chief",
      ownerAgentId: "chief",
      focus: true,
    });
    expect(screen.queryByText("Typing…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chief is controlling the browser" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    emitAgentEvent?.({
      type: "browser-control-changed",
      state: {
        sessions: [
          {
            id: "thread-chief:turn-1",
            threadId: "thread-chief",
            turnId: "turn-1",
            callId: "call-1",
            tabId: "tab-1",
            action: "type",
            phase: "waiting",
            startedAt: "2026-08-12T10:00:00.000Z",
          },
        ],
      },
    });
    expect(screen.queryByRole("button", { name: "Chief is controlling the browser" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide computer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Local smoke page" })).toBe(controlledTab);

    emitAgentEvent?.({
      type: "browser-control-changed",
      state: {
        sessions: [
          {
            id: "thread-chief:turn-1",
            threadId: "thread-chief",
            turnId: "turn-1",
            callId: "call-1",
            tabId: "tab-1",
            action: "type",
            phase: "waiting",
            startedAt: "2026-08-12T10:00:00.000Z",
          },
          {
            id: "thread-chief:turn-2",
            threadId: "thread-chief",
            turnId: "turn-2",
            callId: "call-2",
            tabId: "tab-1",
            action: "click",
            phase: "acting",
            startedAt: "2026-08-12T10:00:01.000Z",
          },
        ],
      },
    });
    expect(screen.getByRole("tab", { name: "Local smoke page, controlled by Chief" })).toBe(controlledTab);

    emitAgentEvent?.({ type: "browser-control-changed", state: { sessions: [] } });
    expect(screen.getByRole("tab", { name: "Local smoke page" })).toBe(controlledTab);
  });

  it("coalesces repeated empty-browser opens and does not reopen the panel after a late response", async () => {
    const openedTab = browserTab("tab-delayed", "Delayed page", { url: "https://www.google.com" });
    let resolveOpen: ((tab: BrowserTab) => void) | undefined;
    vi.mocked(window.openbot.browser.open).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await openComputer();
    expect(await screen.findByRole("complementary", { name: "Browser previews" })).toBeInTheDocument();
    expect(window.openbot.browser.open).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole("button", { name: "Hide computer" }));
    await openComputer();
    await fireEvent.click(screen.getByRole("button", { name: "Hide computer" }));
    expect(window.openbot.browser.open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("complementary", { name: "Browser previews" })).not.toBeInTheDocument();

    emitAgentEvent?.({ type: "browser-changed", tabs: [openedTab], activeTabId: openedTab.id });
    resolveOpen?.(openedTab);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("complementary", { name: "Browser previews" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open computer" })).toHaveAttribute("aria-expanded", "false");
    expect(window.openbot.browser.open).toHaveBeenCalledTimes(1);

    await openComputerAndCard("Delayed page");
    expect(await screen.findByRole("tab", { name: "Delayed page" })).toHaveAttribute("aria-selected", "true");
    await fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(window.openbot.browser.reload).toHaveBeenCalledWith(openedTab.id);

    await fireEvent.click(screen.getByRole("button", { name: "Hide computer" }));
    await openComputerAndCard("Delayed page");
    expect(await screen.findByRole("tab", { name: "Delayed page" })).toHaveAttribute("aria-selected", "true");
    expect(window.openbot.browser.open).toHaveBeenCalledTimes(1);
  });

  it("allows a replacement when a loading browser tab is closed before its open request settles", async () => {
    const loadingTab = browserTab("tab-loading", "Loading…", { url: "https://www.google.com/", loading: true });
    let resolveFirstOpen: ((tab: BrowserTab) => void) | undefined;
    vi.mocked(window.openbot.browser.open).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstOpen = resolve;
        }),
    );

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await openComputer();
    expect(window.openbot.browser.open).toHaveBeenCalledTimes(1);

    emitAgentEvent?.({ type: "browser-changed", tabs: [loadingTab], activeTabId: loadingTab.id });
    await fireEvent.click(await screen.findByRole("button", { name: "Open Loading…" }));
    const tab = await screen.findByRole("tab", { name: "Loading…" });
    await fireEvent.keyDown(tab, { key: "Delete" });
    expect(window.openbot.browser.close).toHaveBeenCalledWith(loadingTab.id);

    emitAgentEvent?.({ type: "browser-changed", tabs: [], activeTabId: null });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument());

    await fireEvent.click(screen.getByRole("button", { name: "Open a page" }));
    expect(window.openbot.browser.open).toHaveBeenCalledTimes(2);

    resolveFirstOpen?.(loadingTab);
  });

  it("opens the requested browser tab from the takeover preview and resumes the agent", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    await waitFor(() => expect(emitAgentEvent).toBeDefined());
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [
        browserTab("tab-public", "Public page"),
        browserTab("tab-login", "Sign in", { url: "https://example.com/login" }),
      ],
      activeTabId: "tab-public",
    });
    emitAgentEvent?.({
      type: "browser-takeover-requested",
      request: {
        requestId: "takeover-1",
        agentId: "chief",
        threadId: "thread-chief",
        turnId: "turn-1",
        tabId: "tab-login",
      },
    });

    expect(await screen.findByRole("region", { name: "Browser takeover" })).toHaveTextContent("Action required");
    expect(screen.getByRole("heading", { name: "Complete the step on example.com" })).toBeVisible();
    expect(await screen.findByRole("img", { name: "Preview of Sign in" })).toBeVisible();
    expect(window.openbot.browser.capturePreview).toHaveBeenCalledTimes(1);
    expect(window.openbot.browser.capturePreview).toHaveBeenCalledWith("tab-login");
    expect(screen.queryByRole("textbox", { name: "Message Chief" })).not.toBeInTheDocument();
    // The request alone never takes the window: the page waits behind the preview on the card.
    expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument();
    expect(window.openbot.browser.activate).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Open Sign in" }));
    expect(await screen.findByRole("complementary", { name: "Browser" })).toBeVisible();
    await waitFor(() => expect(window.openbot.browser.activate).toHaveBeenCalledWith("tab-login"));

    await fireEvent.click(screen.getByRole("button", { name: "I’m done" }));
    await waitFor(() =>
      expect(window.openbot.agent.respondToBrowserTakeover).toHaveBeenCalledWith({
        requestId: "takeover-1",
        decision: "complete",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Browser takeover" })).not.toBeInTheDocument());
    const completedCard = await screen.findByRole("region", { name: "Browser takeover complete" });
    expect(completedCard).toHaveTextContent("Done");
    expect(within(completedCard).getByRole("img", { name: "Preview of Sign in" })).toBeVisible();
    expect(within(completedCard).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Chief" })).toBeVisible();
  });

  it("keeps browser takeover actions available when the preview fails", async () => {
    vi.mocked(window.openbot.browser.capturePreview).mockRejectedValueOnce(new Error("Preview unavailable"));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    await waitFor(() => expect(emitAgentEvent).toBeDefined());
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [browserTab("tab-login", "Sign in", { url: "https://example.com/login" })],
      activeTabId: "tab-login",
    });
    emitAgentEvent?.({
      type: "browser-takeover-requested",
      request: {
        requestId: "takeover-preview-failed",
        agentId: "chief",
        threadId: "thread-chief",
        turnId: "turn-preview-failed",
        tabId: "tab-login",
      },
    });

    const card = await screen.findByRole("region", { name: "Browser takeover" });
    await waitFor(() => expect(within(card).queryByRole("img")).not.toBeInTheDocument());
    await fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(window.openbot.agent.respondToBrowserTakeover).toHaveBeenCalledWith({
        requestId: "takeover-preview-failed",
        decision: "cancel",
      }),
    );
    const cancelledCard = await screen.findByRole("region", { name: "Browser takeover cancelled" });
    expect(cancelledCard).toHaveTextContent("Cancelled");
    expect(within(cancelledCard).queryByRole("button")).not.toBeInTheDocument();
  });

  it("coalesces repeated tab closes and ignores navigation while a close is pending", async () => {
    let resolveClose: (() => void) | undefined;
    vi.mocked(window.openbot.browser.close).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const firstTab = browserTab("tab-shortcut-1", "First page", { url: "https://example.com/first" });
    const secondTab = browserTab("tab-shortcut-2", "Second page", { url: "https://example.com/second" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [firstTab, secondTab],
      activeTabId: secondTab.id,
    });

    await openComputerAndCard("First page");
    await screen.findByRole("complementary", { name: "Browser" });
    const closingTab = await screen.findByRole("tab", { name: "Second page" });
    await fireEvent.pointerDown(closingTab, { button: 1 });
    await fireEvent.pointerDown(closingTab, { button: 1 });
    expect(window.openbot.browser.close).toHaveBeenCalledWith(secondTab.id);
    expect(window.openbot.browser.close).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(window.openbot.browser.navigate).not.toHaveBeenCalled();

    resolveClose?.();
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Second page" })).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "First page" })).toHaveAttribute("aria-selected", "true");
  });

  it("waits for tab activation before it closes the same tab", async () => {
    let resolveActivation: (() => void) | undefined;
    vi.mocked(window.openbot.browser.activate).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveActivation = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const firstTab = browserTab("tab-activation-first", "First activation page", { url: "https://example.com/first" });
    const secondTab = browserTab("tab-activation-closing", "Closing activation page", {
      url: "https://example.com/closing",
    });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [firstTab, secondTab],
      activeTabId: firstTab.id,
    });

    await openComputerAndCard("First activation page");
    const closingTab = await screen.findByRole("tab", { name: "Closing activation page" });
    await fireEvent.click(closingTab);
    await waitFor(() => expect(window.openbot.browser.activate).toHaveBeenCalledWith(secondTab.id));
    await fireEvent.keyDown(closingTab, { key: "Delete" });
    expect(window.openbot.browser.close).not.toHaveBeenCalled();

    resolveActivation?.();
    await waitFor(() => expect(window.openbot.browser.close).toHaveBeenCalledWith(secondTab.id));
  });

  it("drops a pending tab close when a server switch begins", async () => {
    const local = testServer("local", true);
    const studio = testServer("remote-1", false);
    let resolveActivation: (() => void) | undefined;
    let resolveSelection: ((servers: ServerSummary[]) => void) | undefined;
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, studio]);
    vi.mocked(window.openbot.servers.select).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSelection = resolve;
        }),
    );
    vi.mocked(window.openbot.browser.activate).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveActivation = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const firstTab = browserTab("tab-switch-first", "First switch page", { url: "https://example.com/first" });
    const closingTab = browserTab("tab-switch-closing", "Closing switch page", { url: "https://example.com/closing" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [firstTab, closingTab],
      activeTabId: firstTab.id,
    });

    await openComputerAndCard("First switch page");
    const closingTabElement = await screen.findByRole("tab", { name: "Closing switch page" });
    await fireEvent.click(closingTabElement);
    await waitFor(() => expect(resolveActivation).toBeDefined());
    await fireEvent.keyDown(closingTabElement, { key: "Delete" });
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(resolveSelection).toBeDefined());

    resolveActivation?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.openbot.browser.close).not.toHaveBeenCalled();

    resolveSelection?.([
      { ...local, active: false },
      { ...studio, active: true },
    ]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("keeps the browser open when a new tab replaces the last tab during its delayed close", async () => {
    let resolveClose: (() => void) | undefined;
    vi.mocked(window.openbot.browser.close).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const closingTab = browserTab("tab-closing-last", "Closing page", { url: "https://example.com/closing" });
    const replacementTab = browserTab("tab-replacement", "Replacement page", {
      url: "https://example.com/replacement",
    });
    emitAgentEvent?.({ type: "browser-changed", tabs: [closingTab], activeTabId: closingTab.id });
    await openComputerAndCard("Closing page");
    await fireEvent.keyDown(await screen.findByRole("tab", { name: "Closing page" }), { key: "Delete" });
    await waitFor(() => expect(resolveClose).toBeDefined());

    emitAgentEvent?.({ type: "browser-changed", tabs: [replacementTab], activeTabId: replacementTab.id });
    expect(await screen.findByRole("tab", { name: "Replacement page" })).toBeInTheDocument();
    resolveClose?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole("complementary", { name: "Browser" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Replacement page" })).toBeInTheDocument();
  });

  it("blocks browser controls while the remote browser is suspended during a server switch", async () => {
    const local = testServer("local", true);
    const studio = testServer("remote-1", false);
    const office = { ...testServer("remote-2", false), name: "Office PC", apiUrl: "https://office.example.com" };
    let resolveOfficeSelection: ((servers: ServerSummary[]) => void) | undefined;
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, studio, office]);
    vi.mocked(window.openbot.servers.select)
      .mockResolvedValueOnce([
        { ...local, active: false },
        { ...studio, active: true },
        { ...office, active: false },
      ])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOfficeSelection = resolve;
          }),
      );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(window.openbot.servers.select).toHaveBeenCalledWith("remote-1"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [browserTab("remote-tab-during-switch", "Remote page", { url: "https://example.com/remote" })],
      activeTabId: "remote-tab-during-switch",
    });
    await openComputerAndCard("Remote page");
    const remoteTab = await screen.findByRole("tab", { name: "Remote page" });
    const address = screen.getByRole("textbox", { name: "Browser address" });
    const addressForm = address.closest("form");
    if (!addressForm) throw new Error("Browser address form was not rendered.");
    const backButton = screen.getByRole("button", { name: "Go back" });
    const reloadButton = screen.getByRole("button", { name: "Reload page" });
    vi.mocked(window.openbot.browser.open).mockClear();
    vi.mocked(window.openbot.browser.activate).mockClear();
    vi.mocked(window.openbot.browser.close).mockClear();
    vi.mocked(window.openbot.browser.reload).mockClear();
    vi.mocked(window.openbot.browser.navigate).mockClear();

    await fireEvent.click(screen.getByRole("button", { name: "Office PC server" }));
    await waitFor(() => expect(resolveOfficeSelection).toBeDefined());
    expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument();
    const computerButton = screen.getByRole("button", { name: "Open computer" });
    expect(computerButton).toBeDisabled();
    await fireEvent.click(computerButton);
    await fireEvent.click(remoteTab);
    await fireEvent.keyDown(remoteTab, { key: "Delete" });
    await fireEvent.click(backButton);
    await fireEvent.click(reloadButton);
    await fireEvent.submit(addressForm);
    await fireEvent.keyDown(window, { key: "w", ctrlKey: true });

    expect(window.openbot.browser.open).not.toHaveBeenCalled();
    expect(window.openbot.browser.activate).not.toHaveBeenCalled();
    expect(window.openbot.browser.close).not.toHaveBeenCalled();
    expect(window.openbot.browser.reload).not.toHaveBeenCalled();
    expect(window.openbot.browser.navigate).not.toHaveBeenCalled();
    resolveOfficeSelection?.([
      { ...local, active: false },
      { ...studio, active: false },
      { ...office, active: true },
    ]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Office PC server" })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("restores the visible browser after a server switch fails", async () => {
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([
      testServer("local", true),
      testServer("remote-1", false),
    ]);
    vi.mocked(window.openbot.servers.select).mockRejectedValueOnce(new Error("Workspace refresh failed"));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [browserTab("local-tab", "Local page", { url: "https://example.com/local" })],
      activeTabId: "local-tab",
    });

    await openComputerAndCard("Local page");
    await screen.findByRole("complementary", { name: "Browser" });
    await waitFor(() =>
      expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith(
        expect.objectContaining({ visible: true, target: "main" }),
      ),
    );
    vi.mocked(window.openbot.browser.setVisible).mockClear();

    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));

    await screen.findByText("Could not select the server");
    expect(await screen.findByRole("complementary", { name: "Browser" })).toBeInTheDocument();
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith({ visible: false }));
    await fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    await waitFor(() =>
      expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith(
        expect.objectContaining({ visible: true, target: "main" }),
      ),
    );
  });

  it("keeps the latest workspace when an older server load resolves late", async () => {
    const local = testServer("local", true);
    const studio = { ...testServer("remote-1", false), name: "Studio Mac" };
    const office = { ...testServer("remote-2", false), name: "Office PC", apiUrl: "https://office.example.com" };
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, studio, office]);
    vi.mocked(window.openbot.servers.select)
      .mockResolvedValueOnce([
        { ...local, active: false },
        { ...studio, active: true },
        { ...office, active: false },
      ])
      .mockResolvedValueOnce([
        { ...local, active: false },
        { ...studio, active: false },
        { ...office, active: true },
      ]);

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    let resolveStudioAgents: ((agents: AgentSummary[]) => void) | undefined;
    vi.mocked(window.openbot.agent.listAgents)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStudioAgents = resolve;
          }),
      )
      .mockResolvedValueOnce([{ ...AGENTS[0], name: "Office Chief" }]);

    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(resolveStudioAgents).toBeDefined());
    await fireEvent.click(screen.getByRole("button", { name: "Office PC server" }));

    expect(await screen.findByRole("heading", { name: "Office Chief" })).toBeInTheDocument();
    resolveStudioAgents?.([{ ...AGENTS[0], name: "Studio Chief" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole("button", { name: "Office PC server" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Office Chief" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Studio Chief" })).not.toBeInTheDocument();
  });

  it("restores the authoritative workspace when a newer server selection fails", async () => {
    const local = testServer("local", true);
    const studio = { ...testServer("remote-1", false), name: "Studio Mac" };
    const office = { ...testServer("remote-2", false), name: "Office PC", apiUrl: "https://office.example.com" };
    const studioActive = [
      { ...local, active: false },
      { ...studio, active: true },
      { ...office, active: false },
    ];
    let resolveStudioSelection: ((servers: ServerSummary[]) => void) | undefined;
    let rejectOfficeSelection: ((error: Error) => void) | undefined;
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, studio, office]);
    vi.mocked(window.openbot.servers.select)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStudioSelection = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOfficeSelection = reject;
          }),
      )
      .mockResolvedValueOnce(studioActive);

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValueOnce([{ ...AGENTS[0], name: "Studio Chief" }]);

    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(resolveStudioSelection).toBeDefined());
    await fireEvent.click(screen.getByRole("button", { name: "Office PC server" }));
    await waitFor(() => expect(rejectOfficeSelection).toBeDefined());
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce(studioActive);
    resolveStudioSelection?.(studioActive);
    await new Promise((resolve) => setTimeout(resolve, 0));
    rejectOfficeSelection?.(new Error("Office unavailable"));

    expect(await screen.findByRole("heading", { name: "Studio Chief" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true");
    expect(window.openbot.servers.select).toHaveBeenCalledTimes(3);
  });

  it("returns to browser previews when its last tab is closed from the embedded page", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [browserTab("tab-embedded-shortcut", "Focused page")],
      activeTabId: "tab-embedded-shortcut",
    });
    await openComputerAndCard("Focused page");
    expect(await screen.findByRole("complementary", { name: "Browser" })).toBeInTheDocument();

    emitAgentEvent?.({ type: "browser-changed", tabs: [], activeTabId: null });

    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument());
    expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith({ visible: false });
  });

  describe.each(["workspace", "shared"] as const)("%s file preview errors", (source) => {
    const filename = "email1_body.txt";
    const path = source === "workspace" ? `/tmp/OpenBot/Agents/chief/${filename}` : `/tmp/OpenBot/Shared/${filename}`;
    const linkName = `Open ${source} file ${filename}`;
    const missingError = new Error(
      `Error invoking remote method 'agent:preview-${source}-file': Error: ENOENT: no such file or directory, realpath '${path}'`,
    );
    const missingMessage = `“${filename}” was not found. Ask the agent to create or restore the file, then click the link again.`;
    const preview = {
      name: filename,
      size: 13,
      mimeType: "text/plain",
      previewKind: "text" as const,
      bytes: new TextEncoder().encode("Approved body"),
    };
    const previewMock = () =>
      source === "workspace"
        ? vi.mocked(window.openbot.agent.previewWorkspaceFile)
        : vi.mocked(window.openbot.agent.previewSharedFile);

    beforeEach(() => {
      vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) => ({
        agentId,
        threadId: agentId === "chief" ? "thread-chief" : null,
        activeTurnId: null,
        revision: 1,
        messages:
          agentId === "chief"
            ? [
                {
                  id: "missing-template",
                  author: "assistant",
                  text: `Please provide [${filename}](${path}).`,
                  createdAt: "2026-08-24T12:16:00.000Z",
                  status: "completed",
                },
              ]
            : [],
        readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
      }));
    });

    it("explains a missing file and clears the error when preview is retried", async () => {
      const retry = Promise.withResolvers<typeof preview>();
      previewMock().mockRejectedValueOnce(missingError).mockReturnValueOnce(retry.promise);
      render(() => <App />);
      await fireEvent.click(await screen.findByRole("button", { name: linkName }));
      expect(await screen.findByRole("alert")).toHaveTextContent(missingMessage);
      await fireEvent.click(screen.getByRole("button", { name: linkName }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      retry.resolve(preview);
      expect(await screen.findByText("Approved body")).toBeInTheDocument();
    });

    it.each(["another preview", "another agent"])("ignores a late failure after opening %s", async (next) => {
      const pending = Promise.withResolvers<typeof preview>();
      previewMock().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(preview);
      render(() => <App />);
      await fireEvent.click(await screen.findByRole("button", { name: linkName }));
      if (next === "another preview") {
        await fireEvent.click(screen.getByRole("button", { name: linkName }));
        await screen.findByText("Approved body");
      } else {
        await fireEvent.click(screen.getByRole("button", { name: /^Sales Outbound/ }));
        await screen.findByRole("heading", { name: "Sales Outbound" });
      }
      pending.reject(missingError);
      await pending.promise.catch(() => {});
      flush();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("opens workspace Markdown in the right sidebar and keeps external opening explicit", async () => {
    const workspacePath = "/tmp/OpenBot/Agents/chief/recipe-tomato-basil-pasta.md";
    const sharedPath = "/tmp/OpenBot/Shared/menu.txt";
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) => ({
      agentId,
      threadId: agentId === "chief" ? "thread-chief" : null,
      activeTurnId: null,
      revision: 1,
      messages:
        agentId === "chief"
          ? [
              {
                id: "message-file-preview",
                author: "assistant",
                text: `Created [recipe-tomato-basil-pasta.md](${workspacePath}) and [menu.txt](${sharedPath}).`,
                createdAt: "2026-08-24T12:16:00.000Z",
                status: "completed",
              },
            ]
          : [],
      readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    }));
    vi.mocked(window.openbot.agent.previewWorkspaceFile).mockResolvedValueOnce({
      name: "recipe-tomato-basil-pasta.md",
      size: 41,
      mimeType: "text/plain",
      previewKind: "markdown",
      bytes: new TextEncoder().encode("# Tomato Basil Pasta\n\nUse **fresh basil**."),
    });
    vi.mocked(window.openbot.agent.previewSharedFile).mockResolvedValueOnce({
      name: "menu.txt",
      size: 12,
      mimeType: "text/plain",
      previewKind: "text",
      bytes: new TextEncoder().encode("Pasta menu"),
    });

    render(() => <App />);
    await fireEvent.click(
      await screen.findByRole("button", { name: "Open workspace file recipe-tomato-basil-pasta.md" }),
    );

    expect(await screen.findByRole("complementary", { name: "File preview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Tomato Basil Pasta" })).toBeInTheDocument();
    expect(screen.getByText("fresh basil").tagName).toBe("STRONG");
    expect(window.openbot.agent.previewWorkspaceFile).toHaveBeenCalledWith({ agentId: "chief", path: workspacePath });
    expect(window.openbot.agent.openWorkspaceFile).not.toHaveBeenCalled();
    expect(window.openbot.browser.setVisible).toHaveBeenLastCalledWith({ visible: false });

    await fireEvent.click(screen.getByRole("button", { name: "Open file externally" }));
    expect(window.openbot.agent.openWorkspaceFile).toHaveBeenCalledWith({ agentId: "chief", path: workspacePath });
    await fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    expect(screen.queryByRole("complementary", { name: "File preview" })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Open shared file menu.txt" }));
    expect(await screen.findByText("Pasta menu")).toBeInTheDocument();
    expect(window.openbot.agent.previewSharedFile).toHaveBeenCalledWith({ path: sharedPath });
    expect(window.openbot.agent.openSharedFile).not.toHaveBeenCalled();
  });
  it("opens an attached file in the right sidebar rather than a modal", async () => {
    const attached = attachment("att-brief", "launch-brief.md", "pdf");
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) => ({
      agentId,
      threadId: agentId === "chief" ? "thread-chief" : null,
      activeTurnId: null,
      revision: 1,
      messages:
        agentId === "chief"
          ? [
              {
                id: "message-attachment-preview",
                author: "assistant",
                text: `Here is @[${attached.name}](attachment:${attached.id}).`,
                createdAt: "2026-08-24T12:16:00.000Z",
                status: "completed",
                attachments: [{ ...attached, mimeType: "text/markdown", previewKind: "text" as const }],
              },
            ]
          : [],
      readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new TextEncoder().encode("# Launch brief\n\nShip **on Friday**."))),
    );

    render(() => <App />);
    await fireEvent.click(await screen.findByRole("button", { name: `Open attached file ${attached.name}` }));

    expect(await screen.findByRole("complementary", { name: "File preview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Launch brief" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Download file" }));
    expect(window.openbot.agent.openAttachment).toHaveBeenCalledWith({
      attachmentId: attached.id,
      action: "download",
    });

    await fireEvent.click(screen.getByRole("button", { name: "Close file preview" }));
    expect(screen.queryByRole("complementary", { name: "File preview" })).not.toBeInTheDocument();
  });
});
