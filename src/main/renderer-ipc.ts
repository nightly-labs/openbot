import type { EventEndpoint, Untyped } from "@openbot/contracts/ipc";
import { perfIpcSend } from "../backend/perf-probe-hooks";

type EventArgs<Payload> = [Payload] extends [Untyped]
  ? unknown[]
  : [Payload] extends [undefined]
    ? []
    : [payload: Payload];

export interface RendererIpcWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    isLoadingMainFrame(): boolean;
    mainFrame: {
      isDestroyed(): boolean;
      readonly detached: boolean;
    };
    send(channel: string, ...args: unknown[]): void;
  };
}

export function sendToRenderer<Payload>(
  window: RendererIpcWindow | null | undefined,
  endpoint: EventEndpoint<string, Payload>,
  ...args: EventArgs<NoInfer<Payload>>
): boolean {
  if (!window || window.isDestroyed()) return false;

  try {
    const contents = window.webContents;
    if (contents.isDestroyed() || contents.isLoadingMainFrame()) return false;
    const frame = contents.mainFrame;
    if (frame.isDestroyed() || frame.detached) return false;
    contents.send(endpoint.channel, ...args);
    perfIpcSend(contents, endpoint.channel, args);
    return true;
  } catch (error) {
    if (isUnavailableRendererError(error)) return false;
    throw error;
  }
}

function isUnavailableRendererError(error: unknown): boolean {
  if (error instanceof Error && "code" in error && (error.code === "EIO" || error.code === "EPIPE")) return true;
  if (!(error instanceof Error)) return false;
  return /Render frame was disposed|Object has been destroyed|WebContents (?:was|is) destroyed/u.test(error.message);
}
