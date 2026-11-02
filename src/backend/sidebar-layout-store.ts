import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isCompleteSectionOrder,
  SIDEBAR_FOLDER_LEVELS,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  type SidebarSection,
  sidebarFolderAncestors,
  sidebarFolderHeight,
  sidebarFolderParents,
  sidebarFolderTreeOrder,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { isUuidV4, legacyAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Result, Semaphore } from "effect";
import { writeFileAtomically } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";
import { StoredStateFailure, storedIO, storedSync } from "./stored-state-effects";

interface StoredSidebarLayout extends SidebarLayoutSnapshot {
  version: 2;
}

interface LegacyStoredSidebarLayout extends Omit<SidebarLayoutSnapshot, "agentOrder"> {
  version: 1;
}

interface SidebarLayoutStoreEvents {
  changed: [layout: SidebarLayoutSnapshot];
}

const DEFAULT_LAYOUT: SidebarLayoutSnapshot = {
  revision: 0,
  sections: [],
  order: [SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID],
  agentAssignments: {},
  agentOrder: [],
};

export class SidebarLayoutStore extends EventEmitter<SidebarLayoutStoreEvents> {
  readonly #path: string;
  #layout = structuredClone(DEFAULT_LAYOUT);
  readonly #operationQueue = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    super();
    this.#path = path;
  }

  initialize() {
    return Effect.gen({ self: this }, function* () {
      yield* storedIO(() => mkdir(dirname(this.#path), { recursive: true, mode: 0o700 }));
      const loaded = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const contents = yield* storedIO(() => readFile(this.#path, "utf8"));
          return yield* storedSync(() => {
            const parsed = JSON.parse(contents);
            if (isStoredSidebarLayout(parsed)) return snapshotFromStored(parsed);
            if (isLegacyStoredSidebarLayout(parsed))
              return withFolderTree({ ...snapshotFromLegacyStored(parsed), agentOrder: [] });
            throw new Error("Invalid sidebar layout state.");
          });
        }),
      );
      if (Result.isSuccess(loaded)) {
        this.#layout = loaded.success;
        return;
      }
      if (isMissingFileError(loaded.failure.cause)) return;
      const backupPath = `${this.#path}.corrupt-${Date.now()}`;
      yield* storedIO(() => rename(this.#path, backupPath)).pipe(Effect.catch(() => Effect.void));
      this.#layout = structuredClone(DEFAULT_LAYOUT);
    });
  }

  getSnapshot(): SidebarLayoutSnapshot {
    return structuredClone(this.#layout);
  }

  mutate(
    action: SidebarLayoutAction,
    agentIds: ReadonlySet<string>,
  ): Effect.Effect<SidebarLayoutSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const next = yield* storedSync(() => applySidebarLayoutAction(this.#layout, action, agentIds));
        if (next === this.#layout) return this.getSnapshot();
        yield* this.#commit(next);
        return this.getSnapshot();
      }),
    );
  }

  withProfileAssignment<T, E>(
    sectionId: string | null,
    operation: (
      assign: (agentId: string) => Effect.Effect<SidebarLayoutSnapshot, StoredStateFailure>,
    ) => Effect.Effect<T, E>,
  ): Effect.Effect<T, E | StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        if (sectionId !== null) yield* storedSync(() => requireCustomSection(this.#layout, sectionId));
        const previous = this.getSnapshot();
        const result = yield* Effect.exit(
          operation((agentId) =>
            Effect.gen({ self: this }, function* () {
              const next = yield* storedSync(() =>
                applySidebarLayoutAction(this.#layout, { type: "assign", agentId, sectionId }, new Set([agentId])),
              );
              if (next !== this.#layout) yield* this.#commit(next);
              return this.getSnapshot();
            }),
          ),
        );
        if (Exit.isSuccess(result)) return result.value;
        if (this.#layout.revision !== previous.revision)
          yield* this.#commit({ ...previous, revision: this.#layout.revision + 1 });
        return yield* Effect.failCause(result.cause);
      }),
    );
  }

  removeAgent(agentId: string): Effect.Effect<SidebarLayoutSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        if (!(agentId in this.#layout.agentAssignments) && !this.#layout.agentOrder.includes(agentId)) {
          return this.getSnapshot();
        }
        const agentAssignments = { ...this.#layout.agentAssignments };
        delete agentAssignments[agentId];
        yield* this.#commit({
          ...this.#layout,
          revision: this.#layout.revision + 1,
          agentAssignments,
          agentOrder: this.#layout.agentOrder.filter((candidate) => candidate !== agentId),
        });
        return this.getSnapshot();
      }),
    );
  }

  placeDuplicateAfter(
    sourceAgentId: string,
    duplicateAgentId: string,
    orderedAgentIds: readonly string[],
  ): Effect.Effect<SidebarLayoutSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const agentIds = new Set(orderedAgentIds);
        if (!agentIds.has(sourceAgentId) || !agentIds.has(duplicateAgentId))
          return yield* new StoredStateFailure({ cause: new Error("Unknown agent.") });
        const sectionId = this.#layout.agentAssignments[sourceAgentId] ?? null;
        const order = normalizedAgentOrder(this.#layout.agentOrder, agentIds).filter(
          (agentId) => agentId !== duplicateAgentId,
        );
        const sourceIndex = order.indexOf(sourceAgentId);
        if (sourceIndex < 0) return yield* new StoredStateFailure({ cause: new Error("Unknown source agent order.") });
        const beforeAgentId =
          order
            .slice(sourceIndex + 1)
            .find((agentId) => (this.#layout.agentAssignments[agentId] ?? null) === sectionId) ?? null;
        const next = yield* storedSync(() =>
          applySidebarLayoutAction(
            this.#layout,
            { type: "move-agent", agentId: duplicateAgentId, sectionId, beforeAgentId },
            agentIds,
          ),
        );
        if (next === this.#layout) return this.getSnapshot();
        yield* this.#commit(next);
        return this.getSnapshot();
      }),
    );
  }

  /**
   * Drops the agents that are gone -- but renames the ones that only look gone first. This layout is a
   * JSON file outside the database, so migration v13 renamed every agent in SQLite and left the sidebar
   * still filing them under `bot-<uuid>`. Filtering straight against the new roster would read that as
   * "these agents no longer exist" and commit the deletion, so a user with a dozen agents in named groups
   * comes back to all of them unassigned, in an order they never chose, with nothing to undo it.
   */
  reconcileAgents(agentIds: ReadonlySet<string>): Effect.Effect<SidebarLayoutSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const renamedFrom = new Map<string, string>();
        for (const agentId of agentIds) {
          const legacyId = legacyAgentId(agentId);
          if (legacyId !== agentId) renamedFrom.set(legacyId, agentId);
        }
        // An id still in the roster answers for itself, which is why that test comes first: v13 declines to
        // rename onto an id that is taken, so an agent spelled `bot-<uuid>` can be sitting beside the
        // `agent-<uuid>` it would otherwise have become, and this entry belongs to the one the user filed.
        const currentId = (agentId: string) =>
          agentIds.has(agentId) ? agentId : (renamedFrom.get(agentId) ?? agentId);
        // Two entries can land on one id -- the layout can hold a `bot-<uuid>` the user filed before the
        // upgrade beside the `agent-<uuid>` it became -- and the layout is validated on the way back in.
        // An unmerged pair leaves the same agent twice in `agentOrder`, the file is rejected on the next
        // launch, and the user's sections and ordering are reset. The entry already spelled the way the
        // roster spells it is the one the user filed most recently, so it wins.
        const agentAssignments: Record<string, string> = {};
        for (const [agentId, sectionId] of Object.entries(this.#layout.agentAssignments)) {
          const id = currentId(agentId);
          if (!agentIds.has(id) || (id !== agentId && this.#layout.agentAssignments[id] !== undefined)) continue;
          agentAssignments[id] = sectionId;
        }
        const agentOrder: string[] = [];
        for (const entry of this.#layout.agentOrder) {
          const agentId = currentId(entry);
          if (agentIds.has(agentId) && !agentOrder.includes(agentId)) agentOrder.push(agentId);
        }
        if (
          Object.keys(agentAssignments).length === Object.keys(this.#layout.agentAssignments).length &&
          Object.keys(agentAssignments).every((agentId) => agentId in this.#layout.agentAssignments) &&
          agentOrder.length === this.#layout.agentOrder.length &&
          agentOrder.every((agentId, index) => agentId === this.#layout.agentOrder[index])
        ) {
          return this.getSnapshot();
        }
        yield* this.#commit({ ...this.#layout, revision: this.#layout.revision + 1, agentAssignments, agentOrder });
        return this.getSnapshot();
      }),
    );
  }

  #enqueue<T, E>(operation: Effect.Effect<T, E>): Effect.Effect<T, E> {
    return this.#operationQueue.withPermit(operation.pipe(Effect.uninterruptible));
  }

  #commit = Effect.fn("SidebarLayout.commit")(function* (this: SidebarLayoutStore, next: SidebarLayoutSnapshot) {
    const stored: StoredSidebarLayout = { version: 2, ...next };
    yield* writeFileAtomically(this.#path, `${JSON.stringify(stored)}\n`).pipe(
      Effect.mapError(({ cause }) => new StoredStateFailure({ cause })),
    );
    this.#layout = next;
    this.emit("changed", this.getSnapshot());
  });
}

