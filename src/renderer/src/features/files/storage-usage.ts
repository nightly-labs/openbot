import {
  type ClearableStorageCategory,
  type GetStorageUsageInput,
  type ServerSummary,
  STORAGE_CAPABILITY,
  type StorageUsage,
} from "@openbot/contracts/ipc";
import { BACKGROUND_PROCESSES_CAPABILITY } from "@openbot/contracts/team-protocol/background-processes-v1";
import { STORAGE_CHANNEL_CAPABILITY } from "@openbot/contracts/team-protocol/storage-channel-v1";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentProfile } from "@openbot/ui/data";
import type { StoredFileAction, StoredFileRow } from "@openbot/ui/features/files/files-view";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, createSignal, createStore, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { toAgentProfile } from "../../app-message-projection";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { type FilesPort, filesPort } from "./files-port";

export function serverHasStorage(server: ServerSummary | undefined): server is ServerSummary {
  return Boolean(server && (server.kind === "local" || serverSupportsCapability(server, STORAGE_CAPABILITY)));
}

export function serverHasBackgroundProcesses(server: ServerSummary | undefined): server is ServerSummary {
  return (
    serverHasStorage(server) &&
    (server.kind === "local" || serverSupportsCapability(server, BACKGROUND_PROCESSES_CAPABILITY))
  );
}

export function serverHasChannelStorage(server: ServerSummary | undefined): server is ServerSummary {
  return Boolean(server && (server.kind === "local" || serverSupportsCapability(server, STORAGE_CHANNEL_CAPABILITY)));
}

export function hostedPlanStorageGb(server: ServerSummary | undefined): number | null {
  return server?.hosted === true && server.storageGb !== undefined ? server.storageGb : null;
}

export function canManageStorage(server: ServerSummary): boolean {
  return serverRoleCanAdminister(server);
}

export function createServerAgents(
  serverId: () => string,
  calls: () => FilesPort = filesPort,
): Accessor<AgentProfile[] | undefined> {
  const [agents, setAgents] = createSignal<AgentProfile[] | undefined>(undefined);
  createEffect(serverId, (id) => {
    setAgents(undefined);
    let current = true;
    untrack(calls)
      .agent.listAgents(id)
      .then((list) => {
        if (current) setAgents(list.map(toAgentProfile));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  });
  return agents;
}

export interface StorageTarget {
  serverId: string;
  input: GetStorageUsageInput;
}

interface StorageUsageState {
  usage: StorageUsage | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const USAGE_CACHE_LIMIT = 16;
const usageCache = new Map<string, StorageUsage>();

export function clearStorageUsageCache(): void {
  usageCache.clear();
}

export interface StorageFileHandlers {
  onShowInChat: (file: StoredFileRow) => void;
}

function targetKey(target: StorageTarget | null): string | null {
  if (!target) return null;
  const { scope, agentId, conversationId } = target.input;
  return JSON.stringify([target.serverId, scope, agentId ?? null, conversationId ?? null]);
}

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
      const key = targetKey(current);
      if (key) {
        if (usage) {
          usageCache.delete(key);
          usageCache.set(key, usage);
          while (usageCache.size > USAGE_CACHE_LIMIT) {
            const oldest = usageCache.keys().next().value;
            if (oldest === undefined) break;
            usageCache.delete(oldest);
          }
        } else {
          usageCache.delete(key);
        }
      }
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

  createEffect(
    () => targetKey(target()),
    (key) => {
      const cached = key ? usageCache.get(key) : undefined;
      setState((draft) => {
        draft.usage = cached ?? null;
        draft.loaded = cached !== undefined;
      });
      void untrack(() => refresh());
    },
  );

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

  function saveFiles(files: readonly StoredFileRow[], onProgress?: (done: number) => void): Promise<number> {
    return eachFile(
      files,
      (file, serverId) => calls().storage.openFile({ fileId: file.id, action: "save" }, serverId),
      onProgress,
    );
  }

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
