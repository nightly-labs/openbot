import { runCauseEffect } from "../../backend/effect-boundary";
import type { LinkAccountService } from "../link-account-service";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

export interface LinkAccountIpcDependencies {
  linkAccount: Pick<LinkAccountService, "status" | "connect" | "cancel" | "disconnect">;
}

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
