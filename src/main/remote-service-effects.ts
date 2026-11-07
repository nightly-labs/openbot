import { Context, type Effect, Layer, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { ResponseDecoder } from "./remote-host-decoding";
import type { RemoteRequestFn, RemoteRequestInit } from "./remote-server-client";

export class RemoteWorkflowError extends Schema.TaggedError<RemoteWorkflowError>()("RemoteWorkflowError", {
  cause: Schema.Defect(),
}) {}

/** A file download that reports its bytes. `size` is the size that the message names for the file. */
export interface RemoteFileProgress {
  size: number;
  onProgress: (received: number, total: number) => void;
}

export const { io: remoteCall, sync: remoteDecode, rewrap: toRemoteWorkflowError } = causeHelpers(RemoteWorkflowError);

export class RemoteRequest extends Context.Service<
  RemoteRequest,
  {
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  }
>()("openbot/main/RemoteRequest") {
  static layer(request: RemoteRequestFn) {
    return Layer.succeed(
      RemoteRequest,
      RemoteRequest.of({
        request,
      }),
    );
  }
}
