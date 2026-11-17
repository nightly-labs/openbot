import { workflowGitHubRepositoryOwner } from "@openbot/contracts/ipc";
import {
  GITHUB_ROUTE_EXCLUDED_LIMIT,
  GITHUB_ROUTE_OWNERS_LIMIT,
  GITHUB_ROUTE_REPOSITORIES_LIMIT,
  type GitHubDeliveryStatus,
} from "@openbot/contracts/signal-protocol/github-route";
import { Effect, Result } from "effect";
import type { GitHubWatch } from "../backend/workflows/github-matching";
import type { WorkflowsHandle } from "../backend/workflows/workflows";
import type { CentralAuthOperationError } from "./central-auth-effects";
import type { GitHubRouteTicket, GitHubRouteTicketRepository } from "./central-auth-manager";
import { RemoteWorkflowError, toRemoteWorkflowError } from "./remote-service-effects";
import type { GitHubIngressDelivery, GitHubIngressHandler, SignalIngress } from "./signal-ingress";

interface GitHubRelayAccount {
  issueGitHubRoute(
    hostId: string,
    githubToken: string,
    watch: GitHubWatch,
  ): Effect.Effect<GitHubRouteTicket, CentralAuthOperationError>;
}

/** The parts of the ingress socket that the relay uses. */
export type GitHubRelayIngress = Pick<SignalIngress, "acquireGitHub" | "reconnect" | "githubReady" | "handleGitHub">;

export interface GitHubRelayOptions {
  account: GitHubRelayAccount;
  /** The GitHub sign-in of this computer, or null when GitHub is not connected. */
  githubToken(): Effect.Effect<string | null, unknown>;
  /** Set after construction: the ingress socket asks this relay for its GitHub route ticket. */
  ingress(): GitHubRelayIngress;
  /**
   * The repositories that the GitHub connection reaches now, as `owner/name`. While a trigger watches an
   * owner, the relay reads them at an interval, so a new repository of the owner gets events also on a
   * server where nobody opens the workflows.
   */
  reachableRepositories?(): Effect.Effect<readonly string[], unknown>;
  /** A watch list that the route cannot hold all of. */
  onTrimmed?(dropped: { repositories: number; owners: number; excluded: number }): void;
}

/** How often the relay reads the reachable repositories while a trigger watches an owner. */
const OWNER_CHECK_INTERVAL_MS = 30 * 60_000;
/** A repository that asked for a new ticket and is still not in it asks again after this time. */
const ASK_AGAIN_MS = 6 * 60 * 60_000;

const EMPTY_WATCH: GitHubWatch = { repositories: [], owners: [], excluded: [] };

/** The watch with each list in lower case, without repeats, sorted, and cut to the limits of the route. */
function routeWatch(watch: GitHubWatch): {
  watch: GitHubWatch;
  dropped: { repositories: number; owners: number; excluded: number };
} {
  const clean = (names: readonly string[]) => [...new Set(names.map((name) => name.toLowerCase()))].sort();
  const repositories = clean(watch.repositories);
  const owners = clean(watch.owners);
  const excluded = clean(watch.excluded);
  return {
    watch: {
      repositories: repositories.slice(0, GITHUB_ROUTE_REPOSITORIES_LIMIT),
      owners: owners.slice(0, GITHUB_ROUTE_OWNERS_LIMIT),
      excluded: excluded.slice(0, GITHUB_ROUTE_EXCLUDED_LIMIT),
    },
    dropped: {
      repositories: Math.max(repositories.length - GITHUB_ROUTE_REPOSITORIES_LIMIT, 0),
      owners: Math.max(owners.length - GITHUB_ROUTE_OWNERS_LIMIT, 0),
      excluded: Math.max(excluded.length - GITHUB_ROUTE_EXCLUDED_LIMIT, 0),
    },
  };
}

const watchKey = (watch: GitHubWatch) =>
  [watch.repositories.join(","), watch.owners.join(","), watch.excluded.join(",")].join("\n");

/**
 * Owns the GitHub hold on the ingress socket and what it watches. The watch comes from the saved GitHub
 * triggers; the account service confirms it with the GitHub sign-in each time the socket opens, and the
 * event bodies go only to this computer. For a watched owner, the account service names each repository
 * of the owner that the sign-in reaches, except the excluded ones. The relay sends no more than the route
 * holds, so a long list cannot make the account service refuse the whole route.
 */
