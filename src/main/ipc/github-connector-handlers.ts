import { Effect } from "effect";
// The one GitHub connection of this computer: sign in with a device code, list the repositories it
// reaches, and sign out.

import type { GitHubConnectorService } from "../github-connector-service";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

// Only the methods these endpoints call, so a test can pass a double without an assertion.
export interface GitHubConnectorIpcDependencies {
  githubConnector: Pick<
    GitHubConnectorService,
    "status" | "connect" | "cancel" | "disconnect" | "repositories" | "openVerification" | "openInstall"
  >;
}

/**
 * Seven endpoints, and none takes a payload: the renderer cannot name a URL, a Client ID or a token.
 * The main process builds each GitHub address from the app that this build ships with.
 */
export function githubConnectorIpcHandlers({
  githubConnector,
}: GitHubConnectorIpcDependencies): Pick<IpcGroupHandlers, "githubConnector"> {
  return {
    githubConnector: {
      status: handler(() => githubConnector.status()),
      connect: handler(() =>
        Effect.runPromise(githubConnector.connect().pipe(Effect.mapError((error) => error.cause))),
      ),
      cancel: handler(() => githubConnector.cancel()),
      disconnect: handler(() =>
        Effect.runPromise(githubConnector.disconnect().pipe(Effect.mapError((error) => error.cause))),
      ),
      repositories: handler(() =>
        Effect.runPromise(githubConnector.repositories().pipe(Effect.mapError((error) => error.cause))),
      ),
      openVerification: handler(() =>
        Effect.runPromise(githubConnector.openVerification().pipe(Effect.mapError((error) => error.cause))),
      ),
      openInstall: handler(() =>
        Effect.runPromise(githubConnector.openInstall().pipe(Effect.mapError((error) => error.cause))),
      ),
    },
  };
}
