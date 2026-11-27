import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { type PreferenceFileFailure, PreferenceStore } from "./preference-file";

export const MCP_SERVER_OWNERS_FILE = "openbot-mcp-server-owners-v1.json";

interface McpServerOwnersFile {
  owners: Record<string, string>;
}

function decodeOwners(parsed: unknown): McpServerOwnersFile | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.owners)) return null;
  const owners: Record<string, string> = {};
  for (const [mcpServerId, memberId] of Object.entries(parsed.owners)) {
    if (typeof memberId !== "string") return null;
    owners[mcpServerId] = memberId;
  }
  return { owners };
}

export class McpServerOwnersStore {
  readonly #store: PreferenceStore<McpServerOwnersFile>;
  readonly #changes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#store = new PreferenceStore({ path, defaultValue: { owners: {} }, decode: decodeOwners });
  }

  load() {
    return this.#store.load();
  }

  addedBy(mcpServerId: string, memberId: string): boolean {
    return this.#store.get().owners[mcpServerId] === memberId;
  }

  add(mcpServerId: string, memberId: string): Effect.Effect<void, PreferenceFileFailure> {
    return this.#change((owners) => ({ ...owners, [mcpServerId]: memberId }));
  }

  remove(mcpServerId: string): Effect.Effect<void, PreferenceFileFailure> {
    return this.#change((owners) => Object.fromEntries(Object.entries(owners).filter(([id]) => id !== mcpServerId)));
  }

  #change(next: (owners: Record<string, string>) => Record<string, string>) {
    return this.#changes.withPermit(
      Effect.suspend(() => this.#store.set({ owners: next(this.#store.get().owners) })).pipe(Effect.asVoid),
    );
  }
}
