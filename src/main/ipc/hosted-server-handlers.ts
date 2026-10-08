// OpenBot servers that the account server runs for the signed-in account.

import {
  type CreateHostedServerInput,
  type DeleteHostedServerInput,
  parseCreateHostedServerInput,
  parseDeleteHostedServerInput,
  parseHostedServerLifecycleInput,
} from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { HostedServerDesktopService } from "../hosted-server-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { requireString } from "./validation";

export interface HostedServerIpcDependencies {
  hostedServers: HostedServerDesktopService;
}

export function hostedServerIpcHandlers({
  hostedServers,
}: HostedServerIpcDependencies): Pick<IpcGroupHandlers, "hostedServers"> {
  return {
    hostedServers: {
      lifecycle: payloadHandler(
        (value) => {
          const input = parseHostedServerLifecycleInput(value);
          if (!input) throw new Error("Invalid hosted server lifecycle request.");
          return input;
        },
        (input) => runCauseEffect(hostedServers.lifecycle(input)),
      ),
      list: handler(() => runCauseEffect(hostedServers.list())),
      plans: handler(() => runCauseEffect(hostedServers.plans())),
      create: payloadHandler(parseCreate, (input) => runCauseEffect(hostedServers.create(input))),
      openCheckout: payloadHandler(
        (value) => requireString(value, "serverId", INPUT_LIMITS.identifier),
        (serverId) => runCauseEffect(hostedServers.openCheckout(serverId)),
      ),
      delete: payloadHandler(parseDelete, (input) => runCauseEffect(hostedServers.delete(input))),
      wake: payloadHandler(
        (value) => requireString(value, "serverId", INPUT_LIMITS.identifier),
        (serverId) => runCauseEffect(hostedServers.wake(serverId)),
      ),
    },
  };
}

function parseCreate(value: unknown): CreateHostedServerInput {
  const input = parseCreateHostedServerInput(value);
  if (!input) throw new Error("Invalid hosted server.");
  return input;
}

function parseDelete(value: unknown): DeleteHostedServerInput {
  const input = parseDeleteHostedServerInput(value);
  if (!input) throw new Error("Invalid hosted server deletion.");
  return input;
}
