import { type NativeModule, requireOptionalNativeModule } from "expo";

export type ViewerProxyRequest = {
  requestId: string;
  method: string;
  target: string;
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
  start(token: string): Promise<number>;
  stop(): Promise<void>;
  respond(requestId: string, status: number, headers: Record<string, string>, bodyBase64: string): Promise<void>;
  socketSend(socketId: string, text: string | null, binaryBase64: string | null): Promise<void>;
  socketClose(socketId: string, code: number, reason: string): Promise<void>;
  setSecure(enabled: boolean): Promise<void>;
}

export const remoteViewerProxyNative = requireOptionalNativeModule<RemoteViewerProxyModule>("OpenBotRemoteViewerProxy");
