import {
  isSidebarPin,
  SIDEBAR_PIN_LIMIT,
  type SidebarPin,
  type SidebarPinsSnapshot,
  sidebarPinKey,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The person who uses this computer. The owner's desktop app has no member ID before the host first
 * runs, so the owner's pins have this key, and the owner's phones read the same pins.
 */
export const OWNER_PIN_KEY = "owner";

interface MemberPins {
  items: readonly SidebarPin[];
  updatedAt: string;
}

/**
 * The chats that each person pinned on this server, in their order (`sidebar-pins-v1`): the owner of
 * this computer, and each member by member ID. Each device of that person shows this list.
 *
 * A file that is missing or unreadable as JSON reads as no pins, and an entry that is not a pin is left
 * out. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class SidebarPinStore {
  readonly #path: string;
  #members: Readonly<Record<string, MemberPins>> = {};
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(key: string) => void>();

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeFile));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#members = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  /** Calls `listener` with the key of a person after each saved change of their pins. */
  subscribe(listener: (key: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The pins of one person, without the agents in `hidden`, which that person cannot see. */
  snapshot(key: string, hidden: ReadonlySet<string> = new Set()): SidebarPinsSnapshot {
    const member = this.#members[key];
    return {
      items: (member?.items ?? [])
        .filter((pin) => !(pin.kind === "agent" && hidden.has(pin.id)))
        .map((pin) => ({ kind: pin.kind, id: pin.id })),
      updatedAt: member?.updatedAt ?? null,
    };
  }

  /** Replaces the pins of one person. The agents in `hidden` keep the pins that the person cannot see. */
  readonly set = Effect.fn("SidebarPins.set")(function* (
    this: SidebarPinStore,
    key: string,
    items: readonly SidebarPin[],
    hidden: ReadonlySet<string> = new Set(),
  ) {
    yield* this.#update(key, (current) => merged(current, items, hidden));
    return this.snapshot(key, hidden);
  });

  /** Saves the pins of one person only when that person has no saved list yet. */
  readonly seed = Effect.fn("SidebarPins.seed")(function* (
    this: SidebarPinStore,
    key: string,
    items: readonly SidebarPin[],
    hidden: ReadonlySet<string> = new Set(),
  ) {
    yield* this.#update(key, (current) => (current ? null : merged(undefined, items, hidden)));
    return this.snapshot(key, hidden);
  });

  /** A removed member keeps no pins on this computer. */
  readonly removeMember = Effect.fn("SidebarPins.removeMember")(function* (this: SidebarPinStore, key: string) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() => {
          if (!this.#members[key]) return Effect.void;
          const { [key]: _removed, ...rest } = this.#members;
          return this.#save(rest);
        }),
      ),
    );
  });

  /**
   * Saves the list that `change` gives for one person, or nothing when it gives `null` or the same
   * list. The change reads the pins inside the write permit, so a change that starts while another
   * one is saved builds on its result.
   */
  #update(
    key: string,
    change: (current: MemberPins | undefined) => readonly SidebarPin[] | null,
  ): Effect.Effect<void, PreferenceFileFailure> {
    return this.#writes
      .withPermit(
        Effect.uninterruptible(
          Effect.suspend(() => {
            const current = this.#members[key];
            const items = change(current);
            if (!items || (current && samePins(current.items, items))) return Effect.succeed(false);
            const updatedAt = new Date().toISOString();
            return this.#save({ ...this.#members, [key]: { items, updatedAt } }).pipe(Effect.as(true));
          }),
        ),
      )
      .pipe(
        Effect.tap((changed) =>
          Effect.sync(() => {
            if (changed) for (const listener of this.#listeners) listener(key);
          }),
        ),
        Effect.asVoid,
      );
  }

  #save(members: Readonly<Record<string, MemberPins>>): Effect.Effect<void, PreferenceFileFailure> {
    return writePreferenceFile(this.#path, { version: 1, members }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.#members = members;
        }),
      ),
    );
  }
}

/** `items` in their order, then the saved pins of the agents in `hidden`, each pin once. */
function merged(
  current: MemberPins | undefined,
  items: readonly SidebarPin[],
  hidden: ReadonlySet<string>,
): SidebarPin[] {
  const kept = (current?.items ?? []).filter((pin) => pin.kind === "agent" && hidden.has(pin.id));
  const seen = new Set<string>();
  const result: SidebarPin[] = [];
  for (const pin of [...items, ...kept]) {
    const key = sidebarPinKey(pin);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: pin.kind, id: pin.id });
  }
  return result.slice(0, SIDEBAR_PIN_LIMIT);
}

function samePins(left: readonly SidebarPin[], right: readonly SidebarPin[]): boolean {
  return (
    left.length === right.length &&
    left.every((pin, index) => {
      const other = right[index];
      return other !== undefined && sidebarPinKey(pin) === sidebarPinKey(other);
    })
  );
}

function decodeFile(parsed: unknown): Record<string, MemberPins> | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.members)) return null;
  return Object.fromEntries(
    Object.entries(parsed.members).flatMap(([key, value]): [string, MemberPins][] => {
      if (!isDynamicRecord(value) || !Array.isArray(value.items) || !isString(value.updatedAt)) return [];
      return [
        [key, { items: merged(undefined, value.items.filter(isSidebarPin), new Set()), updatedAt: value.updatedAt }],
      ];
    }),
  );
}
