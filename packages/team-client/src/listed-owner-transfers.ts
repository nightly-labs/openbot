import type { OwnerTransfer } from "@openbot/contracts/owner-transfer";

export const LISTED_OWNER_TRANSFERS_FRESH_MS = 60_000;

interface ListedTransfers {
  readonly transfers: readonly OwnerTransfer[];
  readonly at: number;
}

function transferKey(transfers: readonly OwnerTransfer[]): string {
  return transfers
    .map((transfer) => transfer.transferId)
    .sort()
    .join(",");
}

export class ListedOwnerTransfers {
  readonly #now: () => number;
  #listed: ListedTransfers | null = null;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  record(transfers: readonly OwnerTransfer[] | null): boolean {
    const before = this.#listed;
    this.#listed = transfers === null ? null : { transfers, at: this.#now() };
    if (transfers === null) return before !== null;
    return before === null || transferKey(before.transfers) !== transferKey(transfers);
  }

  listsTransfers(): boolean {
    return this.#listed !== null;
  }

  key(): string | null {
    return this.#listed === null ? null : transferKey(this.#listed.transfers);
  }

  fresh(): OwnerTransfer[] | null {
    const listed = this.#listed;
    if (listed === null || this.#now() - listed.at > LISTED_OWNER_TRANSFERS_FRESH_MS) return null;
    return [...listed.transfers];
  }

  settle(transferId: string): void {
    const listed = this.#listed;
    if (listed === null) return;
    this.#listed = { ...listed, transfers: listed.transfers.filter((transfer) => transfer.transferId !== transferId) };
  }

  clear(): void {
    this.#listed = null;
  }
}