/**
 * Applies one action and puts the folders back in tree order. An action that changes nothing answers
 * `current` itself, so the store does not write the file or raise the revision.
 */
function applySidebarLayoutAction(
  current: SidebarLayoutSnapshot,
  action: SidebarLayoutAction,
  agentIds: ReadonlySet<string>,
): SidebarLayoutSnapshot {
  const next = applyFlatSidebarLayoutAction(current, action, agentIds);
  if (next === current) return current;
  const normalized = withFolderTree(next);
  // A move between a folder and its own folders leaves the tree as it was.
  return action.type === "move" && arraysEqual(normalized.order, current.order) ? current : normalized;
}

/**
 * The layout with each parent that `sidebarFolderParents` keeps, and the order that walks the tree.
 * An older version keeps `parentId` in the file but does not maintain it, so a loaded layout can name
 * a parent that it deleted; that folder goes to the top rather than the file being reset.
 */
function withFolderTree(layout: SidebarLayoutSnapshot): SidebarLayoutSnapshot {
  const parents = sidebarFolderParents(layout);
  return {
    ...layout,
    sections: layout.sections.map(({ id, name }) => {
      const parentId = parents.get(id);
      return parentId === undefined ? { id, name } : { id, name, parentId };
    }),
    order: sidebarFolderTreeOrder(layout.order, parents),
  };
}

