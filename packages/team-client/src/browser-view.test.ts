import { browserViewStreamPath, encodeBrowserViewFrame } from "@openbot/contracts/team-protocol/browser-view-v1";
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
    const client = createRemoteBrowserView(send, request);
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
    const client = createRemoteBrowserView(send, request);
    const opening = client.open(tabId, vi.fn(), vi.fn());
    const rejected = expect(opening).rejects.toThrow("view changed");
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    client.disconnect();
    finish?.({ id: sessionId, tabId, streamPath: browserViewStreamPath(sessionId) });
    await rejected;
    expect(send).not.toHaveBeenCalled();
    expect(request).toHaveBeenLastCalledWith("DELETE", `/v1/browser/view/sessions/${sessionId}`);
  });
});
