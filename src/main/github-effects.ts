import { Context, type Effect, Layer, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class GitHubOperationError extends Schema.TaggedError<GitHubOperationError>()("GitHubOperationError", {
  cause: Schema.Defect(),
}) {}

export const {
  io: githubCall,
  sync: githubDecode,
  rewrap: toGitHubOperationError,
} = causeHelpers(GitHubOperationError);

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
