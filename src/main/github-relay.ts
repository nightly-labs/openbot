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
  /** The GitHub sign-in of this computer, or null when GitHub is not connected. */
  githubToken(): Effect.Effect<string | null, unknown>;
  /** Set after construction: the ingress socket asks this relay for its GitHub route ticket. */
  ingress(): SignalIngress;
}

/**
 * Owns the GitHub hold on the ingress socket and the repositories that it watches. The repositories
 * come from the saved GitHub triggers; the account service confirms them with the GitHub sign-in each
 * time the socket opens, and the event bodies go only to this computer.
 */
export class GitHubRelay {
  readonly #options: GitHubRelayOptions;
  #repositories: readonly string[] = [];
  #release: (() => void) | null = null;
  /** The repositories that the last ticket named, by lowercase `owner/name`. */
  #routed = new Map<string, GitHubRouteTicketRepository>();

  constructor(options: GitHubRelayOptions) {
    this.#options = options;
  }

  /** Watches `names`, as `owner/name`. An empty list releases the socket. */
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

  /** True only after Signal confirms the GitHub route ticket on the open socket. */
  connected(): boolean {
    return this.#options.ingress().githubReady();
  }

  /** The repository that the last ticket named, or null when the GitHub sign-in cannot see it. */
  routed(fullName: string): GitHubRouteTicketRepository | null {
    return this.#routed.get(fullName.toLowerCase()) ?? null;
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

/**
 * Gives one relayed GitHub event to the workflows. 202: a trigger saved it; 404: no trigger watches
 * it; 400: the body is not JSON. A fault fails, and the ingress socket answers 503.
 */
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
