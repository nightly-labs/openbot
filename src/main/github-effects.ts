import { Context, Effect, Layer, Schema } from "effect";

/** Adapter failure retains the original error for the native boundary. */
export class GitHubOperationError extends Schema.TaggedError<GitHubOperationError>()("GitHubOperationError", {
  cause: Schema.Defect(),
}) {}

export const githubCall = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => new GitHubOperationError({ cause }) });
export const githubDecode = <A>(operation: () => A) =>
  Effect.try({ try: operation, catch: (cause) => new GitHubOperationError({ cause }) });

/** Actual injected network and desktop navigation capabilities. */
export class GitHubPlatform extends Context.Service<
  GitHubPlatform,
  {
    fetch(url: string, init: RequestInit): Effect.Effect<Response, GitHubOperationError>;
    openPage(url: string): Effect.Effect<void, GitHubOperationError>;
  }
>()("openbot/main/GitHubPlatform") {
  static layer(
    fetcher: (url: string, init: RequestInit) => Promise<Response>,
    openPage: (url: string) => Promise<void>,
  ) {
    return Layer.succeed(
      GitHubPlatform,
      GitHubPlatform.of({
        fetch: (url, init) =>
          githubCall((signal) =>
            fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal }),
          ),
        openPage: (url) => githubCall(() => openPage(url)),
      }),
    );
  }
}
