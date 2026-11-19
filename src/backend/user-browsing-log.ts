import { rm } from "node:fs/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "./atomic-json-file";
import { readVersionedJsonFile, type VersionedJsonFormat } from "./versioned-json-store";

const logger = createOpenBotLogger("user-browsing");

export const USER_BROWSING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STEPS_PER_AGENT = 80;
export const USER_BROWSING_TEXT_CHARACTERS = 80;
const PATH_CHARACTERS = 120;

const Text = Schema.String.check(Schema.isMaxLength(PATH_CHARACTERS));
const StoredStep = Schema.Struct({
  at: Schema.Number,
  kind: Schema.Literals(["page", "click"]),
  host: Text,
  path: Text,
  title: Schema.optional(Text),
  role: Schema.optional(Text),
  name: Schema.optional(Text),
});

export type UserBrowsingStep = typeof StoredStep.Type;

const StoredLog = Schema.Struct({
  version: Schema.Literal(1),
  agents: Schema.Array(Schema.Struct({ agentId: Schema.String, steps: Schema.Array(StoredStep) })),
});
type StoredLog = typeof StoredLog.Type;
const USER_BROWSING_FORMAT: VersionedJsonFormat<StoredLog> = {
  current: 1,
  releases: { 1: Schema.decodeUnknownSync(StoredLog) },
};

export function stepText(text: string, limit = USER_BROWSING_TEXT_CHARACTERS): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function isCodeSegment(segment: string): boolean {
  if (segment.length >= 32) return true;
  if (!/\d/u.test(segment)) return false;
  return (
    /^[0-9a-f-]{8,}$/iu.test(segment) || (segment.length >= 16 && /[a-z]/iu.test(segment) && !/[-.]/u.test(segment))
  );
}

export function stepPlace(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
    const path = parsed.pathname
      .split("/")
      .map((segment) => (isCodeSegment(segment) ? ":id" : segment))
      .join("/");
    return { host: stepText(parsed.hostname, PATH_CHARACTERS), path: stepText(path, PATH_CHARACTERS) };
  } catch {
    return null;
  }
}

export class UserBrowsingLog {
  readonly #path: string;
  #writePath: string;
  readonly #now: () => number;
  readonly #steps = new Map<string, UserBrowsingStep[]>();
  readonly #writes = Semaphore.makeUnsafe(1);
  #loaded = false;

  constructor(path: string, now: () => number = Date.now) {
    this.#path = path;
    this.#writePath = path;
    this.#now = now;
  }

  load(): Effect.Effect<void> {
    if (this.#loaded) return Effect.void;
    return this.#writes
      .withPermit(this.#read())
      .pipe(Effect.andThen(Effect.suspend(() => (this.#prune() ? this.#write() : Effect.void))));
  }

  readonly #read = Effect.fn("UserBrowsingLog.read")(function* (this: UserBrowsingLog) {
    if (this.#loaded) return;
    this.#loaded = true;
    const loaded = yield* readVersionedJsonFile(this.#path, USER_BROWSING_FORMAT);
    this.#writePath = loaded.writePath;
    if (loaded.state === "damaged") logger.warn("The browsing steps are damaged. They start empty.");
    else if (loaded.state === "unreadable") logger.warn("Could not read the browsing steps.");
    else if (loaded.state === "kept") logger.warn("A newer version wrote the browsing steps file. It stays unchanged.");
    for (const agent of loaded.value?.agents ?? []) this.#steps.set(agent.agentId, [...agent.steps]);
  }).bind(this);

  record(agentId: string, step: Omit<UserBrowsingStep, "at">): Effect.Effect<void> {
    return this.#change(() => {
      const steps = this.#steps.get(agentId) ?? [];
      const last = steps.at(-1);
      if (step.kind === "page" && last?.kind === "page" && last.host === step.host && last.path === step.path) {
        if (step.title === undefined || last.title === step.title) return false;
        steps[steps.length - 1] = { ...last, title: step.title, at: this.#now() };
      } else steps.push({ ...step, at: this.#now() });
      this.#steps.set(agentId, steps.slice(-STEPS_PER_AGENT));
      return true;
    });
  }

  pending(agentId: string): Effect.Effect<readonly UserBrowsingStep[]> {
    return this.load().pipe(
      Effect.andThen(
        Effect.sync(() => {
          const since = this.#now() - USER_BROWSING_RETENTION_MS;
          return (this.#steps.get(agentId) ?? []).filter((step) => step.at > since);
        }),
      ),
    );
  }

  reviewed(agentId: string, through: number): Effect.Effect<void> {
    return this.#change(() => {
      const steps = this.#steps.get(agentId);
      if (!steps) return false;
      const kept = steps.filter((step) => step.at > through);
      if (kept.length === steps.length) return false;
      if (kept.length === 0) this.#steps.delete(agentId);
      else this.#steps.set(agentId, kept);
      return true;
    });
  }

  forgetAgent(agentId: string): Effect.Effect<void> {
    return this.#change(() => this.#steps.delete(agentId));
  }

  clear(): Effect.Effect<void> {
    return this.load().pipe(
      Effect.andThen(
        this.#writes.withPermit(
          Effect.uninterruptible(
            Effect.suspend(() => {
              this.#steps.clear();
              return Effect.tryPromise(() =>
                Promise.all([rm(this.#path, { force: true }), rm(this.#writePath, { force: true })]),
              );
            }),
          ),
        ),
      ),
      Effect.catch((failure) =>
        Effect.sync(() => logger.warn("Could not delete the browsing steps.", { error: failure })),
      ),
    );
  }

  #change(change: () => boolean): Effect.Effect<void> {
    return this.load().pipe(
      Effect.andThen(
        Effect.suspend(() => {
          const changed = change();
          const pruned = this.#prune();
          return changed || pruned ? this.#write() : Effect.void;
        }),
      ),
    );
  }

  #prune(): boolean {
    const since = this.#now() - USER_BROWSING_RETENTION_MS;
    let changed = false;
    for (const [agentId, steps] of this.#steps) {
      const kept = steps.filter((step) => step.at > since);
      if (kept.length === steps.length) continue;
      changed = true;
      if (kept.length === 0) this.#steps.delete(agentId);
      else this.#steps.set(agentId, kept);
    }
    return changed;
  }

  #write(): Effect.Effect<void> {
    return this.#writes
      .withPermit(
        Effect.uninterruptible(
          Effect.suspend(() => {
            const stored: StoredLog = {
              version: 1,
              agents: [...this.#steps].map(([agentId, steps]) => ({ agentId, steps })),
            };
            return writeJsonFileAtomically(this.#writePath, stored, { createDirectory: true });
          }),
        ),
      )
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => logger.warn("Could not save the browsing steps.", { error: failure.cause })),
        ),
      );
  }
}
