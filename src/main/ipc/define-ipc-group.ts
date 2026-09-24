// Binding a group of endpoints to the implementations behind them.
//
// A registrar used to be a sequence of `handleTrusted(channel, ...)` calls, and nothing said
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
//
// A typed endpoint also fixes what its handler decodes and returns. The decoder's output must be the
// endpoint's payload type exactly, and the implementation's result must fit the endpoint's result.

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

// A bound handler is the registration itself, deferred until the channel is known. Keeping it a
// closure rather than a record of its parts is what lets each constructor call `handleTrusted` with
// its real decoder and its real payload type: a record would have to widen the decoder's result and
// the handler's parameter to `unknown` separately, and reuniting those two needs an assertion past
// the checker - inside the trust boundary's own binder, the last place worth one.
//
// The payload and result are phantom members, so the closure needs no assertion to become one. The
// payload is invariant: a decoder that accepts more or less than the contract is a type error.
declare const boundPayload: unique symbol;
declare const boundResult: unique symbol;

export interface BoundHandler<in out Payload, out Result> {
  (channel: string): void;
  readonly [boundPayload]?: (payload: Payload) => Payload;
  readonly [boundResult]?: Result;
}

/** What an endpoint of a group that is not typed yet accepts: any bound handler. */
type UntypedHandler = (channel: string) => void;

/** Takes nothing the renderer sent. */
export function handler<Handler extends () => unknown>(
  implementation: Handler & TakesNoArguments<Handler>,
): BoundHandler<undefined, Awaited<ReturnType<Handler>>> {
  return (channel) => handleTrusted(channel, implementation);
}

/** Takes a payload, which `decode` turns into the shape the implementation reads. */
export function payloadHandler<Payload, Result>(
  decode: PayloadDecoder<Payload>,
  implementation: (payload: Payload) => Result,
): BoundHandler<Payload, Awaited<Result>> {
  return (channel) => handleTrusted(channel, decode, implementation);
}

/** Needs the invoke event - to reach the calling frame's `sender`, or the window behind it. */
export function eventHandler<Handler extends (event: IpcMainInvokeEvent) => unknown>(
  implementation: Handler & TakesEventOnly<Handler>,
): BoundHandler<undefined, Awaited<ReturnType<Handler>>> {
  return (channel) => handleTrustedWithEvent(channel, implementation);
}

/**
 * Runs a sender-identity check the trusted-URL gate cannot make, before anything is decoded. Every
 * window of the app shares one origin, so a channel only some of them may use needs this.
 */
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

/** One implementation per request endpoint in the group - no more, no fewer. */
export type GroupHandlers<Group extends IpcEndpointGroup> = {
  readonly [Key in RequestKeys<Group>]: HandlerFor<Group[Key]>;
};

/** One `GroupHandlers` per group in `IPC_ENDPOINTS`. */
export type IpcGroupHandlers = { readonly [Group in keyof IpcEndpoints]: GroupHandlers<IpcEndpoints[Group]> };

function bindGroup(group: IpcEndpointGroup, handlers: Readonly<Record<string, UntypedHandler>>): void {
  for (const [name, endpoint] of Object.entries(group)) {
    if (endpoint.kind !== "request") continue;
    const handler = handlers[name];
    if (!handler) throw new Error(`The IPC endpoint ${name} has no handler.`);
    handler(endpoint.channel);
  }
}

/**
 * Registers one group, named rather than passed: a caller cannot hand this a group it made up, so no
 * channel outside `IPC_ENDPOINTS` can reach `ipcMain.handle` through here. The overload is what a
 * caller sees; the wider implementation signature is what lets the body index the manifest and the
 * handler object by name without asserting past the checker.
 */
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

/**
 * Registers every group at once. This is the call that makes the main side exhaustive: the parameter
 * is keyed by every group `IPC_ENDPOINTS` declares, so a new group with no registrar behind it fails
 * to compile at the one place that boots the app, and the diagnostic names the group.
 */
export function registerIpcGroups(handlers: IpcGroupHandlers): void;
export function registerIpcGroups(handlers: Readonly<Record<string, Readonly<Record<string, UntypedHandler>>>>): void {
  const groups: Readonly<Record<string, IpcEndpointGroup>> = IPC_ENDPOINTS;
  for (const [name, group] of Object.entries(groups)) {
    const groupHandlers = handlers[name];
    if (!groupHandlers) throw new Error(`The IPC group ${name} has no handlers.`);
    bindGroup(group, groupHandlers);
  }
}
