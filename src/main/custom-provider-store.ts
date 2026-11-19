import { readFile } from "node:fs/promises";
import type {
  CustomProviderHarness,
  CustomProviderHeader,
  CustomProviderHeaderInput,
  CustomProviderInputKind,
  CustomProviderModel,
  CustomProviderReasoningEffort,
  CustomProviderSummary,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import {
  CUSTOM_PROVIDER_HARNESSES,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  isCustomProviderContextWindow,
  isCustomProviderInputs,
  isCustomProviderMaxOutput,
  isCustomProviderReasoningEfforts,
  sameCustomProviderOrigin,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import type { CustomProviderConfig } from "../backend/opencode-config";

export class CustomProviderFailure extends Schema.TaggedError<CustomProviderFailure>()("CustomProviderFailure", {
  cause: Schema.Defect(),
}) {}

const { io: providerIO, sync: providerSync } = causeHelpers(CustomProviderFailure);

export interface CustomProviderCipher {
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number().refine(isCustomProviderContextWindow).optional().catch(undefined),
  maxOutput: z.number().refine(isCustomProviderMaxOutput).optional().catch(undefined),
  reasoningEfforts: z
    .custom<CustomProviderReasoningEffort[]>(isCustomProviderReasoningEfforts)
    .optional()
    .catch(undefined),
  inputs: z.custom<CustomProviderInputKind[]>(isCustomProviderInputs).optional().catch(undefined),
});
const headerSchema = z.object({ name: z.string(), value: z.string() });

const entrySchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(modelSchema),
  secret: z.string().nullish(),
  harness: z.enum(CUSTOM_PROVIDER_HARNESSES).optional().catch(undefined),
});

const fileSchema = z.object({ version: z.literal(1), providers: z.array(entrySchema) });
const secretSchema = z.object({ apiKey: z.string().nullish(), headers: z.array(headerSchema).optional() });

type StoredEntry = z.infer<typeof entrySchema>;
type ProviderFile = z.infer<typeof fileSchema>;

interface ProviderSecret {
  readonly apiKey: string | null;
  readonly headers: readonly { name: string; value: string }[];
}

interface Entry {
  readonly stored: StoredEntry;
  readonly secret: ProviderSecret | null;
}

const READ_ONLY_MESSAGE = sourceText("error.provider.endpointsReadOnly");
const NO_SECURE_STORAGE_MESSAGE = sourceText("error.provider.endpointNoSecureStorage");
const DUPLICATE_MESSAGE = sourceText("error.provider.endpointDuplicate");
const NOT_SAVED_MESSAGE = sourceText("error.provider.endpointNotSaved");
const KEY_FOR_NEW_ADDRESS_MESSAGE = sourceText("error.provider.endpointKeyForNewAddress");
const SECRET_UNREADABLE_MESSAGE = sourceText("error.provider.endpointSecretUnreadable");

export class CustomProviderStore {
  readonly #path: string;
  readonly #cipher: CustomProviderCipher;
  #entries: Entry[] = [];
  #readOnly = false;
  #writes = Semaphore.makeUnsafe(1);

  constructor(options: { path: string; cipher: CustomProviderCipher }) {
    this.#path = options.path;
    this.#cipher = options.cipher;
  }

  load(): Effect.Effect<void, CustomProviderFailure> {
    return Effect.gen({ self: this }, function* () {
      const contents = yield* providerIO(() => readFile(this.#path, "utf8")).pipe(
        Effect.catch(({ cause }) =>
          cause instanceof Error && "code" in cause && cause.code === "ENOENT"
            ? Effect.succeed(null)
            : Effect.fail(new CustomProviderFailure({ cause })),
        ),
      );
      if (contents === null) return;
      const file = parseProviderFile(contents);
      if (!file) {
        this.#readOnly = true;
        this.#entries = [];
        return;
      }
      this.#readOnly = false;
      this.#entries = yield* Effect.forEach(file.providers, (stored) =>
        this.#openSecret(stored.secret).pipe(Effect.map((secret) => ({ stored, secret }))),
      );
    });
  }

