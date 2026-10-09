import { Effect } from "effect";

// @vitest-environment node

import { TEAM_BROWSER_VIEW_CAPABILITY } from "@openbot/contracts/team-protocol/browser-view-v1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { BrowserViewClient } from "./browser-view-client";
import { stubEventSockets } from "./remote-server-test-harness";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrowserViewClient", () => {
  it("reports the host failure when the stream closes", async () => {
    const { last } = stubEventSockets();
    const closeBrowserViewSession = vi.fn(() => Effect.void);
    const onEvent = vi.fn();
    const client = new BrowserViewClient({
      servers: {
        activeServerId: "host-1",
        supportsCapability: () => true,
        openBrowserViewStream: () =>
          Effect.succeed({ sessionId: "view-1", url: "ws://127.0.0.1:1/stream", protocols: [] }),
        closeBrowserViewSession,
      },
      onEvent,
    });
    await runCauseEffect(client.start("tab-1"));
    const event = new Event("close");
    Object.defineProperties(event, { code: { value: 1011 }, reason: { value: "The host stream socket failed." } });
    last()?.dispatchEvent(event);
    await vi.waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({
        type: "stopped",
        tabId: "tab-1",
        reason: "The host stream socket failed.",
      }),
    );
    expect(closeBrowserViewSession).toHaveBeenCalledWith("host-1", "view-1");
    await runCauseEffect(client.stop());
  });

  // The main process's WebSocket throws for a close code other than 1000 or 3000-4999. Thrown in the
  // message listener, it is uncaught in the main process, and the live view never ends cleanly.
  it("ends the view and releases the host session when a frame is invalid", async () => {
    const { last } = stubEventSockets();
    const closeBrowserViewSession = vi.fn(() => Effect.void);
    const onEvent = vi.fn();
    const client = new BrowserViewClient({
      servers: {
        activeServerId: "host-1",
        supportsCapability: (_serverId, capability) => capability === TEAM_BROWSER_VIEW_CAPABILITY,
        openBrowserViewStream: () =>
          Effect.succeed({ sessionId: "view-1", url: "ws://127.0.0.1:1/stream", protocols: [] }),
        closeBrowserViewSession,
      },
      onEvent,
    });

    await runCauseEffect(client.start("tab-1"));
    last()?.dispatchEvent(new MessageEvent("message", { data: new ArrayBuffer(4) }));

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "stopped" })));
    expect(closeBrowserViewSession).toHaveBeenCalledWith("host-1", "view-1");
  });
});
