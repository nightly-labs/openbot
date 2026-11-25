import type { WorkflowFolderAction } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { WorkflowFoldersStore } from "../backend/workflow-folders-store";
import type { WorkflowsHandle } from "../backend/workflows/workflows";

export interface WorkflowFoldersSources {
  store: Pick<WorkflowFoldersStore, "getSnapshot" | "mutate">;
  workflows: Pick<WorkflowsHandle, "list">;
}

export class WorkflowFoldersService {
  readonly #sources: WorkflowFoldersSources;

  constructor(sources: WorkflowFoldersSources) {
    this.#sources = sources;
  }

  readonly #workflowIds = Effect.fn("WorkflowFolders.workflowIds")(function* (this: WorkflowFoldersService) {
    const summaries = yield* this.#sources.workflows.list();
    return new Set(summaries.map((summary) => summary.id));
  }).bind(this);

  readonly read = Effect.fn("WorkflowFolders.read")(function* (this: WorkflowFoldersService) {
    const workflowIds = yield* this.#workflowIds();
    return this.#sources.store.getSnapshot({ workflowIds });
  }).bind(this);

  readonly change = Effect.fn("WorkflowFolders.change")(function* (
    this: WorkflowFoldersService,
    action: WorkflowFolderAction,
  ) {
    const workflowIds = yield* this.#workflowIds();
    return yield* this.#sources.store.mutate(action, { workflowIds });
  }).bind(this);
}
