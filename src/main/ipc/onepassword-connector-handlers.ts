// The one 1Password connection of this computer: connect through the 1Password CLI or with a pasted
// service account token, cancel, and disconnect.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { OnePasswordConnectInput } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { OnePasswordConnectorService } from "../onepassword-connector-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { isObject, requireString, stringPayload } from "./validation";

/** A service account token is a few hundred characters; a much longer value is not one. */
const MAX_TOKEN_LENGTH = 4096;

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface OnePasswordConnectorIpcDependencies {
  onePasswordConnector: Pick<
    OnePasswordConnectorService,
    "status" | "checkSetup" | "installCli" | "openApp" | "connect" | "connectWithToken" | "cancel" | "disconnect"
  >;
}

function decodeConnectInput(value: unknown): OnePasswordConnectInput {
  if (!isObject(value)) throw new Error("Invalid 1Password connect input.");
  return {
    accountId: value.accountId === null ? null : requireString(value.accountId, "accountId", INPUT_LIMITS.identifier),
  };
}

/**
 * The renderer names an account from the list main gave it, or hands over a token once. It never
 * names a CLI path, a download, a vault or a command: main builds each `op` call and the install
 * from the release it pins.
 */
export function onePasswordConnectorIpcHandlers({
  onePasswordConnector,
}: OnePasswordConnectorIpcDependencies): Pick<IpcGroupHandlers, "onePasswordConnector"> {
  return {
    onePasswordConnector: {
      status: handler(() => onePasswordConnector.status()),
      checkSetup: handler(() => runCauseEffect(onePasswordConnector.checkSetup())),
      installCli: handler(() => runCauseEffect(onePasswordConnector.installCli())),
      openApp: handler(() => runCauseEffect(onePasswordConnector.openApp())),
      connect: payloadHandler(decodeConnectInput, (input) => runCauseEffect(onePasswordConnector.connect(input))),
      connectWithToken: payloadHandler(stringPayload("token", MAX_TOKEN_LENGTH), (token) =>
        runCauseEffect(onePasswordConnector.connectWithToken(token)),
      ),
      cancel: handler(() => onePasswordConnector.cancel()),
      disconnect: handler(() => runCauseEffect(onePasswordConnector.disconnect())),
    },
  };
}
