import {
  type ClearableStorageCategory,
  type GetStorageUsageInput,
  type ServerSummary,
  STORAGE_CAPABILITY,
  type StorageUsage,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import type { StoredFileAction, StoredFileRow } from "@openbot/ui/features/files/files-view";
import { createEffect, createStore } from "solid-js";
import { serverSupportsCapability } from "../servers/server-capabilities";

/** This computer, or a joined server that serves `storage-v1`. An older host has no storage surface. */
export function serverHasStorage(server: ServerSummary | undefined): server is ServerSummary {
  return Boolean(server && (server.kind === "local" || serverSupportsCapability(server, STORAGE_CAPABILITY)));
}

/** Every member reads storage; the host lets only an owner or admin delete or clear. */
export function canManageStorage(server: ServerSummary): boolean {
  return server.kind === "local" || server.role === "owner" || server.role === "admin";
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
export function createStorageUsage(target: () => StorageTarget | null) {
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
      const usage = await window.openbot.storage.getUsage(input, current.serverId);
      if (id !== request) return;
      setState((draft) => {
        draft.usage = usage;
        draft.loaded = true;
        draft.loading = false;
      });
    } catch (error) {
      if (id !== request) return;
      setState((draft) => {
        draft.error = errorMessage(error, "Storage could not be measured.");
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
      void refresh();
    },
  );

  /** Rejects with the host's reason, so the confirm dialog of the UI shows it. */
  async function clear(category: ClearableStorageCategory): Promise<void> {
    const current = target();
    if (!current) return;
    try {
      await window.openbot.storage.clear({ category }, current.serverId);
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
        await window.openbot.storage.deleteFile({ fileId: file.id }, current.serverId);
      } finally {
        await refresh(true);
      }
      return;
    }
    if (action === "retry") return refresh(true);
    if (action === "show-in-chat") return handlers.onShowInChat(file);
    try {
      await window.openbot.storage.openFile({ fileId: file.id, action }, current.serverId);
    } catch (error) {
      toast.error(`Could not open “${file.name}”`, { description: errorMessage(error, "Try again.") });
    }
  }

  /** Null while nothing went wrong. A host that answered null predates `storage-v1`. */
  function error(): string | null {
    if (state.error) return state.error;
    return state.loaded && !state.usage ? "Update OpenBot on this server to see its storage." : null;
  }

  function scanState(): "scanning" | "ready" | "error" {
    if (state.loading) return "scanning";
    if (error()) return "error";
    return state.loaded ? "ready" : "scanning";
  }

  return { state, error, scanState, refresh, clear, fileAction };
}

export type StorageUsageResource = ReturnType<typeof createStorageUsage>;
