import { randomUUID } from "node:crypto";
import {
  type DeviceToolOperation,
  type DeviceToolRequest,
  type DeviceToolRequestedEvent,
  type DeviceToolResolvedEvent,
  type DeviceToolRespondRequest,
  type DeviceToolResults,
  decodeDeviceToolResult,
} from "@openbot/contracts/team-protocol/device-tools-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { Context, Deferred, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";

const logger = createOpenBotLogger("device-tool-service");

/** How long a request waits for the phone. The phone asks the user, so this is long. */
export const DEVICE_TOOL_DEADLINE_MS = 120_000;

export const DEVICE_TOOL_FAILURE_CODES = [
  "device_unavailable",
  "device_timeout",
  "app_not_allowed",
  "os_permission_denied",
  "invalid_arguments",
  "device_error",
  "device_request_closed",
] as const;
export type DeviceToolFailureCode = (typeof DEVICE_TOOL_FAILURE_CODES)[number];

/** The code is the whole error: it is the only text the model sees. It never holds arguments or results. */
export class DeviceToolFailed extends Schema.TaggedError<DeviceToolFailed>()("DeviceToolFailed", {
  code: Schema.Literals(DEVICE_TOOL_FAILURE_CODES),
}) {}

/** A member answered a request that another member owns. */
export class DeviceToolForbidden extends Schema.TaggedError<DeviceToolForbidden>()("DeviceToolForbidden", {}) {}

/** The Team API connections of the members. The Team API server implements it. */
export interface DeviceToolTransport {
  /** True while an event connection of the member has declared the `device-tools` capability. */
  hasDevice(memberId: string): boolean;
  /**
   * Sends the event to each such connection of that member only, except the connections of
   * `exceptSessionId`. Returns how many connections got it.
   */
  send(
    memberId: string,
    event: DeviceToolRequestedEvent | DeviceToolResolvedEvent,
    exceptSessionId?: string | null,
  ): number;
}

export interface DeviceToolCallInput {
  /** The member who owns the turn. The request goes to the phone of this member and no other. */
  memberId: string;
  agentId: string;
  turnId: string;
  request: DeviceToolRequest;
}

export interface DeviceToolServiceDependencies {
  /** A getter: the Team API server is built after the service. Null while there is none. */
  transport(): DeviceToolTransport | null;
  deadlineMs?: number;
  newRequestId?: () => string;
}

export interface DeviceToolServiceShape {
  /** True when the member has a connected phone that declared the capability. */
  available(memberId: string): boolean;
  call(input: DeviceToolCallInput): Effect.Effect<DeviceToolResults[DeviceToolOperation], DeviceToolFailed>;
  /**
   * The answer of a phone. The first answer wins. Fails with `device_request_closed` for an unknown or
   * closed request, `DeviceToolForbidden` for a request of another member, and `invalid_arguments` for
   * a result that does not fit the requested operation; that request then ends with `device_error`.
   */
  answer(
    memberId: string,
    answer: DeviceToolRespondRequest,
    sessionId?: string | null,
  ): Effect.Effect<void, DeviceToolFailed | DeviceToolForbidden>;
  /** Ends each open request of the turn. Called when a turn ends or stops. */
  cancelTurn(agentId: string, turnId: string): Effect.Effect<void>;
}

interface PendingRequest {
  memberId: string;
  agentId: string;
  turnId: string;
  operation: DeviceToolOperation;
  /** The session of the phone that answered first. It does not get `device-tool-resolved`. */
  answeredBy: string | null;
  deferred: Deferred.Deferred<DeviceToolResults[DeviceToolOperation], DeviceToolFailed>;
}