function applyFlatSidebarLayoutAction(
  current: SidebarLayoutSnapshot,
  action: SidebarLayoutAction,
  agentIds: ReadonlySet<string>,
): SidebarLayoutSnapshot {
  switch (action.type) {
    case "create": {
      if (current.sections.length >= INPUT_LIMITS.sidebarSections) {
        throw new Error(sourceText("error.backend.sidebarSectionLimit", { limit: INPUT_LIMITS.sidebarSections }));
      }
      const name = validSectionName(action.name, current.sections);
      if (action.agentId !== undefined && !agentIds.has(action.agentId)) throw new Error("Unknown agent.");
      if (action.parentId !== undefined) {
        requireCustomSection(current, action.parentId);
        if (folderDepth(current, action.parentId) + 1 >= SIDEBAR_FOLDER_LEVELS)
          throw new Error(sourceText("error.backend.sidebarFolderTooDeep"));
      }
      // A new folder goes last: at the end of its parent once the tree order is rebuilt.
      const section: SidebarSection =
        action.parentId === undefined
          ? { id: randomUUID(), name }
          : { id: randomUUID(), name, parentId: action.parentId };
      return {
        revision: current.revision + 1,
        sections: [...current.sections, section],
        order: [...current.order, section.id],
        agentAssignments:
          action.agentId === undefined
            ? { ...current.agentAssignments }
            : { ...current.agentAssignments, [action.agentId]: section.id },
        agentOrder: [...current.agentOrder],
      };
    }
    case "rename": {
      const section = requireCustomSection(current, action.sectionId);
      const name = validSectionName(
        action.name,
        current.sections.filter((candidate) => candidate.id !== section.id),
      );
      if (name === section.name) return current;
      return {
        ...current,
        revision: current.revision + 1,
        sections: current.sections.map((candidate) =>
          candidate.id === section.id ? { ...candidate, name } : candidate,
        ),
      };
    }
    case "delete": {
      requireCustomSection(current, action.sectionId);
      // The folders and chats of a deleted folder go to its parent; at the top, the chats are unassigned.
      const parentId = sidebarFolderParents(current).get(action.sectionId);
      return {
        revision: current.revision + 1,
        sections: current.sections
          .filter((section) => section.id !== action.sectionId)
          .map((section) => (section.parentId === action.sectionId ? withParent(section, parentId) : section)),
        order: current.order.filter((sectionId) => sectionId !== action.sectionId),
        agentAssignments: Object.fromEntries(
          Object.entries(current.agentAssignments).flatMap(([agentId, sectionId]) => {
            if (sectionId !== action.sectionId) return [[agentId, sectionId]];
            return parentId === undefined ? [] : [[agentId, parentId]];
          }),
        ),
        agentOrder: [...current.agentOrder],
      };
    }
    case "nest": {
      // People and Unassigned stay at the top level, but they can move among the folders there.
      if (action.sectionId === SIDEBAR_PEOPLE_SECTION_ID || action.sectionId === SIDEBAR_UNASSIGNED_SECTION_ID) {
        if (action.parentId !== null) throw new Error(sourceText("error.backend.sidebarFolderMoveInvalid"));
      } else requireCustomSection(current, action.sectionId);
      const parents = sidebarFolderParents(current);
      if (action.parentId !== null) {
        requireCustomSection(current, action.parentId);
        if (
          action.parentId === action.sectionId ||
          sidebarFolderAncestors(parents, action.parentId).includes(action.sectionId)
        )
          throw new Error(sourceText("error.backend.sidebarFolderMoveInvalid"));
      }
      const depth = action.parentId === null ? 0 : folderDepth(current, action.parentId) + 1;
      if (depth + sidebarFolderHeight(parents, action.sectionId) >= SIDEBAR_FOLDER_LEVELS)
        throw new Error(sourceText("error.backend.sidebarFolderTooDeep"));
      if (action.beforeSectionId !== null) {
        if (action.beforeSectionId === action.sectionId || !current.order.includes(action.beforeSectionId))
          throw new Error("Unknown sidebar section order target.");
        if ((parents.get(action.beforeSectionId) ?? null) !== action.parentId)
          throw new Error(sourceText("error.backend.sidebarFolderMoveInvalid"));
      }
      const order = current.order.filter((sectionId) => sectionId !== action.sectionId);
      const insertionIndex = action.beforeSectionId === null ? order.length : order.indexOf(action.beforeSectionId);
      order.splice(insertionIndex, 0, action.sectionId);
      const sections = current.sections.map((section) =>
        section.id === action.sectionId ? withParent(section, action.parentId ?? undefined) : section,
      );
      const next = withFolderTree({ ...current, sections, order });
      if (arraysEqual(next.order, current.order) && (parents.get(action.sectionId) ?? null) === action.parentId)
        return current;
      return { ...next, revision: current.revision + 1 };
    }
    case "move": {
      const index = current.order.indexOf(action.sectionId);
      if (index < 0) throw new Error("Unknown sidebar section.");
      const targetIndex = index + (action.direction === "up" ? -1 : 1) * (action.steps ?? 1);
      if (targetIndex < 0 || targetIndex >= current.order.length) return current;
      const order = [...current.order];
      const [movedSectionId] = order.splice(index, 1);
      if (!movedSectionId) return current;
      order.splice(targetIndex, 0, movedSectionId);
      return { ...current, revision: current.revision + 1, order };
    }
    case "assign": {
      if (!agentIds.has(action.agentId)) throw new Error("Unknown agent.");
      if (action.sectionId !== null) requireCustomSection(current, action.sectionId);
      const agentAssignments = { ...current.agentAssignments };
      if (action.sectionId === null) delete agentAssignments[action.agentId];
      else agentAssignments[action.agentId] = action.sectionId;
      if (agentAssignments[action.agentId] === current.agentAssignments[action.agentId]) return current;
      if (action.sectionId === null && !(action.agentId in current.agentAssignments)) return current;
      return { ...current, revision: current.revision + 1, agentAssignments };
    }
    case "move-agent": {
      if (!agentIds.has(action.agentId)) throw new Error("Unknown agent.");
      if (action.sectionId !== null) requireCustomSection(current, action.sectionId);
      if (action.beforeAgentId !== null) {
        if (!agentIds.has(action.beforeAgentId) || action.beforeAgentId === action.agentId) {
          throw new Error("Unknown agent order target.");
        }
        const targetSectionId = current.agentAssignments[action.beforeAgentId] ?? null;
        if (targetSectionId !== action.sectionId) throw new Error("Agent order target belongs to another section.");
      }

      const agentOrder = normalizedAgentOrder(current.agentOrder, agentIds).filter(
        (agentId) => agentId !== action.agentId,
      );
      let insertionIndex = agentOrder.length;
      if (action.beforeAgentId !== null) {
        insertionIndex = agentOrder.indexOf(action.beforeAgentId);
      } else {
        for (const [index, agentId] of agentOrder.entries()) {
          if ((current.agentAssignments[agentId] ?? null) === action.sectionId) insertionIndex = index + 1;
        }
      }
      agentOrder.splice(insertionIndex, 0, action.agentId);

      const agentAssignments = { ...current.agentAssignments };
      if (action.sectionId === null) delete agentAssignments[action.agentId];
      else agentAssignments[action.agentId] = action.sectionId;
      if (
        arraysEqual(agentOrder, current.agentOrder) &&
        agentAssignments[action.agentId] === current.agentAssignments[action.agentId]
      ) {
        return current;
      }
      return { ...current, revision: current.revision + 1, agentAssignments, agentOrder };
    }
  }
}

