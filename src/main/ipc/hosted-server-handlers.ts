import { Effect } from "effect";
// OpenBot servers that the account server runs for the signed-in account.

import {
  type CreateHostedServerInput,
  type DeleteHostedServerInput,
  parseCreateHostedServerInput,
  parseDeleteHostedServerInput,
} from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
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
      list: handler(() => Effect.runPromise(hostedServers.list().pipe(Effect.mapError((error) => error.cause)))),
      plans: handler(() => Effect.runPromise(hostedServers.plans().pipe(Effect.mapError((error) => error.cause)))),
      create: payloadHandler(parseCreate, (input) =>
        Effect.runPromise(hostedServers.create(input).pipe(Effect.mapError((error) => error.cause))),
      ),
      openCheckout: payloadHandler(
        (value) => requireString(value, "serverId", INPUT_LIMITS.identifier),
        (serverId) =>
          Effect.runPromise(hostedServers.openCheckout(serverId).pipe(Effect.mapError((error) => error.cause))),
      ),
      delete: payloadHandler(parseDelete, (input) =>
        Effect.runPromise(hostedServers.delete(input).pipe(Effect.mapError((error) => error.cause))),
      ),
      wake: payloadHandler(
        (value) => requireString(value, "serverId", INPUT_LIMITS.identifier),
        (serverId) => Effect.runPromise(hostedServers.wake(serverId).pipe(Effect.mapError((error) => error.cause))),
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
