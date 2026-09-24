import type { EventEndpoint, Untyped } from "@openbot/contracts/ipc";

// A typed event takes its payload, or nothing when the payload is `undefined`. An event whose group is not
// typed yet takes anything, as every event did before endpoints had types. The payload comes from the
// endpoint alone: `NoInfer` keeps a wider argument from widening it.
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