function normalizedAgentOrder(order: readonly string[], agentIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const agentId of [...order, ...agentIds]) {
    if (!agentIds.has(agentId) || seen.has(agentId)) continue;
    seen.add(agentId);
    normalized.push(agentId);
  }
  return normalized;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validSectionName(name: string, existing: readonly SidebarSection[]): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error(sourceText("error.backend.sectionNameRequired"));
  if (trimmed.length > INPUT_LIMITS.sidebarSectionName) throw new Error(sourceText("error.backend.sectionNameTooLong"));
  if (existing.some((section) => section.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
    throw new Error(sourceText("error.backend.sectionNameDuplicate"));
  }
  return trimmed;
}

function withParent(section: SidebarSection, parentId: string | undefined): SidebarSection {
  return parentId === undefined
    ? { id: section.id, name: section.name }
    : { id: section.id, name: section.name, parentId };
}

/** 0 for a folder at the top of the list. */
function folderDepth(layout: SidebarLayoutSnapshot, sectionId: string): number {
  return sidebarFolderAncestors(sidebarFolderParents(layout), sectionId).length;
}

function requireCustomSection(layout: SidebarLayoutSnapshot, sectionId: string): SidebarSection {
  const section = layout.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error("Unknown sidebar section.");
  return section;
}

function isStoredSidebarLayout(value: unknown): value is StoredSidebarLayout {
  if (!isDynamicRecord(value) || value.version !== 2 || !isNumber(value.revision)) return false;
  if (!isStoredSidebarLayoutBody(value) || !Array.isArray(value.agentOrder)) return false;
  return (
    value.agentOrder.every(
      (agentId) => isString(agentId) && agentId.length > 0 && agentId.length <= INPUT_LIMITS.identifier,
    ) && new Set(value.agentOrder).size === value.agentOrder.length
  );
}

