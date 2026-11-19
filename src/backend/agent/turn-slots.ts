import type { QueueDelivery } from "@openbot/contracts/ipc";

export interface TurnSlotsOptions {
  /** The most turns that run at the same time, or null for no limit. */
  limit(): number | null;
  /**
   * The key of each queue that runs one turn at a time: an agent's own chat, and each of its tasks.
   * A lane key sorts as its agent id does, so a tie in age goes the same way as before tasks.
   */
  lanes(): readonly string[];
  /** Whether the lane runs a turn, starts one, or compacts its context. Each one uses a slot. */
  isRunning(lane: string): boolean;
  /** Whether the lane has a delivery that could start now, if a slot were free. */
  isWaiting(lane: string): boolean;
  /** The delivery at the head of the lane's queue. */
  head(lane: string): QueueDelivery | null;
}

/**
 * Owns the turn slot clause of the queue drain: on a hosted server only a fixed number of turns run
 * at the same time, and each task of an agent uses a slot of its own. When the slots are full, the
 * waiting lanes go by the head of their queue: a message from a person first, then routine runs and
 * teammate messages, and the oldest first in each group. A delivery that waits stays queued. It never imports the service.
 *
 * No slot waits on another slot: a teammate request ends the turn that sends it, and the answer
 * arrives as a new delivery.
 */
export class TurnSlots {
  readonly #options: TurnSlotsOptions;
  #round: RoundReads | null = null;

  constructor(options: TurnSlotsOptions) {
    this.#options = options;
  }

  /**
   * Runs `check` with one read of each lane. Use it only for synchronous work that starts no turn:
   * a drain starts in a later microtask and asks `mayStart` again outside the round, so a read of
   * the round never uses too many slots. A hook in the round, such as a usage-limit move, can change
   * a lane after the round read it. Then the lane waits for a slot until the next drain ends or the
   * next memory sample. Without a round, each `mayStart` of a retry reads all lanes of all agents
   * again, and a server with many agents and threads holds its main thread for minutes (#11710).
   */
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

/** No value of a round is undefined, so a missing key is a lane that the round has not read. */
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
