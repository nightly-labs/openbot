import { readFile } from "node:fs/promises";
import type { CustomAgentEnvInput, CustomAgentSummary, SaveCustomAgentInput } from "@openbot/contracts/ipc";
import { CUSTOM_AGENT_LIMITS, isCustomAgentUsagePrompt } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import { z } from "zod";
import { resolveAgentCommand } from "../backend/acp-agent-command";
import { writeFileAtomically } from "../backend/atomic-json-file";
import type { CustomAgentConfig } from "../backend/custom-acp-agents-client";
import { causeHelpers } from "../backend/effect-boundary";
import type { CustomProviderCipher } from "./custom-provider-store";

export class CustomAgentFailure extends Schema.TaggedError<CustomAgentFailure>()("CustomAgentFailure", {
  cause: Schema.Defect(),
}) {}

const { io: agentIO, sync: agentSync, rewrap: toCustomAgentFailure } = causeHelpers(CustomAgentFailure);
export const CUSTOM_AGENTS_FILE = "custom-agents.json";

const entrySchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  envNames: z.array(z.string()),
  usagePrompt: z
    .string()
    .nullish()
    .transform((value) => (value && isCustomAgentUsagePrompt(value.trim()) ? value.trim() : null)),
  secret: z.string().nullish(),
});

const fileSchema = z.object({ version: z.literal(1), agents: z.array(entrySchema) });
const secretSchema = z.object({ values: z.record(z.string(), z.string()) });

type StoredEntry = z.infer<typeof entrySchema>;
type AgentFile = z.infer<typeof fileSchema>;

interface Entry {
  readonly stored: StoredEntry;
  readonly values: Readonly<Record<string, string>> | null;
}

const READ_ONLY_MESSAGE = sourceText("error.provider.customAgentsReadOnly");
const NO_SECURE_STORAGE_MESSAGE = sourceText("error.provider.customAgentNoSecureStorage");

export class CustomAgentStore {
  readonly #path: string;
  readonly #cipher: CustomProviderCipher;
  readonly #resolve: (command: string) => Effect.Effect<string | null, CustomAgentFailure>;
  #entries: Entry[] = [];
  #readOnly = false;
  #writes = Semaphore.makeUnsafe(1);

  constructor(options: {
    path: string;
    cipher: CustomProviderCipher;
    resolve?: (command: string) => Effect.Effect<string | null, CustomAgentFailure>;
  }) {
    this.#path = options.path;
    this.#cipher = options.cipher;
    this.#resolve = options.resolve ?? ((command) => resolveAgentCommand(command).pipe(toCustomAgentFailure));
  }

  load(): Effect.Effect<void, CustomAgentFailure> {
    return Effect.gen({ self: this }, function* () {
      const contents = yield* agentIO(() => readFile(this.#path, "utf8")).pipe(
        Effect.catch(({ cause }) =>
          cause instanceof Error && "code" in cause && cause.code === "ENOENT"
            ? Effect.succeed(null)
            : Effect.fail(new CustomAgentFailure({ cause })),
        ),
      );
      if (contents === null) return;
      const file = parseAgentFile(contents);
      if (!file) {
        this.#readOnly = true;
        this.#entries = [];
        return;
      }
      this.#readOnly = false;
      this.#entries = yield* Effect.forEach(file.agents, (stored) =>
        this.#openSecret(stored.secret).pipe(Effect.map((values) => ({ stored, values }))),
      );
    });
  }

