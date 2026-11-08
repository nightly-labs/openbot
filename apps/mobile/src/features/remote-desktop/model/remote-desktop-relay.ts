import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalBinary,
  encodeRemoteDesktopSignalControl,
} from "@openbot/contracts/team-protocol/remote-stream-v1";
import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";

// The remote desktop viewer's sockets, in the hidden page that holds the Team peer. The viewer runs
// in its own web view and reaches the host through the app's loopback proxy. Its page files go as
// Team API requests; its signaling socket goes here, over the peer's desktop channel, as the desktop
// app's `RemoteViewerProxy` sends it. The video does not: the viewer makes its own WebRTC connection.

/** What the native screen tells the peer page about one viewer socket. */
export type RemoteDesktopRelayCommand =
  | { type: "open"; streamId: string; path: string }
  | { type: "text"; streamId: string; data: string }
  | { type: "binary"; streamId: string; base64: string }
  | { type: "close"; streamId: string; code?: number; reason?: string };

/** What the peer page tells the native screen. `closed` comes once, also when the connection is lost. */
export type RemoteDesktopRelayEvent =
  | { type: "opened"; streamId: string }
  | { type: "text"; streamId: string; data: string }
  | { type: "binary"; streamId: string; base64: string }
  | { type: "closed"; streamId: string; code: number; reason: string };

/** The host lets the tunnel open only the stream socket of a remote screen session. */
const STREAM_PATH = /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/stream$/u;
const STREAM_ID = /^[A-Za-z0-9_-]{1,64}$/u;

export function createRemoteDesktopRelay(
  send: (data: string | ArrayBuffer) => Promise<void>,
  emit: (event: RemoteDesktopRelayEvent) => void,
) {
  const streams = new Set<string>();

  const closed = (streamId: string, code: number, reason: string) => {
    if (!streams.delete(streamId)) return;
    emit({ type: "closed", streamId, code, reason });
  };

  // A send that fails ends its socket. The viewer opens a new one when it needs it.
  const forward = (streamId: string, data: string | ArrayBuffer) => {
    void send(data).catch(() => closed(streamId, 1011, ""));
  };

  return {
    /** A frame of the desktop channel. Frames of other streams, such as a browser view, are left alone. */
    receive(data: string | ArrayBuffer) {
      try {
        if (!isString(data)) {
          const frame = decodeRemoteDesktopSignalBinary(data);
          if (streams.has(frame.streamId))
            emit({ type: "binary", streamId: frame.streamId, base64: bytesToBase64(frame.bytes) });
          return;
        }
        const control = decodeRemoteDesktopSignalControl(data);
        if (!streams.has(control.streamId)) return;
        if (control.type === "opened") emit({ type: "opened", streamId: control.streamId });
        else if (control.type === "text") emit({ type: "text", streamId: control.streamId, data: control.data });
        else if (control.type === "close") closed(control.streamId, control.code ?? 1000, control.reason ?? "");
        else if (control.type === "error") closed(control.streamId, 1011, control.message);
      } catch {
        // A malformed optional desktop frame cannot affect the Team API channels.
      }
    },
    /** The connection is gone, so each open socket ends. */
    disconnect(reason: string | null) {
      for (const streamId of [...streams]) closed(streamId, 1011, reason ?? "");
    },
    /** A command from the native screen. It crossed the bridge as JSON, so each field is read here. */
    command(value: unknown) {
      if (!isDynamicRecord(value) || !isString(value.streamId) || !STREAM_ID.test(value.streamId)) return;
      const streamId = value.streamId;
      if (value.type === "open" && isString(value.path) && STREAM_PATH.test(value.path)) {
        if (streams.has(streamId)) return;
        streams.add(streamId);
        forward(streamId, encodeRemoteDesktopSignalControl({ type: "open", streamId, path: value.path }));
        return;
      }
      if (!streams.has(streamId)) return;
      if (value.type === "text" && isString(value.data)) {
        forward(streamId, encodeRemoteDesktopSignalControl({ type: "text", streamId, data: value.data }));
      } else if (value.type === "binary" && isString(value.base64)) {
        try {
          forward(streamId, encodeRemoteDesktopSignalBinary(streamId, base64ToBytes(value.base64)));
        } catch {
          closed(streamId, 1009, "");
        }
      } else if (value.type === "close") {
        streams.delete(streamId);
        const code = isNumber(value.code) && Number.isInteger(value.code) ? value.code : 1000;
        const reason = isString(value.reason) ? value.reason.slice(0, 123) : "";
        void send(encodeRemoteDesktopSignalControl({ type: "close", streamId, code, reason })).catch(() => undefined);
      }
    },
  };
}
