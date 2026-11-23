import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  applyWorkflowFolderAction,
  decodeWorkflowFoldersSnapshot,
  EMPTY_WORKFLOW_FOLDERS,
  prunedWorkflowFolders,
  WORKFLOW_FOLDER_LIMITS,
  type WorkflowFolderAction,
  type WorkflowFolderContext,
  WorkflowFolderRefusal,
  type WorkflowFolderRefusalReason,
  type WorkflowFoldersSnapshot,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Semaphore } from "effect";
import { writeFileAtomically } from "./atomic-json-file";
import { StoredStateFailure, storedIO, storedSync } from "./stored-state-effects";
import { readVersionedJsonFile, type VersionedJsonFormat } from "./versioned-json-store";

export const WORKFLOW_FOLDERS_FILE = "openbot-workflow-folders-v1.json";

const STORED_VERSION = 1;

const WORKFLOW_FOLDERS_FORMAT: VersionedJsonFormat<WorkflowFoldersSnapshot> = {
  current: STORED_VERSION,
  releases: { 1: decodeWorkflowFoldersSnapshot },
};

export class WorkflowFolderChangeRefused extends Error {
  readonly reason: WorkflowFolderRefusalReason;

  constructor(reason: WorkflowFolderRefusalReason) {
    super(refusalText(reason));
    this.name = "WorkflowFolderChangeRefused";
    this.reason = reason;
  }
}

function refusalText(reason: WorkflowFolderRefusalReason): string {
  switch (reason) {
    case "name":
      return sourceText("error.backend.libraryFolderName", { limit: WORKFLOW_FOLDER_LIMITS.name });
    case "folder-limit":
      return sourceText("error.backend.workflowFolderLimit", { limit: WORKFLOW_FOLDER_LIMITS.folders });
    case "placement-limit":
      return sourceText("error.backend.workflowFolderPlacementLimit");
    case "unknown-folder":
      return sourceText("error.backend.libraryFolderGone");
    case "unknown-workflow":
      return sourceText("error.workflow.missing");
    case "taken-id":
      return "Invalid workflow folder.";
  }
}

function apply(
  current: WorkflowFoldersSnapshot,
  action: WorkflowFolderAction,
  context: WorkflowFolderContext,
): WorkflowFoldersSnapshot {
  try {
    return applyWorkflowFolderAction(current, action, context);
  } catch (error) {
    if (error instanceof WorkflowFolderRefusal) throw new WorkflowFolderChangeRefused(error.reason);
    throw error;
  }
}

export class WorkflowFoldersStore {
  readonly #path: string;
  #writePath: string;
  #snapshot = structuredClone(EMPTY_WORKFLOW_FOLDERS);
  readonly #operationQueue = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<() => void>();

  constructor(path: string) {
    this.#path = path;
    this.#writePath = path;
  }

  initialize() {
    return Effect.gen({ self: this }, function* () {
      yield* storedIO(() => mkdir(dirname(this.#path), { recursive: true, mode: 0o700 }));
      const loaded = yield* readVersionedJsonFile(this.#path, WORKFLOW_FOLDERS_FORMAT);
      this.#writePath = loaded.writePath;
      this.#snapshot = loaded.value ?? structuredClone(EMPTY_WORKFLOW_FOLDERS);
    });
  }

  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getSnapshot(context: WorkflowFolderContext): WorkflowFoldersSnapshot {
    return structuredClone(prunedWorkflowFolders(this.#snapshot, context.workflowIds));
  }

  mutate(
    action: WorkflowFolderAction,
    context: WorkflowFolderContext,
  ): Effect.Effect<WorkflowFoldersSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const current = prunedWorkflowFolders(this.#snapshot, context.workflowIds);
        const next = yield* storedSync(() => apply(current, action, context));
        if (next !== current) yield* this.#commit(next);
        return this.getSnapshot(context);
      }),
    );
  }

  #enqueue<T, E>(operation: Effect.Effect<T, E>): Effect.Effect<T, E> {
    return this.#operationQueue.withPermit(operation.pipe(Effect.uninterruptible));
  }

  #commit = Effect.fn("WorkflowFolders.commit")(function* (this: WorkflowFoldersStore, next: WorkflowFoldersSnapshot) {
    yield* writeFileAtomically(this.#writePath, `${JSON.stringify({ version: STORED_VERSION, ...next })}\n`).pipe(
      Effect.mapError(({ cause }) => new StoredStateFailure({ cause })),
    );
    this.#snapshot = next;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {}
    }
  });
}
