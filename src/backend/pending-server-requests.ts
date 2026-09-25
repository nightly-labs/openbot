import { randomUUID } from "node:crypto";
import type { AppServerRequest, RequestId, RpcError } from "./protocol";

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * The requests a provider client sends to OpenBot, such as an approval or a tool call, that wait for
 * `respond` or `respondError`. An answer to an id this table does not hold is ignored.
 */
export class PendingServerRequests {
  readonly #send: (request: AppServerRequest) => void;
  readonly #pending = new Map<RequestId, PendingServerRequest>();

  constructor(send: (request: AppServerRequest) => void) {
    this.#send = send;
  }

  call(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#send({ id, method, params });
    });
  }

  resolve(id: RequestId, result: unknown): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.resolve(result);
  }

  reject(id: RequestId, error: RpcError): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.reject(new Error(error.message));
  }

  /** Rejects every waiting request, because the client that sent them stopped. */
  rejectAll(message: string): void {
    for (const pending of this.#pending.values()) pending.reject(new Error(message));
    this.#pending.clear();
  }
}