  list(): Effect.Effect<CustomAgentSummary[]> {
    return Effect.suspend(() =>
      Effect.forEach(
        this.#entries,
        ({ stored }) =>
          this.#resolve(stored.command).pipe(
            Effect.catch(() => Effect.succeed(null)),
            Effect.map((resolvedCommand) => ({
              id: stored.id,
              name: stored.name,
              command: stored.command,
              args: [...stored.args],
              envNames: [...stored.envNames],
              usagePrompt: stored.usagePrompt,
              resolvedCommand,
            })),
          ),
        { concurrency: "unbounded" },
      ),
    );
  }

  configs(): readonly CustomAgentConfig[] {
    return this.#entries.map(({ stored, values }) => ({
      id: stored.id,
      name: stored.name,
      command: stored.command,
      args: stored.args,
      usagePrompt: stored.usagePrompt,
      env: stored.envNames.flatMap((name) => {
        const value = values?.[name];
        return value === undefined ? [] : [{ name, value }];
      }),
    }));
  }

  checkEnv(env: readonly CustomAgentEnvInput[], savedAgentId: string | undefined): Record<string, string> {
    const saved = savedAgentId ? this.#entries.find((entry) => entry.stored.id === savedAgentId) : undefined;
    return Object.fromEntries(mergeEnv(env, saved?.values ?? null));
  }

  save(input: SaveCustomAgentInput): Effect.Effect<void, CustomAgentFailure> {
    return this.#mutate(() => {
      const index = this.#entries.findIndex((entry) => entry.stored.id === input.id);
      const current = this.#entries[index];
      if (!current && this.#entries.length >= CUSTOM_AGENT_LIMITS.agents) {
        throw new Error(sourceText("error.provider.customAgentTooMany", { count: String(CUSTOM_AGENT_LIMITS.agents) }));
      }
      const envNames = input.env.map((entry) => entry.name);
      const keepsSecret =
        current !== undefined &&
        input.env.every((entry) => entry.value === null) &&
        sameNames(envNames, current.stored.envNames);
      let sealed = keepsSecret ? (current.stored.secret ?? null) : null;
      let values = keepsSecret ? current.values : null;
      if (!keepsSecret) {
        const merged = mergeEnv(input.env, current?.values ?? null);
        values = merged.length > 0 ? Object.fromEntries(merged) : null;
        if (values && !this.#cipher.canPersist()) throw new Error(NO_SECURE_STORAGE_MESSAGE);
        sealed = values ? this.#cipher.encrypt(JSON.stringify({ values })).toString("base64") : null;
      }
      for (const value of Object.values(values ?? {})) registerSecretValue(value);
      const next: Entry = {
        stored: {
          id: input.id,
          name: input.name,
          command: input.command,
          args: [...input.args],
          envNames,
          usagePrompt: input.usagePrompt,
          secret: sealed,
        },
        values,
      };
      return current
        ? this.#entries.map((entry, position) => (position === index ? next : entry))
        : [...this.#entries, next];
    });
  }

  remove(id: string): Effect.Effect<void, CustomAgentFailure> {
    return this.#mutate(() => {
      const remaining = this.#entries.filter((entry) => entry.stored.id !== id);
      return remaining.length === this.#entries.length ? null : remaining;
    });
  }

  assertWritable(): void {
    if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
  }

  #mutate(build: () => Entry[] | null): Effect.Effect<void, CustomAgentFailure> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const entries = yield* agentSync(() => {
          this.assertWritable();
          return build();
        });
        if (!entries) return;
        const content = yield* agentSync(
          () => `${JSON.stringify({ version: 1, agents: entries.map((entry) => entry.stored) })}\n`,
        );
        yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
          Effect.mapError(({ cause }) => new CustomAgentFailure({ cause })),
        );
        this.#entries = entries;
      }).pipe(Effect.uninterruptible),
    );
  }

  #openSecret = Effect.fn("CustomAgentStore.openSecret")(function* (
    this: CustomAgentStore,
    sealed: string | null | undefined,
  ) {
    if (!sealed) return null;
    return yield* agentSync(() => {
      const { values } = secretSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(sealed, "base64"))));
      for (const value of Object.values(values)) registerSecretValue(value);
      return values;
    }).pipe(Effect.catch(() => Effect.succeed(null)));
  });
}

function mergeEnv(
  env: readonly CustomAgentEnvInput[],
  saved: Readonly<Record<string, string>> | null,
): [string, string][] {
  return env.map((entry) => {
    const value = entry.value ?? saved?.[entry.name];
    if (value === undefined)
      throw new Error(sourceText("error.provider.customAgentEnvValueMissing", { name: entry.name }));
    return [entry.name, value];
  });
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function parseAgentFile(contents: string): AgentFile | null {
  try {
    return fileSchema.parse(JSON.parse(contents));
  } catch {
    return null;
  }
}
