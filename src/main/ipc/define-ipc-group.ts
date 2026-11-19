import {
  IPC_ENDPOINTS,
  type IpcEndpointGroup,
  type IpcEndpoints,
  type RequestEndpoint,
  type Untyped,
} from "@openbot/contracts/ipc";
import type { IpcMainInvokeEvent } from "electron";
import {
  type AuthorizeSender,
  handleTrusted,
  handleTrustedWithEvent,
  type PayloadDecoder,
  type TakesEventOnly,
  type TakesNoArguments,
} from "../trusted-ipc";

declare const boundPayload: unique symbol;
declare const boundResult: unique symbol;

export interface BoundHandler<in out Payload, out Result> {
  (channel: string): void;
  readonly [boundPayload]?: (payload: Payload) => Payload;
  readonly [boundResult]?: Result;
}

type UntypedHandler = (channel: string) => void;

export function handler<Handler extends () => unknown>(
  implementation: Handler & TakesNoArguments<Handler>,
): BoundHandler<undefined, Awaited<ReturnType<Handler>>> {
  return (channel) => handleTrusted(channel, implementation);
}

export function payloadHandler<Payload, Result>(
  decode: PayloadDecoder<Payload>,
  implementation: (payload: Payload) => Result,
): BoundHandler<Payload, Awaited<Result>> {
  return (channel) => handleTrusted(channel, decode, implementation);
}

export function eventHandler<Handler extends (event: IpcMainInvokeEvent) => unknown>(
  implementation: Handler & TakesEventOnly<Handler>,
): BoundHandler<undefined, Awaited<ReturnType<Handler>>> {
  return (channel) => handleTrustedWithEvent(channel, implementation);
}

export function eventPayloadHandler<Payload, Result>(
  decode: PayloadDecoder<Payload>,
  implementation: (event: IpcMainInvokeEvent, payload: Payload) => Result,
): BoundHandler<Payload, Awaited<Result>> {
  return (channel) => handleTrustedWithEvent(channel, decode, implementation);
}

export function authorizedHandler<Payload, Result>(
  authorize: AuthorizeSender,
  decode: PayloadDecoder<Payload>,
  implementation: (event: IpcMainInvokeEvent, payload: Payload) => Result,
): BoundHandler<Payload, Awaited<Result>> {
  return (channel) => handleTrustedWithEvent(channel, authorize, decode, implementation);
}

type RequestKeys<Group extends IpcEndpointGroup> = {
  [Key in keyof Group]: Group[Key] extends RequestEndpoint ? Key : never;
}[keyof Group];

type HandlerFor<Endpoint> =
  Endpoint extends RequestEndpoint<string, infer Payload, infer Result>
    ? [Payload] extends [Untyped]
      ? UntypedHandler
      : BoundHandler<Payload, Result>
    : never;

export type GroupHandlers<Group extends IpcEndpointGroup> = {
  readonly [Key in RequestKeys<Group>]: HandlerFor<Group[Key]>;
};

export type IpcGroupHandlers = { readonly [Group in keyof IpcEndpoints]: GroupHandlers<IpcEndpoints[Group]> };

function bindGroup(group: IpcEndpointGroup, handlers: Readonly<Record<string, UntypedHandler>>): void {
  for (const [name, endpoint] of Object.entries(group)) {
    if (endpoint.kind !== "request") continue;
    const handler = handlers[name];
    if (!handler) throw new Error(`The IPC endpoint ${name} has no handler.`);
    handler(endpoint.channel);
  }
}

export function registerIpcGroup<Name extends keyof IpcEndpoints>(
  name: Name,
  handlers: GroupHandlers<IpcEndpoints[Name]>,
): void;
export function registerIpcGroup(name: string, handlers: Readonly<Record<string, UntypedHandler>>): void {
  const groups: Readonly<Record<string, IpcEndpointGroup | undefined>> = IPC_ENDPOINTS;
  const group = groups[name];
  if (!group) throw new Error(`The IPC group ${name} does not exist.`);
  bindGroup(group, handlers);
}

export function registerIpcGroups(handlers: IpcGroupHandlers): void;
export function registerIpcGroups(handlers: Readonly<Record<string, Readonly<Record<string, UntypedHandler>>>>): void {
  const groups: Readonly<Record<string, IpcEndpointGroup>> = IPC_ENDPOINTS;
  for (const [name, group] of Object.entries(groups)) {
    const groupHandlers = handlers[name];
    if (!groupHandlers) throw new Error(`The IPC group ${name} has no handlers.`);
    bindGroup(group, groupHandlers);
  }
}
