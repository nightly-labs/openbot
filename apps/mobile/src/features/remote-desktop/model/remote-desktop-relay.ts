import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  decodeRemoteDesktopSignalBinary,
  decodeRemoteDesktopSignalControl,
  encodeRemoteDesktopSignalBinary,
  encodeRemoteDesktopSignalControl,
} from "@openbot/contracts/team-protocol/remote-stream-v1";
import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";

export type RemoteDesktopRelayCommand =
  | { type: "open"; streamId: string; path: string }
  | { type: "text"; streamId: string; data: string }
  | { type: "binary"; streamId: string; base64: string }
  | { type: "close"; streamId: string; code?: number; reason?: string };

export type RemoteDesktopRelayEvent =
  | { type: "opened"; streamId: string }
  | { type: "text"; streamId: string; data: string }
  | { type: "binary"; streamId: string; base64: string }
  | { type: "closed"; streamId: string; code: number; reason: string };

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

  const forward = (streamId: string, data: string | ArrayBuffer) => {
    void send(data).catch(() => closed(streamId, 1011, ""));
  };

  return {
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
      } catch {}
    },
    disconnect(reason: string | null) {
      for (const streamId of [...streams]) closed(streamId, 1011, reason ?? "");
    },
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