class DeviceToolServiceTag extends Context.Service<DeviceToolServiceTag, DeviceToolServiceShape>()(
  "openbot/backend/DeviceToolService",
) {
  static layer(dependencies: DeviceToolServiceDependencies) {
    return Layer.effect(
      DeviceToolServiceTag,
      Effect.gen(function* () {
        const deadlineMs = dependencies.deadlineMs ?? DEVICE_TOOL_DEADLINE_MS;
        const newRequestId = dependencies.newRequestId ?? randomUUID;
        const pending = new Map<string, PendingRequest>();
        let closed = false;

        const closeWith = (entry: PendingRequest, code: DeviceToolFailureCode) =>
          Deferred.doneUnsafe(entry.deferred, Effect.fail(new DeviceToolFailed({ code })));

        // Every open request ends when the service stops, so no tool call waits on a closed host.
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closed = true;
            for (const entry of pending.values()) closeWith(entry, "device_request_closed");
          }),
        );

        const available = (memberId: string) => !closed && dependencies.transport()?.hasDevice(memberId) === true;

        const call = Effect.fn("DeviceToolService.call")(function* (input: DeviceToolCallInput) {
          const transport = dependencies.transport();
          if (closed || !transport?.hasDevice(input.memberId))
            return yield* new DeviceToolFailed({ code: "device_unavailable" });
          const requestId = newRequestId();
          const startedAt = Date.now();
          const deferred = yield* Deferred.make<DeviceToolResults[DeviceToolOperation], DeviceToolFailed>();
          pending.set(requestId, {
            memberId: input.memberId,
            agentId: input.agentId,
            turnId: input.turnId,
            operation: input.request.operation,
            answeredBy: null,
            deferred,
          });
          // The request is closed on every exit: an answer, the deadline, a cancel, or the end of the turn.
          const close = Effect.sync(() => {
            const entry = pending.get(requestId);
            if (!entry || !pending.delete(requestId)) return;
            transport.send(input.memberId, { type: "device-tool-resolved", requestId }, entry.answeredBy);
          });
          // App, operation, code and duration only: never arguments or results.
          const ended = (code: string) =>
            logger.info("A device tool call ended.", {
              app: input.request.app,
              operation: input.request.operation,
              code,
              durationMs: Date.now() - startedAt,
            });
          return yield* Effect.gen(function* () {
            // Type and id come last: the request value may carry the placeholders of the parser.
            const delivered = transport.send(input.memberId, {
              ...input.request,
              type: "device-tool-requested",
              requestId,
            });
            if (delivered === 0) return yield* new DeviceToolFailed({ code: "device_unavailable" });
            return yield* Deferred.await(deferred).pipe(
              Effect.timeoutOrElse({
                duration: deadlineMs,
                orElse: () => Effect.fail(new DeviceToolFailed({ code: "device_timeout" })),
              }),
            );
          }).pipe(
            Effect.tap(() => Effect.sync(() => ended("ok"))),
            Effect.tapError((failure) => Effect.sync(() => ended(failure.code))),
            Effect.onInterrupt(() => Effect.sync(() => ended("interrupted"))),
            Effect.ensuring(close),
          );
        });

        const answer = Effect.fn("DeviceToolService.answer")(function* (
          memberId: string,
          reply: DeviceToolRespondRequest,
          sessionId: string | null = null,
        ) {
          const entry = pending.get(reply.requestId);
          if (!entry) return yield* new DeviceToolFailed({ code: "device_request_closed" });
          if (entry.memberId !== memberId) return yield* new DeviceToolForbidden();
          // Set before the answer completes the request, so the close that follows reads it.
          if (!Deferred.isDoneUnsafe(entry.deferred)) entry.answeredBy = sessionId;
          if (!reply.ok) {
            // A false return means another phone answered first.
            if (!Deferred.doneUnsafe(entry.deferred, Effect.fail(new DeviceToolFailed({ code: reply.code }))))
              return yield* new DeviceToolFailed({ code: "device_request_closed" });
            return;
          }
          // The route codec cannot bind the operation, so the result is decoded against the pending one.
          const decoded = yield* Effect.try({
            try: () => decodeDeviceToolResult(entry.operation, reply.result),
            catch: () => new DeviceToolFailed({ code: "invalid_arguments" }),
          }).pipe(Effect.tapError(() => Effect.sync(() => closeWith(entry, "device_error"))));
          if (!Deferred.doneUnsafe(entry.deferred, Effect.succeed(decoded)))
            return yield* new DeviceToolFailed({ code: "device_request_closed" });
        });

        const cancelTurn = (agentId: string, turnId: string) =>
          Effect.sync(() => {
            for (const entry of pending.values())
              if (entry.agentId === agentId && entry.turnId === turnId) closeWith(entry, "device_request_closed");
          });

        return { available, call, answer, cancelTurn } satisfies DeviceToolServiceShape;
      }),
    );
  }
}

export interface DeviceToolServiceHandle extends DeviceToolServiceShape {
  close(): Effect.Effect<void>;
}

/** Starts the service on its own runtime. `close` ends every open request and stops the service. */
export const createDeviceToolService = Effect.fn("createDeviceToolService")(function* (
  dependencies: DeviceToolServiceDependencies,
) {
  const runtime = ManagedRuntime.make(DeviceToolServiceTag.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  const service = Context.get(context, DeviceToolServiceTag);
  return { ...service, close: () => runtime.disposeEffect } satisfies DeviceToolServiceHandle;
});
