/** Owns the derived turn lookup. It never writes mailbox state or imports the store. */
export class MailboxSourceTurnIndex {
  #keys: Readonly<Record<string, string>> | undefined;
  #turnIds: ReadonlyMap<string, string | undefined> = new Map();

  invalidate(): void {
    this.#keys = undefined;
  }

  read(keys: Readonly<Record<string, string>>): ReadonlyMap<string, string | undefined> {
    if (this.#keys === keys) return this.#turnIds;
    const turnIds = new Map<string, string | undefined>();
    for (const [key, messageId] of Object.entries(keys)) {
      if (turnIds.has(messageId)) continue;
      const parts = key.split(":");
      turnIds.set(messageId, parts.length >= 3 ? parts.at(-2) : undefined);
    }
    this.#keys = keys;
    this.#turnIds = turnIds;
    return turnIds;
  }
}
