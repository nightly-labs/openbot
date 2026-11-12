import { type NativeModule, requireOptionalNativeModule } from "expo";

/** A request of the viewer page. `target` is the path and query, with the proxy's token first. */
export type ViewerProxyRequest = {
  requestId: string;
  method: string;
  target: string;
  /** Names in lower case. */
  headers: Record<string, string>;
  bodyBase64: string;
};

type ViewerProxyEvents = {
  onRequest: (event: ViewerProxyRequest) => void;
  onSocketOpen: (event: { socketId: string; target: string }) => void;
  onSocketMessage: (event: { socketId: string; text?: string; binaryBase64?: string }) => void;
  onSocketClose: (event: { socketId: string; code: number; reason: string }) => void;
};

declare class RemoteViewerProxyModule extends NativeModule<ViewerProxyEvents> {
  /** Listens on 127.0.0.1 only, and answers 404 to a path without the token. Resolves with the port. */
  start(token: string): Promise<number>;
  stop(): Promise<void>;
  respond(requestId: string, status: number, headers: Record<string, string>, bodyBase64: string): Promise<void>;
  socketSend(socketId: string, text: string | null, binaryBase64: string | null): Promise<void>;
  socketClose(socketId: string, code: number, reason: string): Promise<void>;
  /** Android: no screenshots or screen recording of the app while it is set. iOS: nothing. */
  setSecure(enabled: boolean): Promise<void>;
}

/** `modules/remote-viewer-proxy`. Null in a build without it, such as Expo Go: the phone then cannot show a remote desktop. */
export const remoteViewerProxyNative = requireOptionalNativeModule<RemoteViewerProxyModule>("OpenBotRemoteViewerProxy");
