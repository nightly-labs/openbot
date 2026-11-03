// The Link account of this computer: connect with Link's device sign-in, cancel it, and disconnect.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { LinkAccountService } from "../link-account-service";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface LinkAccountIpcDependencies {
  linkAccount: Pick<LinkAccountService, "status" | "connect" | "cancel" | "disconnect">;
}

/** No endpoint takes a payload: the renderer cannot name a URL or a token. */
export function linkAccountIpcHandlers({
  linkAccount,
}: LinkAccountIpcDependencies): Pick<IpcGroupHandlers, "linkAccount"> {
  return {
    linkAccount: {
      status: handler(() => linkAccount.status()),
      connect: handler(() => runCauseEffect(linkAccount.connect())),
      cancel: handler(() => linkAccount.cancel()),
      disconnect: handler(() => runCauseEffect(linkAccount.disconnect())),
    },
  };
}
