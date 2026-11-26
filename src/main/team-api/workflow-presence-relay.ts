import {
  WORKFLOW_PRESENCE_LIMITS,
  WORKFLOW_SPOT_EVENT,
  type WorkflowSpot,
  type WorkflowSpotEvent,
  type WorkflowSpotInput,
} from "@openbot/contracts/team-protocol/workflow-presence-v1";

const RELAY_INTERVAL_MS = 40;

export interface WorkflowPresenceSeat {
  readonly memberId: string;
  deliver(event: WorkflowSpotEvent): void;
}

interface SeatState {
  readonly seat: WorkflowPresenceSeat;
  workflowId: string | null;
  spot: WorkflowSpot | null;
  changedAt: number;
  seenAt: number;
  expiry: ReturnType<typeof setTimeout> | null;
  checking: string | null;
  denied: string | null;
  waiting: WorkflowSpot | null;
  publishedAt: number;
  trailing: ReturnType<typeof setTimeout> | null;
}

export class WorkflowPresenceRelay<Key> {
  readonly #seats = new Map<Key, SeatState>();
  readonly #canView: (key: Key, workflowId: string) => Promise<boolean>;
  readonly #staleMs: number;
  readonly #now: () => number;

  constructor(
    canView: (key: Key, workflowId: string) => Promise<boolean>,
    staleMs: number = WORKFLOW_PRESENCE_LIMITS.staleMs,
    now: () => number = Date.now,
  ) {
    this.#canView = canView;
    this.#staleMs = staleMs;
    this.#now = now;
  }

  update(key: Key, seat: WorkflowPresenceSeat, input: WorkflowSpotInput): void {
    const state = this.#seats.get(key) ?? this.#add(key, seat);
    const workflowId = input.workflowId;
    if (workflowId === null) {
      this.#exit(state);
      state.denied = null;
      return;
    }
    const spot = { at: input.at, selected: input.selected };
    if (workflowId === state.workflowId) {
      state.seenAt = this.#now();
      if (sameSpot(state.spot, spot)) return;
      state.spot = spot;
      state.changedAt = this.#now();
      this.#schedule(state);
      return;
    }
    if (workflowId === state.denied) return;
    if (state.checking === workflowId) {
      state.waiting = spot;
      return;
    }
    this.#exit(state);
    state.denied = null;
    state.waiting = spot;
    state.checking = workflowId;
    void this.#canView(key, workflowId)
      .catch(() => false)
      .then((visible) => this.#admit(key, state, workflowId, visible));
  }

  recheck(workflowId?: string): void {
    for (const [key, state] of this.#seats) {
      if (workflowId === undefined || state.denied === workflowId) state.denied = null;
      const open = state.workflowId;
      if (open === null || (workflowId !== undefined && open !== workflowId)) continue;
      void this.#canView(key, open)
        .catch(() => false)
        .then((visible) => {
          if (visible || this.#seats.get(key) !== state || state.workflowId !== open) return;
          for (const event of this.#snapshot(state, open)) state.seat.deliver({ ...event, spot: null });
          this.#exit(state);
          state.denied = open;
        });
    }
  }

  leave(key: Key): void {
    const state = this.#seats.get(key);
    if (!state) return;
    this.#exit(state);
    this.#seats.delete(key);
  }

  clear(): void {
    for (const state of this.#seats.values()) {
      if (state.trailing) clearTimeout(state.trailing);
      if (state.expiry) clearTimeout(state.expiry);
    }
    this.#seats.clear();
  }

  #add(key: Key, seat: WorkflowPresenceSeat): SeatState {
    const state: SeatState = {
      seat,
      workflowId: null,
      spot: null,
      changedAt: 0,
      seenAt: 0,
      expiry: null,
      checking: null,
      denied: null,
      waiting: null,
      publishedAt: 0,
      trailing: null,
    };
    this.#seats.set(key, state);
    return state;
  }

  #admit(key: Key, state: SeatState, workflowId: string, visible: boolean): void {
    if (this.#seats.get(key) !== state || state.checking !== workflowId) return;
    state.checking = null;
    const spot = state.waiting;
    state.waiting = null;
    if (!visible || !spot) {
      state.denied = visible ? null : workflowId;
      return;
    }
    state.workflowId = workflowId;
    state.spot = spot;
    state.changedAt = this.#now();
    state.seenAt = state.changedAt;
    for (const event of this.#snapshot(state, workflowId)) state.seat.deliver(event);
    this.#schedule(state);
    this.#watch(state, this.#staleMs);
  }

  #watch(state: SeatState, wait: number): void {
    state.expiry = setTimeout(() => {
      state.expiry = null;
      if (state.workflowId === null) return;
      const left = state.seenAt + this.#staleMs - this.#now();
      if (left > 0) this.#watch(state, left);
      else this.#exit(state);
    }, wait);
    state.expiry.unref?.();
  }

  #snapshot(state: SeatState, workflowId: string): WorkflowSpotEvent[] {
    const newest = new Map<string, SeatState>();
    for (const other of this.#seats.values()) {
      if (other.workflowId !== workflowId || other.seat.memberId === state.seat.memberId) continue;
      const known = newest.get(other.seat.memberId);
      if (!known || known.changedAt < other.changedAt) newest.set(other.seat.memberId, other);
    }
    return [...newest.values()].map((other) => this.#event(workflowId, other.seat.memberId, other.spot));
  }

  #schedule(state: SeatState): void {
    if (state.trailing) return;
    const wait = state.publishedAt + RELAY_INTERVAL_MS - this.#now();
    if (wait <= 0) {
      this.#publish(state);
      return;
    }
    state.trailing = setTimeout(() => {
      state.trailing = null;
      this.#publish(state);
    }, wait);
    state.trailing.unref?.();
  }

  #publish(state: SeatState): void {
    const workflowId = state.workflowId;
    if (workflowId === null) return;
    state.publishedAt = this.#now();
    this.#broadcast(workflowId, state.seat.memberId, this.#event(workflowId, state.seat.memberId, state.spot));
  }

  #exit(state: SeatState): void {
    if (state.trailing) clearTimeout(state.trailing);
    state.trailing = null;
    if (state.expiry) clearTimeout(state.expiry);
    state.expiry = null;
    state.checking = null;
    state.waiting = null;
    const workflowId = state.workflowId;
    if (workflowId === null) return;
    state.workflowId = null;
    state.spot = null;
    const memberId = state.seat.memberId;
    let remaining: SeatState | null = null;
    for (const other of this.#seats.values())
      if (
        other.workflowId === workflowId &&
        other.seat.memberId === memberId &&
        (!remaining || remaining.changedAt < other.changedAt)
      )
        remaining = other;
    this.#broadcast(workflowId, memberId, this.#event(workflowId, memberId, remaining?.spot ?? null));
  }

  #broadcast(workflowId: string, memberId: string, event: WorkflowSpotEvent): void {
    for (const other of this.#seats.values())
      if (other.workflowId === workflowId && other.seat.memberId !== memberId) other.seat.deliver(event);
  }

  #event(workflowId: string, memberId: string, spot: WorkflowSpot | null): WorkflowSpotEvent {
    return { type: WORKFLOW_SPOT_EVENT, workflowId, memberId, spot };
  }
}

function sameSpot(current: WorkflowSpot | null, next: WorkflowSpot): boolean {
  return (
    current !== null &&
    current.selected === next.selected &&
    current.at?.x === next.at?.x &&
    current.at?.y === next.at?.y
  );
}
