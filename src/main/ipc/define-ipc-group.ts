// Binding a group of endpoints to the implementations behind them.
//
// A registrar used to be a sequence of `handleTrusted(IPC_CHANNELS.x, ...)` calls, and nothing said
// the sequence was complete. A channel declared in `packages/contracts` and never registered
// compiled, shipped, and surfaced as "No handler registered for 'agent:list-models'" the first time
// a user opened the feature. A static scan of the source text was what noticed, which meant the
// check lived in a test that had to re-implement enough of the language to find the calls.
//
// Here a registrar hands back an object keyed by endpoint name instead. `GroupHandlers<G>` is a
// mapped type over the group's request endpoints, so a missing key is TS2741, a stray key is TS2353,
// and a renamed endpoint is both at once. The checker does the whole job, on the run that already
// checks everything else, and it names the endpoint in the diagnostic.
//
// Only request endpoints appear. An event travels main-to-renderer through `sendToRenderer` and has
// no handler to bind, so including it would ask every registrar for a key it cannot fill.

import { IPC_ENDPOINTS, type IpcEndpointGroup, type IpcEndpoints, type RequestEndpoint } from "@openbot/contracts/ipc";
import type { IpcMainInvokeEvent } from "electron";
import {
  type AuthorizeSender,
  handleTrusted,
  handleTrustedWithEvent,
  type PayloadDecoder,
  type TakesEventOnly,
  type TakesNoArguments,
} from "../trusted-ipc";

// A bound handler is the registration itself, deferred until the channel is known. Keeping it a
// closure rather than a record of its parts is what lets each constructor call `handleTrusted` with
// its real decoder and its real payload type: a record would have to widen the decoder's result and
// the handler's parameter to `unknown` separately, and reuniting those two needs an assertion past
// the checker - inside the trust boundary's own binder, the last place worth one.
export type BoundHandler = (channel: string) => void;

/** Takes nothing the renderer sent. */
export function handler<Handler extends () => unknown>(
  implementation: Handler & TakesNoArguments<Handler>,
): BoundHandler {
  return (channel) => handleTrusted(channel, implementation);
}

/** Takes a payload, which `decode` turns into the shape the implementation reads. */
export function payloadHandler<Payload>(
  decode: PayloadDecoder<Payload>,
  implementation: (payload: Payload) => unknown,
): BoundHandler {
  return (channel) => handleTrusted(channel, decode, implementation);
}

/** Needs the invoke event - to reach the calling frame's `sender`, or the window behind it. */
export function eventHandler<Handler extends (event: IpcMainInvokeEvent) => unknown>(
  implementation: Handler & TakesEventOnly<Handler>,
): BoundHandler {
  return (channel) => handleTrustedWithEvent(channel, implementation);
}

/**
 * Runs a sender-identity check the trusted-URL gate cannot make, before anything is decoded. Every
 * window of the app shares one origin, so a channel only some of them may use needs this.
 */
export function authorizedHandler<Payload>(
  authorize: AuthorizeSender,
  decode: PayloadDecoder<Payload>,
  implementation: (event: IpcMainInvokeEvent, payload: Payload) => unknown,
): BoundHandler {
  return (channel) => handleTrustedWithEvent(channel, authorize, decode, implementation);
}

type RequestKeys<Group extends IpcEndpointGroup> = {
  [Key in keyof Group]: Group[Key] extends RequestEndpoint ? Key : never;
}[keyof Group];

/** One implementation per request endpoint in the group - no more, no fewer. */
export type GroupHandlers<Group extends IpcEndpointGroup> = {
  readonly [Key in RequestKeys<Group>]: BoundHandler;
};

/** One `GroupHandlers` per group in `IPC_ENDPOINTS`. */
export type IpcGroupHandlers = { readonly [Group in keyof IpcEndpoints]: GroupHandlers<IpcEndpoints[Group]> };

function bindGroup(group: IpcEndpointGroup, handlers: Readonly<Record<string, BoundHandler>>): void {
  for (const [name, endpoint] of Object.entries(group)) {
    if (endpoint.kind !== "request") continue;
    handlers[name](endpoint.channel);
  }
}

/**
 * Registers one group. The overload is what a caller sees; the wider implementation signature is
 * what lets the body index the handler object by name without asserting past the checker.
 */
export function registerIpcGroup<Group extends IpcEndpointGroup>(group: Group, handlers: GroupHandlers<Group>): void;
export function registerIpcGroup(group: IpcEndpointGroup, handlers: Readonly<Record<string, BoundHandler>>): void {
  bindGroup(group, handlers);
}

/**
 * Registers every group at once. This is the call that makes the main side exhaustive: the parameter
 * is keyed by every group `IPC_ENDPOINTS` declares, so a new group with no registrar behind it fails
 * to compile at the one place that boots the app, and the diagnostic names the group.
 */
export function registerIpcGroups(handlers: IpcGroupHandlers): void;
export function registerIpcGroups(handlers: Readonly<Record<string, Readonly<Record<string, BoundHandler>>>>): void {
  const groups: Readonly<Record<string, IpcEndpointGroup>> = IPC_ENDPOINTS;
  for (const name of Object.keys(groups)) bindGroup(groups[name], handlers[name]);
}
