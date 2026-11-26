import { readFileSync } from "node:fs";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../atomic-json-file";

const logger = createOpenBotLogger("messaging-status-posts");

const Target = Schema.Struct({ platformChannelId: Schema.String, replyThreadId: Schema.NullOr(Schema.String) });

const PendingFinal = Schema.Struct({
  answer: Schema.Boolean,
  text: Schema.String,
  reaction: Schema.NullOr(Schema.Literals(["done", "stopped", "failed"])),
  replacesAnswer: Schema.optional(Schema.Boolean),
});
export type PendingFinal = typeof PendingFinal.Type;

const StatusPost = Schema.Struct({
  connectionId: Schema.String,
  target: Target,
  messageId: Schema.NullOr(Schema.String),
  stopToken: Schema.NullOr(Schema.String),
  final: Schema.optional(PendingFinal),
});
export type StatusPost = typeof StatusPost.Type;

const StopButton = Schema.Struct({ linkId: Schema.String, authorId: Schema.String, connectionId: Schema.String });
export type StopButton = typeof StopButton.Type;

const StatusPostsFile = Schema.Struct({
  version: Schema.Literal(1),
  posts: Schema.Record(Schema.String, StatusPost),
  stops: Schema.Record(Schema.String, StopButton),
});
const decodeStatusPostsFile = Schema.decodeUnknownSync(StatusPostsFile);

export class MessagingStatusPosts {
  readonly posts = new Map<string, StatusPost>();
  readonly stops = new Map<string, StopButton>();
  readonly restored = new Set<string>();
  readonly #path: string | null;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(path: string | null) {
    this.#path = path;
  }

  load(connectionIds: ReadonlySet<string>): void {
    const path = this.#path;
    if (!path) return;
    let file: typeof StatusPostsFile.Type;
    try {
      file = decodeStatusPostsFile(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        logger.warn("The status posts of messaging conversations could not be read.");
      return;
    }
    for (const [key, post] of Object.entries(file.posts)) {
      if (!connectionIds.has(post.connectionId)) continue;
      this.posts.set(key, post);
      this.restored.add(key);
    }
    for (const [token, stop] of Object.entries(file.stops))
      if (connectionIds.has(stop.connectionId)) this.stops.set(token, stop);
  }

  readonly save = Effect.fn("MessagingStatusPosts.save")(function* (this: MessagingStatusPosts) {
    const path = this.#path;
    if (!path) return;
    yield* this.#writes.withPermit(
      Effect.suspend(() =>
        writeJsonFileAtomically(
          path,
          { version: 1, posts: Object.fromEntries(this.posts), stops: Object.fromEntries(this.stops) },
          { createDirectory: true },
        ),
      ).pipe(
        Effect.catch((failure) =>
          Effect.sync(() =>
            logger.warn("The status posts of messaging conversations could not be saved.", {
              operation: failure.operation,
            }),
          ),
        ),
      ),
    );
  });
}
