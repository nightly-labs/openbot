import type { WorkflowGitHubRelay } from "@openbot/contracts/ipc";
import type { GitHubDeliveryStatus } from "@openbot/contracts/signal-protocol/github-route";
import { Effect, Result } from "effect";
import type { WorkflowsHandle } from "../backend/workflows/workflows";
import type { CentralAuthOperationError } from "./central-auth-effects";
import type { GitHubRouteTicket, GitHubRouteTicketRepository } from "./central-auth-manager";
import { RemoteWorkflowError, toRemoteWorkflowError } from "./remote-service-effects";
import type { GitHubIngressDelivery, GitHubIngressHandler, SignalIngress } from "./signal-ingress";

interface GitHubRelayAccount {
  issueGitHubRoute(
    hostId: string,
    githubToken: string,
    repositories: readonly string[],
  ): Effect.Effect<GitHubRouteTicket, CentralAuthOperationError>;
}

export interface GitHubRelayOptions {
  account: GitHubRelayAccount;
  githubToken(): Effect.Effect<string | null, unknown>;
  ingress(): SignalIngress;
}

const ROUTE_REFRESH_MS = 30 * 60_000;

export class GitHubRelay {
  readonly #options: GitHubRelayOptions;
  #repositories: readonly string[] = [];
  #release: (() => void) | null = null;
  #routed = new Map<string, GitHubRouteTicketRepository>();
  #refreshedAt = Number.NEGATIVE_INFINITY;
  #refreshedFor = "";

  constructor(options: GitHubRelayOptions) {
    this.#options = options;
  }

  setRepositories(names: readonly string[]): void {
    const next = [...new Set(names.map((name) => name.toLowerCase()))].sort();
    const changed = next.join("\n") !== this.#repositories.join("\n");
    this.#repositories = next;
    const ingress = this.#options.ingress();
    if (next.length === 0) {
      this.#release?.();
      this.#release = null;
      this.#routed = new Map();
      return;
    }
    if (!this.#release) this.#release = ingress.acquireGitHub();
    else if (changed) ingress.reconnect();
  }

  connected(): boolean {
    return this.#options.ingress().githubReady();
  }

  routed(fullName: string): GitHubRouteTicketRepository | null {
    return this.#routed.get(fullName.toLowerCase()) ?? null;
  }

  status(visible: readonly string[]): WorkflowGitHubRelay {
    const ready = this.connected();
    const routed = [...this.#routed.keys()];
    const stale = [
      ...new Set(
        visible
          .map((name) => name.toLowerCase())
          .filter((key) => this.#repositories.includes(key) && !this.#routed.has(key)),
      ),
    ]
      .sort()
      .join("\n");
    const now = Date.now();
    if (ready && stale && (stale !== this.#refreshedFor || now - this.#refreshedAt >= ROUTE_REFRESH_MS)) {
      this.#refreshedFor = stale;
      this.#refreshedAt = now;
      this.#options.ingress().reconnect();
    }
    return { ready, watched: [...this.#repositories], routed };
  }

  handle(handler: GitHubIngressHandler | null): void {
    this.#options.ingress().handleGitHub(handler);
  }

  stop(): void {
    this.setRepositories([]);
    this.handle(null);
  }

  readonly issueRoute = Effect.fn("GitHubRelay.issueRoute")(function* (this: GitHubRelay, hostId: string) {
    const repositories = this.#repositories;
    const token = yield* this.#options
      .githubToken()
      .pipe(Effect.mapError((cause) => new RemoteWorkflowError({ cause })));
    if (!token) return yield* new RemoteWorkflowError({ cause: new Error("GitHub is not connected.") });
    const issued = yield* this.#options.account
      .issueGitHubRoute(hostId, token, repositories)
      .pipe(toRemoteWorkflowError);
    this.#routed = new Map(issued.repositories.map((repository) => [repository.fullName.toLowerCase(), repository]));
    return issued.ticket;
  }).bind(this);
}

export const receiveGitHubDelivery = Effect.fn("receiveGitHubDelivery")(function* (
  workflows: Pick<WorkflowsHandle, "receiveGitHub">,
  delivery: GitHubIngressDelivery,
) {
  const answer = (status: GitHubDeliveryStatus) => ({ status });
  const body = yield* Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(delivery.body)),
    catch: () => "invalid",
  }).pipe(Effect.result);
  if (Result.isFailure(body)) return answer(400);
  const result = yield* workflows.receiveGitHub({
    event: delivery.event,
    deliveryId: delivery.deliveryId,
    body: body.success,
  });
  return answer(result.kind === "saved" ? 202 : 404);
});
