import type { QueueDelivery } from "@openbot/contracts/ipc";

export interface TurnSlotsOptions {
  limit(): number | null;
  lanes(): readonly string[];
  isRunning(lane: string): boolean;
  isWaiting(lane: string): boolean;
  head(lane: string): QueueDelivery | null;
}

export class TurnSlots {
  readonly #options: TurnSlotsOptions;
  #round: RoundReads | null = null;

  constructor(options: TurnSlotsOptions) {
    this.#options = options;
  }

  round<T>(check: () => T): T {
    if (this.#round) return check();
    this.#round = { lanes: null, running: new Map(), waiting: new Map(), heads: new Map() };
    try {
      return check();
    } finally {
      this.#round = null;
    }
  }

  mayStart(lane: string): boolean {
    const limit = this.#options.limit();
    if (limit === null) return true;
    const lanes = this.#lanes();
    const free = limit - lanes.filter((id) => this.#isRunning(id)).length;
    if (free <= 0) return false;
    const head = this.#head(lane);
    if (!head) return true;
    let ahead = 0;
    for (const other of lanes) {
      if (other === lane || this.#isRunning(other) || !this.#isWaiting(other)) continue;
      const otherHead = this.#head(other);
      if (otherHead && startsBefore(otherHead, other, head, lane)) ahead += 1;
    }
    return ahead < free;
  }

  #lanes(): readonly string[] {
    if (!this.#round) return this.#options.lanes();
    this.#round.lanes ??= this.#options.lanes();
    return this.#round.lanes;
  }

  #isRunning(lane: string): boolean {
    return readOnce(this.#round?.running, lane, (key) => this.#options.isRunning(key));
  }

  #isWaiting(lane: string): boolean {
    return readOnce(this.#round?.waiting, lane, (key) => this.#options.isWaiting(key));
  }

  #head(lane: string): QueueDelivery | null {
    return readOnce(this.#round?.heads, lane, (key) => this.#options.head(key));
  }
}

interface RoundReads {
  lanes: readonly string[] | null;
  running: Map<string, boolean>;
  waiting: Map<string, boolean>;
  heads: Map<string, QueueDelivery | null>;
}

function readOnce<T extends boolean | QueueDelivery | null>(
  reads: Map<string, T> | undefined,
  lane: string,
  read: (lane: string) => T,
): T {
  if (!reads) return read(lane);
  const known = reads.get(lane);
  if (known !== undefined) return known;
  const value = read(lane);
  reads.set(lane, value);
  return value;
}

function startsBefore(left: QueueDelivery, leftLane: string, right: QueueDelivery, rightLane: string): boolean {
  const leftPerson = left.sender.kind === "user";
  const rightPerson = right.sender.kind === "user";
  if (leftPerson !== rightPerson) return leftPerson;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt;
  return leftLane < rightLane;
}