function isLegacyStoredSidebarLayout(value: unknown): value is LegacyStoredSidebarLayout {
  return isDynamicRecord(value) && value.version === 1 && isStoredSidebarLayoutBody(value);
}

function isStoredSidebarLayoutBody(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (!isNumber(value.revision)) return false;
  if (!Number.isInteger(value.revision) || value.revision < 0) return false;
  if (!Array.isArray(value.sections) || value.sections.length > INPUT_LIMITS.sidebarSections) return false;
  if (!Array.isArray(value.order) || !isDynamicRecord(value.agentAssignments)) return false;

  const sections: SidebarSection[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of value.sections) {
    if (!isDynamicRecord(candidate) || !isString(candidate.id) || !isString(candidate.name)) return false;
    if (!isUuidV4(candidate.id) || candidate.name !== candidate.name.trim() || !candidate.name) return false;
    if (candidate.name.length > INPUT_LIMITS.sidebarSectionName) return false;
    const normalizedName = candidate.name.toLocaleLowerCase();
    if (ids.has(candidate.id) || names.has(normalizedName)) return false;
    ids.add(candidate.id);
    names.add(normalizedName);
    sections.push({ id: candidate.id, name: candidate.name });
  }

  if (!isCompleteSectionOrder(value.order, ids)) return false;
  return Object.entries(value.agentAssignments).every(
    ([agentId, sectionId]) =>
      agentId.length > 0 && agentId.length <= INPUT_LIMITS.identifier && isString(sectionId) && ids.has(sectionId),
  );
}

function snapshotFromStored(stored: StoredSidebarLayout): SidebarLayoutSnapshot {
  return withFolderTree({
    revision: stored.revision,
    sections: stored.sections.map(storedSection),
    order: [...stored.order],
    agentAssignments: { ...stored.agentAssignments },
    agentOrder: [...stored.agentOrder],
  });
}

function snapshotFromLegacyStored(stored: LegacyStoredSidebarLayout): Omit<SidebarLayoutSnapshot, "agentOrder"> {
  return {
    revision: stored.revision,
    sections: stored.sections.map(storedSection),
    order: [...stored.order],
    agentAssignments: { ...stored.agentAssignments },
  };
}

/**
 * The id, the name and a text `parentId`. Other fields are dropped; a parent that is not text is
 * dropped too and the folder goes to the top, so the file is not reset.
 */
function storedSection({ id, name, parentId }: SidebarSection): SidebarSection {
  // The file check above does not read `parentId`, so this check runs on the value in the file.
  return isString(parentId) ? { id, name, parentId } : { id, name };
}
