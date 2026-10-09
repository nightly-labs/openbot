import { runCauseEffect } from "../../backend/effect-boundary";
import type { BitwardenConnectorService } from "../bitwarden-connector-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface BitwardenConnectorIpcDependencies {
  bitwardenConnector: Pick<BitwardenConnectorService, "status" | "connect" | "disconnect">;
}

export function bitwardenConnectorIpcHandlers({
  bitwardenConnector,
}: BitwardenConnectorIpcDependencies): Pick<IpcGroupHandlers, "bitwardenConnector"> {
  return {
    bitwardenConnector: {
      status: handler(() => bitwardenConnector.status()),
      connect: payloadHandler(stringPayload("sessionKey", 4096), (key) =>
        runCauseEffect(bitwardenConnector.connect(key)),
      ),
      disconnect: handler(() => runCauseEffect(bitwardenConnector.disconnect())),
    },
  };
}
