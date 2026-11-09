import {
  type ClearableStorageCategory,
  type GetStorageUsageInput,
  type ServerSummary,
  STORAGE_CAPABILITY,
  type StorageUsage,
} from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentProfile } from "@openbot/ui/data";
import type { StoredFileAction, StoredFileRow } from "@openbot/ui/features/files/files-view";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, createSignal, createStore, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { toAgentProfile } from "../../app-message-projection";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { type FilesPort, filesPort } from "./files-port";

/** This computer, or a joined server that serves `storage-v1`. An older host has no storage surface. */
export function serverHasStorage(server: ServerSummary | undefined): server is ServerSummary {
  return Boolean(server && (server.kind === "local" || serverSupportsCapability(server, STORAGE_CAPABILITY)));
}

/** Every member reads storage; the host lets only an owner or admin delete or clear. */
export function canManageStorage(server: ServerSummary): boolean {
  return serverRoleCanAdminister(server);
}

/**
 * The agents of one server, to name the rows of its storage. They are read for that server, because a
 * storage view can be open for a server that is not the selected one.
 */
export function createServerAgents(
  serverId: () => string,
  calls: () => FilesPort = filesPort,
): Accessor<AgentProfile[]> {
  const [agents, setAgents] = createSignal<AgentProfile[]>([]);
  createEffect(serverId, (id) => {
    let current = true;
    untrack(calls)
      .agent.listAgents(id)
      .then((list) => {
        if (current) setAgents(list.map(toAgentProfile));
      })
      // Without names the rows still show their chats and sizes; the storage read reports its own failure.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  });
  return agents;
}

/** One storage scope of one server. Settings can be open for a server that is not the selected one. */
export interface StorageTarget {
  serverId: string;
  input: GetStorageUsageInput;
}

interface StorageUsageState {
  /** Null before the first answer, and for a remote host without `storage-v1`. */
  usage: StorageUsage | null;
  /** The first answer for this target arrived. With `usage` null it means the host needs an update. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

export interface StorageFileHandlers {
  /** Opens the message that shows the file. The row has `messageId` when this is offered. */
  onShowInChat: (file: StoredFileRow) => void;
}

function targetKey(target: StorageTarget | null): string | null {
  if (!target) return null;
  const { scope, agentId, conversationId } = target.input;
  return JSON.stringify([target.serverId, scope, agentId ?? null, conversationId ?? null]);
}

/**
 * The storage of one scope, read when the target appears or changes. The host caches a scan for a
 * minute, so a surface that opens again is quick; a change here asks for a new scan.
 */
export function createStorageUsage(target: () => StorageTarget | null, calls: () => FilesPort = filesPort) {
  const [state, setState] = createStore<StorageUsageState>({
    usage: null,
    loaded: false,
    loading: false,
    error: null,
  });
  let request = 0;

  async function refresh(force = false): Promise<void> {
    const current = target();
    const id = ++request;
    if (!current) {
      setState((draft) => {
        draft.usage = null;
        draft.loaded = false;
        draft.loading = false;
        draft.error = null;
      });
      return;
    }
    setState((draft) => {
      draft.loading = true;
      draft.error = null;
    });
    try {
      const input = force ? { ...current.input, force: true } : current.input;
      const usage = await calls().storage.getUsage(input, current.serverId);
      if (id !== request) return;
      setState((draft) => {
        draft.usage = usage;
        draft.loaded = true;
        draft.loading = false;
      });
    } catch (error) {
      if (id !== request) return;
      const text = currentText();
      setState((draft) => {
        draft.error = text.errorMessage(error, text.t("files.storage.measureFailed"));
        draft.loading = false;
      });
    }
  }

  // A new target never shows the numbers of the previous one, even for the length of a scan.
  createEffect(
    () => targetKey(target()),
    () => {
      setState((draft) => {
        draft.usage = null;
        draft.loaded = false;
      });
      void untrack(() => refresh());
    },
  );

  /** Rejects with the host's reason, so the confirm dialog of the UI shows it. */
  async function clear(category: ClearableStorageCategory): Promise<void> {
    const current = target();
    if (!current) return;
    try {
      await calls().storage.clear({ category }, current.serverId);
    } finally {
      await refresh(true);
    }
  }

  async function fileAction(
    file: StoredFileRow,
    action: StoredFileAction,
    handlers: StorageFileHandlers,
  ): Promise<void> {
    const current = target();
    if (!current) return;
    if (action === "delete") {
      try {
        await calls().storage.deleteFile({ fileId: file.id }, current.serverId);
      } finally {
        await refresh(true);
      }
      return;
    }
    if (action === "retry") return refresh(true);
    if (action === "show-in-chat") return handlers.onShowInChat(file);
    try {
      await calls().storage.openFile({ fileId: file.id, action }, current.serverId);
    } catch (error) {
      const text = currentText();
      actionToast.error(text.t("files.storage.openFailed", { name: file.name }), {
        ...{
          description: text.errorMessage(error, text.t("files.storage.tryAgain")),
        },
        report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
      });
    }
  }

  /**
   * Runs `run` on the files one at a time and tells `onProgress` how many are done. Resolves with the
   * number of files that failed.
   */
  async function eachFile(
    files: readonly StoredFileRow[],
    run: (file: StoredFileRow, serverId: string) => Promise<void>,
    onProgress: ((done: number) => void) | undefined,
  ): Promise<number> {
    const current = target();
    if (!current) return files.length;
    let failed = 0;
    for (const [index, file] of files.entries()) {
      try {
        await run(file, current.serverId);
      } catch {
        failed += 1;
      }
      onProgress?.(index + 1);
    }
    return failed;
  }

  /**
   * Deletes the files one at a time, so a host with `storage-v1` needs no new route, and scans once at
   * the end. Resolves with the number of files that could not be deleted.
   */
  async function deleteFiles(files: readonly StoredFileRow[], onProgress?: (done: number) => void): Promise<number> {
    try {
      return await eachFile(
        files,
        (file, serverId) => calls().storage.deleteFile({ fileId: file.id }, serverId),
        onProgress,
      );
    } finally {
      await refresh(true);
    }
  }

  /** Puts the files in the Downloads folder with no dialog. Resolves with the number that could not be saved. */
  function saveFiles(files: readonly StoredFileRow[], onProgress?: (done: number) => void): Promise<number> {
    return eachFile(
      files,
      (file, serverId) => calls().storage.openFile({ fileId: file.id, action: "save" }, serverId),
      onProgress,
    );
  }

  /** Null while nothing went wrong. A host that answered null predates `storage-v1`. */
  function error(): string | null {
    if (state.error) return state.error;
    return state.loaded && !state.usage ? currentText().t("files.storage.updateServer") : null;
  }

  function scanState(): "scanning" | "ready" | "error" {
    if (state.loading) return "scanning";
    if (error()) return "error";
    return state.loaded ? "ready" : "scanning";
  }

  return { state, error, scanState, refresh, clear, fileAction, deleteFiles, saveFiles };
}

export type StorageUsageResource = ReturnType<typeof createStorageUsage>;
