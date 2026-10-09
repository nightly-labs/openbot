import {
  browserViewStreamPath,
  decodeBrowserViewInput,
  encodeBrowserViewFrame,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import {
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalBinary,
  encodeRemoteDesktopSignalControl,
} from "@openbot/contracts/team-protocol/remote-stream-v1";
import { assert, describe, expect, it, vi } from "vitest";
import { type BrowserViewBridgeEvent, createBrowserViewBridge } from "./browser-view-bridge";

// Failure modes:
// - every frame queues for the phone, so a slow phone shows the past and the host closes the view;
// - a frame that waited is never sent after the phone draws one, so the view stops moving;
// - the host forgets a frame the phone never drew, so a click on the screen is dropped;
// - an input the host would refuse reaches it, and the host closes the view;
// - an event of a closed view reaches the screen.

const sessionId = "11111111111141118111111111111111";
const tabId = "tab-1";

function frame(sequence: number) {
  return encodeBrowserViewFrame({ sequence, width: 1280, height: 800, image: new Uint8Array([0xff, 0xd8, sequence]) });
}

describe("the phone's live view bridge", () => {
  it("sends the phone only the newest frame after each drawn one, and names only drawn frames", async () => {
    const send = vi.fn<(data: string) => Promise<void>>().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ id: sessionId, tabId, streamPath: browserViewStreamPath(sessionId) });
    const events: BrowserViewBridgeEvent[] = [];
    const bridge = createBrowserViewBridge(send, request, (event) => events.push(event));
    bridge.command({
      type: "open",
      viewId: "view-1",
      tabId,
      namesFrames: true,
      cursor: true,
      clipboard: false,
      contextMenu: true,
      viewport: { width: 1280, height: 800 },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const open = decodeRemoteDesktopSignalControl(send.mock.calls[0]?.[0] ?? "");
    assert(open.type === "open");
    const query = new URL(open.path, "http://host").searchParams;
    expect([query.get("frameAck"), query.get("cursor"), query.get("menu"), query.get("viewport")]).toEqual([
      "1",
      "1",
      "1",
      "1280x800",
    ]);
    bridge.receive(encodeRemoteDesktopSignalControl({ type: "opened", streamId: open.streamId }));
    const sentInputs = () =>
      send.mock.calls.slice(1).map(([data]) => {
        const control = decodeRemoteDesktopSignalControl(data);
        assert(control.type === "text");
        return decodeBrowserViewInput(control.data);
      });

    for (const sequence of [1, 2, 3]) bridge.receive(encodeRemoteDesktopSignalBinary(open.streamId, frame(sequence)));
    expect(events.map((event) => (event.type === "frame" ? event.sequence : event.type))).toEqual([1]);
    bridge.command({ type: "frame-done", viewId: "view-1", sequence: 1, drawn: true });
    expect(events.map((event) => (event.type === "frame" ? event.sequence : event.type))).toEqual([1, 3]);
    bridge.command({ type: "frame-done", viewId: "view-1", sequence: 3, drawn: false });
    await vi.waitFor(() => expect(sentInputs()).toEqual([{ type: "ack", sequence: 1 }]));

    bridge.command({
      type: "input",
      viewId: "view-1",
      inputs: [
        { type: "pointer", action: "down", x: 2, y: 0.5, button: "left", clickCount: 1, modifiers: 0 },
        { type: "pointer", action: "down", x: 0.5, y: 0.5, sequence: 1, button: "left", clickCount: 1, modifiers: 0 },
      ],
    });
    await vi.waitFor(() => expect(sentInputs()).toHaveLength(2));
    expect(sentInputs()[1]).toMatchObject({ type: "pointer", x: 0.5, sequence: 1 });

    bridge.command({ type: "close", viewId: "view-1" });
    bridge.receive(encodeRemoteDesktopSignalBinary(open.streamId, frame(4)));
    await vi.waitFor(() =>
      expect(request).toHaveBeenLastCalledWith("DELETE", `/v1/browser/view/sessions/${sessionId}`),
    );
    expect(events).toHaveLength(2);
  });
});
