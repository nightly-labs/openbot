import { errorReference, referenceCarrierName } from "@openbot/user-errors";
import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { isTrustedRendererUrl } from "./trusted-renderer";

export type PayloadDecoder<Payload> = (value: unknown) => Payload;

type TrustedRegistration =
  | [handler: () => unknown]
  | [decode: PayloadDecoder<unknown>, handler: (payload: unknown) => unknown];

type ArityMessage = "this handler takes a payload, so it must be registered with a decoder for it";

export type TakesNoArguments<Handler> = Handler extends (...args: infer Args) => unknown
  ? Args["length"] extends 0
    ? unknown
    : ArityMessage
  : never;

export type AuthorizeSender = (event: IpcMainInvokeEvent) => void;

export type TakesEventOnly<Handler> = Handler extends (...args: infer Args) => unknown
  ? Args["length"] extends 0 | 1
    ? unknown
    : ArityMessage
  : never;

type TrustedEventRegistration =
  | [handler: (event: IpcMainInvokeEvent) => unknown]
  | [decode: PayloadDecoder<unknown>, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown]
  | [
      authorize: AuthorizeSender,
      decode: PayloadDecoder<unknown>,
      handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown,
    ];

export interface IpcCallRecord {
  name: string;
  durationMs: number;
  outcome: "ok" | "error";
}

let ipcCallObserver: ((call: IpcCallRecord) => void) | null = null;

export function setIpcCallObserver(observer: ((call: IpcCallRecord) => void) | null): void {
  ipcCallObserver = observer;
}

function observeCall<Result>(channel: string, run: () => Result): Result {
  const observer = ipcCallObserver;
  if (!observer) return run();
  const startedAt = performance.now();
  const finish = (outcome: IpcCallRecord["outcome"]) =>
    observer({ name: channel, durationMs: performance.now() - startedAt, outcome });
  let result: Result;
  try {
    result = run();
  } catch (error) {
    finish("error");
    throw error;
  }
  if (!(result instanceof Promise)) {
    finish("ok");
    return result;
  }
  void result.then(
    () => finish("ok"),
    () => finish("error"),
  );
  return result;
}

const RUNTIME_ERRORS = [TypeError, SyntaxError, ReferenceError, RangeError];

function withReference(error: Error): Error {
  if (RUNTIME_ERRORS.some((type) => error instanceof type)) return error;
  const reference = errorReference(error);
  if (!reference) return error;
  const carried = new Error(error.message, { cause: error });
  carried.name = referenceCarrierName(reference);
  return carried;
}

function carryReference<Result>(run: () => Result): Result | Promise<Awaited<Result>> {
  let result: Result;
  try {
    result = run();
  } catch (error) {
    throw error instanceof Error ? withReference(error) : error;
  }
  if (!(result instanceof Promise)) return result;
  return result.catch((error: unknown) => {
    throw error instanceof Error ? withReference(error) : error;
  });
}

export function handleTrusted<Handler extends () => unknown>(
  channel: string,
  handler: Handler & TakesNoArguments<Handler>,
): void;
export function handleTrusted<Payload, Result>(
  channel: string,
  decode: PayloadDecoder<Payload>,
  handler: (payload: Payload) => Result,
): void;
export function handleTrusted(channel: string, ...registration: TrustedRegistration): void {
  ipcMain.handle(channel, (event, payload: unknown) => {
    if (!isTrustedRendererUrl(event.senderFrame?.url)) {
      throw new Error("Rejected IPC request from an untrusted renderer.");
    }
    return carryReference(() =>
      observeCall(channel, () => {
        if (registration.length === 1) return registration[0]();
        const [decode, handler] = registration;
        return handler(decode(payload));
      }),
    );
  });
}

export function handleTrustedWithEvent<Handler extends (event: IpcMainInvokeEvent) => unknown>(
  channel: string,
  handler: Handler & TakesEventOnly<Handler>,
): void;
export function handleTrustedWithEvent<Payload, Result>(
  channel: string,
  decode: PayloadDecoder<Payload>,
  handler: (event: IpcMainInvokeEvent, payload: Payload) => Result,
): void;
export function handleTrustedWithEvent<Payload, Result>(
  channel: string,
  authorize: AuthorizeSender,
  decode: PayloadDecoder<Payload>,
  handler: (event: IpcMainInvokeEvent, payload: Payload) => Result,
): void;
export function handleTrustedWithEvent(channel: string, ...registration: TrustedEventRegistration): void {
  ipcMain.handle(channel, (event, payload: unknown) => {
    if (!isTrustedRendererUrl(event.senderFrame?.url)) {
      throw new Error("Rejected IPC request from an untrusted renderer.");
    }
    return carryReference(() =>
      observeCall(channel, () => {
        if (registration.length === 1) return registration[0](event);
        if (registration.length === 2) {
          const [decode, handler] = registration;
          return handler(event, decode(payload));
        }
        const [authorize, decode, handler] = registration;
        authorize(event);
        return handler(event, decode(payload));
      }),
    );
  });
}
