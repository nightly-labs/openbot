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
import { describe, expect, it, vi } from "vitest";
import { createRemoteBrowserView } from "./browser-view";

const sessionId = "11111111-1111-4111-8111-111111111111";
const tabId = "22222222-2222-4222-8222-222222222222";
describe("remote browser view", () => {
  it("routes frames only to the current opened stream and closes the host session", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ id: sessionId, tabId, streamPath: browserViewStreamPath(sessionId) });
    const client = createRemoteBrowserView(send, request, () => false);
    const frame = vi.fn();
    const ended = vi.fn();
    const view = await client.open(tabId, frame, ended);
    const control = decodeRemoteDesktopSignalControl(send.mock.calls[0][0]);
    const bytes = encodeBrowserViewFrame({ sequence: 1, width: 10, height: 20, image: new Uint8Array([1, 2, 3]) });
    client.receive(encodeRemoteDesktopSignalBinary(control.streamId, bytes));
    expect(frame).not.toHaveBeenCalled();
    client.receive(encodeRemoteDesktopSignalControl({ type: "opened", streamId: control.streamId }));
    client.receive(encodeRemoteDesktopSignalBinary("other", bytes));
    expect(frame).not.toHaveBeenCalled();
    client.receive(encodeRemoteDesktopSignalBinary(control.streamId, bytes));
    expect(frame).toHaveBeenCalledWith({ sequence: 1, width: 10, height: 20, image: new Uint8Array([1, 2, 3]) });
    await view.close();
    expect(request).toHaveBeenLastCalledWith("DELETE", `/v1/browser/view/sessions/${sessionId}`);
    expect(ended).toHaveBeenCalledOnce();
    await expect(
      view.input({ type: "key", action: "down", key: "a", code: "KeyA", text: "", modifiers: 0 }),
    ).rejects.toThrow("not connected");
  });
  it("does not attach a view that finishes opening after disconnect", async () => {
    let finish: ((value: { id: string; tabId: string; streamPath: string }) => void) | undefined;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const client = createRemoteBrowserView(send, request, () => false);
    const opening = client.open(tabId, vi.fn(), vi.fn());
    const rejected = expect(opening).rejects.toThrow("view changed");
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    client.disconnect();
    finish?.({ id: sessionId, tabId, streamPath: browserViewStreamPath(sessionId) });
    await rejected;
    expect(send).not.toHaveBeenCalled();
    expect(request).toHaveBeenLastCalledWith("DELETE", `/v1/browser/view/sessions/${sessionId}`);
  });
  it("names frames only to a host that advertises frame points", async () => {
    const opened = async (namesFrames: boolean) => {
      const send = vi.fn().mockResolvedValue(undefined);
      const request = vi.fn().mockResolvedValue({ id: sessionId, tabId, streamPath: browserViewStreamPath(sessionId) });
      const client = createRemoteBrowserView(send, request, () => namesFrames);
      const view = await client.open(tabId, vi.fn(), vi.fn());
      const control = decodeRemoteDesktopSignalControl(send.mock.calls[0][0]);
      client.receive(encodeRemoteDesktopSignalControl({ type: "opened", streamId: control.streamId }));
      await view.input({ type: "ack", sequence: 3 });
      await view.input({
        type: "pointer",
        action: "down",
        x: 0.5,
        y: 0.5,
        sequence: 3,
        button: "left",
        clickCount: 1,
        deltaX: 0,
        deltaY: 0,
        modifiers: 0,
      });
      const inputs = send.mock.calls.slice(1).map(([data]) => {
        const text = decodeRemoteDesktopSignalControl(data);
        return text.type === "text" ? decodeBrowserViewInput(text.data) : undefined;
      });
      return { path: control.type === "open" ? control.path : undefined, inputs };
    };

    const older = await opened(false);
    expect(older.path).toBe(browserViewStreamPath(sessionId));
    expect(older.inputs).toEqual([expect.objectContaining({ type: "pointer", x: 0.5, y: 0.5 })]);
    expect(older.inputs[0]).not.toHaveProperty("sequence");

    const current = await opened(true);
    expect(current.path).toBe(`${browserViewStreamPath(sessionId)}?frameAck=1`);
    expect(current.inputs).toEqual([
      { type: "ack", sequence: 3 },
      expect.objectContaining({ type: "pointer", sequence: 3 }),
    ]);
  });
});
