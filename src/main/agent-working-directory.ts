import { opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import type {
  BrowseWorkingDirectoryInput,
  HostDirectory,
  HostDirectoryEntry,
  SetWorkingDirectoryInput,
  WorkingDirectorySettings,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { effectiveWorkingDirectory } from "../backend/agent/working-directory";
import type { AgentService } from "../backend/agent-service";
import { AgentNotFoundError } from "./agent-admin-settings";

const MAX_WORKING_DIRECTORY_OFFSET = 100_000;
const WORKING_DIRECTORY_SCAN_LIMIT = 1_000;
const WORKING_DIRECTORY_PAGE_SIZE = 100;

export class DirectoryOperationFailed extends Schema.TaggedError<DirectoryOperationFailed>()(
  "DirectoryOperationFailed",
  { cause: Schema.Defect() },
) {}

/** Owns host directory reads. Callers authorize the account before entering this service. */
export class AgentWorkingDirectory {
  constructor(
    private readonly agents: Pick<AgentService, "listAgents" | "workingDirectoryBusy" | "setWorkingDirectory">,
  ) {}
  #agent(agentId: string) {
    const agent = this.agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    return agent;
  }
  read(agentId: string): WorkingDirectorySettings {
    const agent = this.#agent(agentId);
    return {
      workingDirectory: agent.workingDirectory ?? null,
      effectivePath: effectiveWorkingDirectory(agent),
      busy: this.agents.workingDirectoryBusy(agentId),
    };
  }
  readonly update = Effect.fn("AgentWorkingDirectory.update")(function* (
    this: AgentWorkingDirectory,
    input: SetWorkingDirectoryInput,
  ) {
    yield* Effect.try({
      try: () => this.#agent(input.agentId),
      catch: (cause) => new DirectoryOperationFailed({ cause }),
    });
    yield* this.agents
      .setWorkingDirectory(input.agentId, input.path)
      .pipe(Effect.mapError((failure) => new DirectoryOperationFailed({ cause: failure.cause })));
    return this.read(input.agentId);
  }).bind(this);
  readonly browse = Effect.fn("AgentWorkingDirectory.browse")(function* (
    this: AgentWorkingDirectory,
    input: BrowseWorkingDirectoryInput,
  ) {
    const agent = yield* Effect.try({
      try: () => this.#agent(input.agentId),
      catch: (cause) => new DirectoryOperationFailed({ cause }),
    });
    return yield* Effect.tryPromise({
      try: async (): Promise<HostDirectory> => {
        const requested = input.path ?? effectiveWorkingDirectory(agent);
        if (!isAbsolute(requested)) throw new Error("Invalid path.");
        const path = await realpath(requested);
        const roots: HostDirectoryEntry[] = [{ name: basename(homedir()) || homedir(), path: homedir() }];
        if (process.platform === "win32") {
          for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
            const drive = `${letter}:\\`;
            if (
              await stat(drive).then(
                (info) => info.isDirectory(),
                () => false,
              )
            )
              roots.push({ name: drive, path: drive });
          }
        } else roots.push({ name: parse(path).root, path: parse(path).root });
        const entries: HostDirectoryEntry[] = [];
        let rawOffset = 0;
        let scanned = 0;
        let reachedEnd = false;
        let nextOffset: number | null = null;
        // Read one level with a bounded response and without retaining the full listing.
        const directory = await opendir(path);
        try {
          while (
            rawOffset < MAX_WORKING_DIRECTORY_OFFSET &&
            scanned < WORKING_DIRECTORY_SCAN_LIMIT &&
            entries.length < WORKING_DIRECTORY_PAGE_SIZE
          ) {
            const item = await directory.read();
            if (item === null) {
              reachedEnd = true;
              break;
            }
            const itemOffset = rawOffset++;
            if (itemOffset < input.offset) continue;
            scanned += 1;
            if (!input.showHidden && item.name.startsWith(".")) continue;
            const child = join(path, item.name);
            if (
              !item.isDirectory() &&
              !(
                item.isSymbolicLink() &&
                (await stat(child).then(
                  (info) => info.isDirectory(),
                  () => false,
                ))
              )
            )
              continue;
            entries.push({ name: item.name, path: child });
          }
        } finally {
          await directory.close();
        }
        if (!reachedEnd && rawOffset < MAX_WORKING_DIRECTORY_OFFSET) nextOffset = rawOffset;
        return { path, parentPath: dirname(path) === path ? null : dirname(path), roots, entries, nextOffset };
      },
      catch: () =>
        new DirectoryOperationFailed({ cause: new Error(sourceText("error.agent.workingDirectoryUnavailable")) }),
    });
  }).bind(this);
}