export class GitHubRelay {
  readonly #options: GitHubRelayOptions;
  #watch: GitHubWatch = EMPTY_WATCH;
  #release: (() => void) | null = null;
  /** The repositories that the last ticket named, by lowercase `owner/name`. */
  #routed = new Map<string, GitHubRouteTicketRepository>();
  /** Repositories of a watched owner, by lowercase `owner/name`, that asked for a new ticket, and when. */
  #asked = new Map<string, number>();
  #ownerCheck: ReturnType<typeof setInterval> | null = null;

  constructor(options: GitHubRelayOptions) {
    this.#options = options;
  }

  /** Watches what the triggers watch. An empty watch releases the socket. */
  setWatch(watch: GitHubWatch): void {
    const { watch: next, dropped } = routeWatch(watch);
    if (dropped.repositories + dropped.owners + dropped.excluded > 0) this.#options.onTrimmed?.(dropped);
    const changed = watchKey(next) !== watchKey(this.#watch);
    this.#watch = next;
    this.#checkOwners(next.owners.length > 0);
    const ingress = this.#options.ingress();
    if (next.repositories.length === 0 && next.owners.length === 0) {
      this.#release?.();
      this.#release = null;
      this.#routed = new Map();
      this.#asked = new Map();
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

  /**
   * Tells the relay the repositories that the GitHub connection reaches now, as `owner/name`. A repository
   * of a watched owner that the last ticket did not name, such as one made after it, gets a new ticket.
   * A repository that asked and is still not named asks again only after `ASK_AGAIN_MS`, so one that the
   * account service leaves out does not reconnect the socket each time.
   */
  noticeRepositories(names: readonly string[], now = Date.now()): void {
    if (!this.#release || !this.connected() || this.#watch.owners.length === 0) return;
    const owners = new Set(this.#watch.owners);
    const excluded = new Set(this.#watch.excluded);
    let missing = false;
    for (const name of names) {
      const key = name.toLowerCase();
      if (!owners.has(workflowGitHubRepositoryOwner(key)) || excluded.has(key) || this.#routed.has(key)) continue;
      const asked = this.#asked.get(key);
      if (asked !== undefined && now - asked < ASK_AGAIN_MS) continue;
      this.#asked.set(key, now);
      missing = true;
    }
    if (missing) this.#options.ingress().reconnect();
  }

  handle(handler: GitHubIngressHandler | null): void {
    this.#options.ingress().handleGitHub(handler);
  }

  stop(): void {
    this.setWatch(EMPTY_WATCH);
    this.handle(null);
  }

  readonly issueRoute = Effect.fn("GitHubRelay.issueRoute")(function* (this: GitHubRelay, hostId: string) {
    const watch = this.#watch;
    const token = yield* this.#options
      .githubToken()
      .pipe(Effect.mapError((cause) => new RemoteWorkflowError({ cause })));
    if (!token) return yield* new RemoteWorkflowError({ cause: new Error("GitHub is not connected.") });
    const issued = yield* this.#options.account.issueGitHubRoute(hostId, token, watch).pipe(toRemoteWorkflowError);
    this.#routed = new Map(issued.repositories.map((repository) => [repository.fullName.toLowerCase(), repository]));
    // A repository that the new ticket names can ask again later, for example after it lost access.
    for (const name of this.#asked.keys()) if (this.#routed.has(name)) this.#asked.delete(name);
    return issued.ticket;
  }).bind(this);

  /** Starts or stops the interval that looks for new repositories of the watched owners. */
  #checkOwners(on: boolean): void {
    const read = this.#options.reachableRepositories;
    if (!on || !read) {
      if (this.#ownerCheck) clearInterval(this.#ownerCheck);
      this.#ownerCheck = null;
      return;
    }
    if (this.#ownerCheck) return;
    this.#ownerCheck = setInterval(() => {
      void Effect.runPromise(
        read().pipe(
          Effect.map((names) => this.noticeRepositories(names)),
          // The next interval tries again; the catalog reports its own failure.
          Effect.catch(() => Effect.void),
        ),
      );
    }, OWNER_CHECK_INTERVAL_MS);
    this.#ownerCheck.unref?.();
  }
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
