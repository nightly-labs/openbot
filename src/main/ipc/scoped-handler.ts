import type { AgentIpcRequest } from "@openbot/contracts/ipc";
import type { PayloadDecoder } from "../trusted-ipc";
import { agentRequest, agentScope } from "./agent-inputs";
import { type BoundHandler, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";

interface ScopedBranches<Payload, Result> {
  local: (payload: Payload) => Result | Promise<Result>;
  remote: (payload: Payload, serverId: string) => Result | Promise<Result>;
}

export function scopedHandler<Payload, Result>(
  decode: PayloadDecoder<Payload>,
  branches: ScopedBranches<Payload, Result>,
): BoundHandler<AgentIpcRequest<Payload>, Result> {
  return payloadHandler(agentRequest(decode), ({ serverId, payload }) =>
    routeToServer(serverId, {
      local: () => branches.local(payload),
      remote: (target) => branches.remote(payload, target),
    }),
  );
}

export function scopedQueryHandler<Result>(branches: {
  local: () => Result | Promise<Result>;
  remote: (serverId: string) => Result | Promise<Result>;
}): BoundHandler<AgentIpcRequest<null>, Result> {
  return payloadHandler(agentScope, ({ serverId }) => routeToServer(serverId, branches));
}
