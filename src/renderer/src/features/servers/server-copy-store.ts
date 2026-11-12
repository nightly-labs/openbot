import type { InstanceTransferResult, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type {
  CopyAgentsAgent,
  CopyAgentsPhase,
  CopyAgentsServer,
} from "@openbot/ui/features/transfer/CopyAgentsDialog";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";

export type ServerCopyCalls = Pick<OpenBotDesktopApi["instanceTransfer"], "summary" | "copy">;

interface ServerCopyState {
  fromId: string;
  toId: string | null;
  fromAgents: CopyAgentsAgent[] | null;
  toAgents: CopyAgentsAgent[] | null;
  /** The load error of each side. A load of one side keeps the error of the other. */
  fromError: string | null;
  toError: string | null;
  phase: CopyAgentsPhase;
  result: InstanceTransferResult | null;
  error: string | null;
}

/**
 * Server settings > Transfer > Copy to another server. It starts from the server of the settings,
 * to the first other server. A choice of the server on the other side swaps the two.
 */
export function createServerCopyStore(
  serverId: string,
  servers: () => readonly CopyAgentsServer[],
  calls: ServerCopyCalls,
) {
  const [state, setState] = createStore<ServerCopyState>({
    fromId: serverId,
    toId: untrack(servers).find((server) => server.id !== serverId)?.id ?? null,
    fromAgents: null,
    toAgents: null,
    fromError: null,
    toError: null,
    phase: "idle",
    result: null,
    error: null,
  });

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
          // A later choice of the server replaces this answer.
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

  /** A new pair of servers starts a new copy. The result of the last copy names the old destination. */
  function reset(draft: ServerCopyState): void {
    draft.phase = "idle";
    draft.result = null;
    draft.error = null;
  }

  const loadError = () => state.fromError ?? state.toError;

  function copy(agentIds: string[]): void {
    const toId = state.toId;
    if (!toId || agentIds.length === 0) return;
    setState((draft) => {
      draft.phase = "copying";
      draft.error = null;
    });
    void calls
      .copy({ fromServerId: state.fromId, agentIds }, toId)
      .then((result) => {
        desktopAnalytics.track("server_transfer_action", { action: "copy", result: "succeeded" });
        setState((draft) => {
          draft.phase = "done";
          draft.result = result;
        });
        load("to", toId);
      })
      .catch((error: unknown) => {
        desktopAnalytics.track("server_transfer_action", {
          action: "copy",
          result: "failed",
          failure_code: "copy_failed",
        });
        setState((draft) => {
          draft.phase = "idle";
          draft.error = message(error, "settings.transfer.copy.failed");
        });
      });
  }

  return { state, loadError, setFrom, setTo, copy };
}

function message(error: unknown, fallback: "settings.transfer.copy.loadFailed" | "settings.transfer.copy.failed") {
  const { t, errorMessage } = currentText();
  return errorMessage(error, t(fallback));
}
