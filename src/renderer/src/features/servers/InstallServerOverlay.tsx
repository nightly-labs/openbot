import type { ServerClaim } from "@openbot/contracts/hosted-servers";
import type { ServerSummary } from "@openbot/contracts/ipc";
import type { InstallServerStep } from "@openbot/ui/features/servers/InstallServerDialog";
import { createMemo, createStore, Loading, onCleanup, onSettled, Show, untrack } from "solid-js";
import { InstallServerDialog } from "../../lazy-views";
import { retryNewServer } from "./new-server-retry";

export interface InstallServerOverlayProps {
  open: boolean;
  servers: readonly ServerSummary[];
  createClaim: () => Promise<ServerClaim>;
  retryConnection: (serverId: string) => Promise<unknown>;
  onSetUpWithAgent?: (() => void) | undefined;
  onOpenServer: (serverId: string) => void;
  onClose: () => void;
}

export function InstallServerOverlay(props: InstallServerOverlayProps) {
  return (
    <Show when={props.open}>
      <Loading>
        <InstallServerSession {...props} />
      </Loading>
    </Show>
  );
}

interface InstallServerState {
  step: "making" | "waiting" | "expired" | "failed";
  claim: ServerClaim | null;
  error: unknown;
  knownIds: readonly string[];
}

function InstallServerSession(props: InstallServerOverlayProps) {
  const [state, setState] = createStore<InstallServerState>({
    step: "making",
    claim: null,
    error: null,
    knownIds: [],
  });
  let request = 0;
  let expiry: number | undefined;
  onCleanup(() => {
    request += 1;
    window.clearTimeout(expiry);
  });

  async function newCommand(): Promise<void> {
    const current = ++request;
    window.clearTimeout(expiry);
    const knownIds = untrack(() => props.servers.map((server) => server.id));
    setState((draft) => {
      draft.step = "making";
      draft.claim = null;
      draft.error = null;
      draft.knownIds = knownIds;
    });
    try {
      const claim = await props.createClaim();
      if (current !== request) return;
      setState((draft) => {
        draft.step = "waiting";
        draft.claim = claim;
      });
      expiry = window.setTimeout(
        () => {
          if (current !== request) return;
          setState((draft) => {
            draft.step = "expired";
          });
        },
        Math.max(0, claim.expiresAt - Date.now()),
      );
    } catch (error) {
      if (current !== request) return;
      setState((draft) => {
        draft.step = "failed";
        draft.error = error;
      });
    }
  }

  onSettled(() => {
    void newCommand();
  });

  const newServer = createMemo(() => {
    if (state.step !== "waiting" && state.step !== "expired") return undefined;
    const known = new Set(state.knownIds);
    return props.servers.find((server) => server.kind === "remote" && !known.has(server.id));
  });

  retryNewServer(newServer, (serverId) => props.retryConnection(serverId));

  function step(): InstallServerStep {
    const server = newServer();
    if (!server) return state.step;
    return server.state === "online" ? "connected" : "starting";
  }

  function serverName(): string | null {
    return newServer()?.name ?? null;
  }

  return (
    <InstallServerDialog
      step={step()}
      claim={state.claim}
      serverName={serverName()}
      error={state.error}
      onNewCommand={() => void newCommand()}
      onSetUpWithAgent={props.onSetUpWithAgent}
      onOpenServer={() => {
        const server = newServer();
        if (!server) return;
        props.onClose();
        props.onOpenServer(server.id);
      }}
      onClose={props.onClose}
    />
  );
}