  list(): CustomProviderSummary[] {
    return this.#entries.map(({ stored, secret }) => ({
      id: stored.id,
      name: stored.name,
      baseUrl: stored.baseUrl,
      hasApiKey: Boolean(secret?.apiKey),
      headerNames: (secret?.headers ?? []).map((header) => header.name),
      models: stored.models.map(copyModel),
      harness: harnessOf(stored),
    }));
  }

  configs(): readonly CustomProviderConfig[] {
    return this.#entries.map(({ stored, secret }) => ({
      id: stored.id,
      name: stored.name,
      baseUrl: stored.baseUrl,
      apiKey: secret?.apiKey ?? null,
      models: stored.models.map(copyModel),
      headers: secret?.headers ?? [],
      harness: harnessOf(stored),
    }));
  }

  save(input: SaveCustomProviderInput): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#mutate(() => {
      if (this.#entries.some((entry) => entry.stored.id === input.id)) throw new Error(DUPLICATE_MESSAGE);
      const secret: ProviderSecret | null =
        input.apiKey || input.headers.length > 0 ? { apiKey: input.apiKey || null, headers: input.headers } : null;
      if (secret && !this.#cipher.canPersist()) throw new Error(NO_SECURE_STORAGE_MESSAGE);
      return [
        ...this.#entries,
        {
          stored: {
            id: input.id,
            name: input.name,
            baseUrl: input.baseUrl,
            models: input.models.map(copyModel),
            secret: secret ? this.#cipher.encrypt(JSON.stringify(secret)).toString("base64") : null,
            ...storedHarness(input.harness),
          },
          secret,
        },
      ];
    });
  }

  update(input: UpdateCustomProviderInput): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#mutate(() => {
      const { index, current, keepHeaders, headers } = this.#checkUpdate(input);
      const keepKey = input.apiKey === undefined;
      let sealed = current.stored.secret ?? null;
      let secret = current.secret;
      if (!keepKey || !keepHeaders) {
        const apiKey = keepKey ? (current.secret?.apiKey ?? null) : input.apiKey || null;
        secret = apiKey || headers.length > 0 ? { apiKey, headers } : null;
        if (secret && !this.#cipher.canPersist()) throw new Error(NO_SECURE_STORAGE_MESSAGE);
        sealed = secret ? this.#cipher.encrypt(JSON.stringify(secret)).toString("base64") : null;
      }
      const next: Entry = {
        stored: {
          id: current.stored.id,
          name: input.name,
          baseUrl: input.baseUrl,
          models: input.models.map(copyModel),
          secret: sealed,
          ...storedHarness(input.harness ?? current.stored.harness),
        },
        secret,
      };
      return this.#entries.map((entry, position) => (position === index ? next : entry));
    });
  }

  checkUpdate(input: UpdateCustomProviderInput): void {
    if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
    const { current, keepHeaders, headers } = this.#checkUpdate(input);
    const replacesSecret = input.apiKey !== undefined || !keepHeaders;
    if (replacesSecret && !this.#cipher.canPersist()) {
      const apiKey = input.apiKey ?? current.secret?.apiKey ?? null;
      if (apiKey || headers.length > 0) throw new Error(NO_SECURE_STORAGE_MESSAGE);
    }
  }

  #checkUpdate(input: UpdateCustomProviderInput): {
    index: number;
    current: Entry;
    keepHeaders: boolean;
    headers: readonly CustomProviderHeader[];
  } {
    const index = this.#entries.findIndex((entry) => entry.stored.id === input.id);
    const current = this.#entries[index];
    if (!current) throw new Error(NOT_SAVED_MESSAGE);
    const saved = current.secret?.headers ?? [];
    const keepKey = input.apiKey === undefined;
    const keepHeaders = input.headers === undefined || keepsSavedHeaders(input.headers, saved);
    const unreadable = Boolean(current.stored.secret) && !current.secret;
    if (keepKey !== keepHeaders && unreadable) {
      throw new Error(SECRET_UNREADABLE_MESSAGE);
    }
    const headers = keepHeaders ? saved : mergeHeaders(input.headers ?? [], saved);
    const keptSecret =
      (keepKey && Boolean(current.secret?.apiKey)) ||
      (keepHeaders && saved.length > 0) ||
      (!keepHeaders && (input.headers ?? []).some((header) => header.value === null)) ||
      (keepKey && keepHeaders && unreadable);
    if (keptSecret && !sameCustomProviderOrigin(current.stored.baseUrl, input.baseUrl)) {
      throw new Error(KEY_FOR_NEW_ADDRESS_MESSAGE);
    }
    return { index, current, keepHeaders, headers };
  }

  remove(id: string): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#mutate(() => {
      const remaining = this.#entries.filter((entry) => entry.stored.id !== id);
      return remaining.length === this.#entries.length ? null : remaining;
    });
  }

  #mutate(build: () => Entry[] | null): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const entries = yield* providerSync(() => {
          if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
          return build();
        });
        if (entries) {
          yield* this.#persist(entries);
          this.#entries = entries;
        }
        return this.list();
      }).pipe(Effect.uninterruptible),
    );
  }

  #openSecret = Effect.fn("CustomProviderStore.openSecret")(function* (
    this: CustomProviderStore,
    sealed: string | null | undefined,
  ) {
    if (!sealed) return null;
    return yield* providerSync(() => {
      const parsed = secretSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(sealed, "base64"))));
      return { apiKey: parsed.apiKey || null, headers: parsed.headers ?? [] };
    }).pipe(Effect.catch(() => Effect.succeed(null)));
  });

  #persist = Effect.fn("CustomProviderStore.persist")(function* (this: CustomProviderStore, entries: readonly Entry[]) {
    const content = yield* providerSync(
      () => `${JSON.stringify({ version: 1, providers: entries.map((entry) => entry.stored) })}\n`,
    );
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new CustomProviderFailure({ cause })),
    );
  });
}

function harnessOf(stored: StoredEntry): CustomProviderHarness {
  return stored.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
}

function storedHarness(harness: CustomProviderHarness | undefined): { harness?: CustomProviderHarness } {
  return harness && harness !== DEFAULT_CUSTOM_PROVIDER_HARNESS ? { harness } : {};
}

function copyModel(model: z.infer<typeof modelSchema>): CustomProviderModel {
  return {
    id: model.id,
    name: model.name,
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutput !== undefined ? { maxOutput: model.maxOutput } : {}),
    ...(model.reasoningEfforts !== undefined ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
    ...(model.inputs !== undefined ? { inputs: [...model.inputs] } : {}),
  };
}

function keepsSavedHeaders(
  input: readonly CustomProviderHeaderInput[],
  saved: readonly CustomProviderHeader[],
): boolean {
  return (
    input.length === saved.length &&
    input.every((header, index) => header.value === null && header.name === saved[index]?.name)
  );
}

function mergeHeaders(
  input: readonly CustomProviderHeaderInput[],
  saved: readonly CustomProviderHeader[],
): CustomProviderHeader[] {
  return input.map((header) => {
    const value = header.value ?? saved.find((entry) => entry.name === header.name)?.value;
    if (value === undefined) throw new Error(sourceText("error.provider.headerValueMissing", { name: header.name }));
    return { name: header.name, value };
  });
}

function parseProviderFile(contents: string): ProviderFile | null {
  try {
    return fileSchema.parse(JSON.parse(contents));
  } catch {
    return null;
  }
}
