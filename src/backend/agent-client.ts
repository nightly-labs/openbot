import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder, RpcError } from "./protocol";

export type AgentProvider = AgentProviderId;

export interface AgentClient {
  readonly provider: AgentProvider;
  readonly running: boolean;
  start(): void;
  stop(): Promise<void>;
  /**
   * Closes the provider-side state of one thread and leaves the client running for the others.
   *
   * A refresh after an MCP change starts a replacement session for the same public thread. Without
   * this call the previous session stays open inside the client, and the MCP servers it spawned stay
   * alive with it, so each further change adds another set of processes - including the servers the
   * user turned off. Optional, because a client that keeps no per-thread state has nothing to close.
   */
  releaseThread?(externalThreadId: string): Promise<void>;
  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T>;
  notify(method: string, params?: unknown): void;
  respond(id: RequestId, result: unknown): void;
  respondError(id: RequestId, error: RpcError): void;
  on(event: "notification", listener: (notification: AppServerNotification) => void): this;
  on(event: "request", listener: (request: AppServerRequest) => void): this;
  on(event: "diagnostic", listener: (message: string) => void): this;
  once(event: "exit", listener: (error: Error) => void): this;
}
