import type { InstanceTransferResult, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type {
  CopyAgentsAgent,
  CopyAgentsPhase,
  CopyAgentsProgress,
  CopyAgentsServer,
} from "@openbot/ui/features/transfer/CopyAgentsDialog";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, onCleanup, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";

export type ServerCopyCalls = Pick<OpenBotDesktopApi["instanceTransfer"], "summary" | "copy"> &
  Partial<Pick<OpenBotDesktopApi["instanceTransfer"], "onUploadProgress">>;

interface ServerCopyState {
  fromId: string;
  toId: string | null;
  fromAgents: CopyAgentsAgent[] | null;
  toAgents: CopyAgentsAgent[] | null;
  fromError: string | null;
  toError: string | null;
  phase: CopyAgentsPhase;
  progress: CopyAgentsProgress | null;
  result: InstanceTransferResult | null;
  error: string | null;
}

interface RunningCopy {
  fromId: string;
  toId: string;
  result: Promise<InstanceTransferResult>;
  progress: CopyAgentsProgress | null;
}

const runningCopies = new Map<string, RunningCopy>();

export function createServerCopyStore(
  serverId: string,
  servers: () => readonly CopyAgentsServer[],
  calls: ServerCopyCalls,
) {
  const running = runningCopies.get(serverId);
  const [state, setState] = createStore<ServerCopyState>({
    fromId: running?.fromId ?? serverId,
    toId: running?.toId ?? untrack(servers).find((server) => server.id !== serverId)?.id ?? null,
    fromAgents: null,
    toAgents: null,
    fromError: null,
    toError: null,
    phase: running ? "copying" : "idle",
    progress: running?.progress ?? null,
    result: null,
    error: null,
  });
  let copyingTo: string | null = running?.toId ?? null;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const stopProgress = calls.onUploadProgress?.(({ serverId: target, sent, total, copyStep }) => {
    if (!copyStep || target !== copyingTo || state.phase !== "copying") return;
    setState((draft) => {
      draft.progress = { step: copyStep, sent, total };
    });
  });
  if (stopProgress) onCleanup(stopProgress);

  function load(side: "from" | "to", id: string | null): void {
    setState((draft) => {
      if (side === "from") {
        draft.fromAgents = null;
        draft.fromError = null;
      } else {
        draft.toAgents = null;
        draft.toError = null;
      }
    });
    if (!id) return;
    void calls
      .summary(id)
      .then((summary) =>
        setState((draft) => {
          if ((side === "from" ? draft.fromId : draft.toId) !== id) return;
          if (side === "from") draft.fromAgents = summary.agents;
          else draft.toAgents = summary.agents;
        }),
      )
      .catch((error: unknown) =>
        setState((draft) => {
          if ((side === "from" ? draft.fromId : draft.toId) !== id) return;
          const text = message(error, "settings.transfer.copy.loadFailed");
          if (side === "from") draft.fromError = text;
          else draft.toError = text;
        }),
      );
  }

  createEffect(
    () => state.fromId,
    (id) => load("from", id),
  );
  createEffect(
    () => state.toId,
    (id) => load("to", id),
  );

  function setFrom(id: string): void {
    setState((draft) => {
      if (id === draft.toId) draft.toId = draft.fromId;
      draft.fromId = id;
      reset(draft);
    });
  }

  function setTo(id: string): void {
    setState((draft) => {
      if (id === draft.fromId) draft.fromId = draft.toId ?? id;
      draft.toId = id;
      reset(draft);
    });
  }

  function reset(draft: ServerCopyState): void {
    draft.phase = "idle";
    draft.progress = null;
    draft.result = null;
    draft.error = null;
  }

  const loadError = () => state.fromError ?? state.toError;

  function followCopy(copying: RunningCopy): void {
    const settled = () => {
      if (disposed) return false;
      if (runningCopies.get(serverId) === copying) runningCopies.delete(serverId);
      return true;
    };
    void copying.result.then(
      (result) => {
        if (!settled()) return;
        setState((draft) => {
          draft.phase = "done";
          draft.progress = null;
          draft.result = result;
        });
        load("to", copying.toId);
      },
      (error: unknown) => {
        if (!settled()) return;
        setState((draft) => {
          draft.phase = "idle";
          draft.progress = null;
          draft.error = message(error, "settings.transfer.copy.failed");
        });
      },
    );
  }

  if (running) followCopy(running);

  function copy(agentIds: string[]): void {
    const toId = state.toId;
    if (!toId || agentIds.length === 0) return;
    copyingTo = toId;
    setState((draft) => {
      draft.phase = "copying";
      draft.progress = null;
      draft.error = null;
    });
    const copying: RunningCopy = {
      fromId: state.fromId,
      toId,
      result: calls.copy({ fromServerId: state.fromId, agentIds }, toId),
      progress: null,
    };
    runningCopies.set(serverId, copying);
    const stopKeeping = calls.onUploadProgress?.(({ serverId: target, sent, total, copyStep }) => {
      if (copyStep && target === toId) copying.progress = { step: copyStep, sent, total };
    });
    if (stopKeeping) void copying.result.then(stopKeeping, stopKeeping);
    void copying.result.then(
      () => desktopAnalytics.track("server_transfer_action", { action: "copy", result: "succeeded" }),
      () =>
        desktopAnalytics.track("server_transfer_action", {
          action: "copy",
          result: "failed",
          failure_code: "copy_failed",
        }),
    );
    followCopy(copying);
  }

  return { state, loadError, setFrom, setTo, copy };
}

function message(error: unknown, fallback: "settings.transfer.copy.loadFailed" | "settings.transfer.copy.failed") {
  const { t, errorMessage } = currentText();
  return errorMessage(error, t(fallback));
}
