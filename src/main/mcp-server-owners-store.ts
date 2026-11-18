import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { type PreferenceFileFailure, PreferenceStore } from "./preference-file";

export const MCP_SERVER_OWNERS_FILE = "openbot-mcp-server-owners-v1.json";

interface McpServerOwnersFile {
  /** The member ID of the person who added each MCP server, by MCP server ID. */
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

/**
 * The member who added each MCP server of this host from a joined server (`mcp-member-access-v1`), so
 * a member can change only the servers that they added. A preference file rather than the database:
 * it needs no migration, and an older build ignores it.
 *
 * A server with no entry, such as one added on this computer or before this file existed, counts as
 * an admin's. A missing or damaged file reads as no entries, so it gives no member a server.
 */
export class McpServerOwnersStore {
  readonly #store: PreferenceStore<McpServerOwnersFile>;
  // `PreferenceStore` chains its writes, but each change here reads the map first.
  readonly #changes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#store = new PreferenceStore({ path, defaultValue: { owners: {} }, decode: decodeOwners });
  }

  load() {
    return this.#store.load();
  }

  /** Whether `memberId` added the MCP server `mcpServerId`. */
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
