import type { EventChannel, EventPayloadOf, Untyped } from "@openbot/contracts/ipc";

// A typed event takes its payload, or nothing when the payload is `undefined`. An event whose group is not
// typed yet takes anything, as every event did before endpoints had types.
type EventArgs<Channel extends EventChannel> = [EventPayloadOf<Channel>] extends [Untyped]
  ? unknown[]
  : [EventPayloadOf<Channel>] extends [undefined]
    ? []
    : [payload: EventPayloadOf<Channel>];

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

export function sendToRenderer<Channel extends EventChannel>(
  window: RendererIpcWindow | null | undefined,
  channel: Channel,
  ...args: EventArgs<Channel>
): boolean {
  if (!window || window.isDestroyed()) return false;

  try {
    const contents = window.webContents;
    if (contents.isDestroyed() || contents.isLoadingMainFrame()) return false;
    const frame = contents.mainFrame;
    if (frame.isDestroyed() || frame.detached) return false;
    contents.send(channel, ...args);
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
