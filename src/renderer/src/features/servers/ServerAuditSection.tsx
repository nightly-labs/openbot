import type { OpenBotDesktopApi, ServerAuditEntry } from "@openbot/contracts/ipc";
import { SERVER_AUDIT_CAPABILITY } from "@openbot/contracts/team-protocol/server-audit-v1";
import { Alert, AlertContent, AlertDescription } from "@openbot/ui";
import { ServerAuditLogPanel } from "@openbot/ui/features/servers/ServerAuditLog";
import type { RoleAgent } from "@openbot/ui/features/servers/ServerRoles";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, Show, untrack } from "solid-js";
import { serverCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

export type HostServerAuditCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getAuditLog">;

export interface ServerAuditOptions {
  calls?: HostServerAuditCalls;
  listAgents: () => Promise<readonly RoleAgent[]>;
}

interface AuditState {
  entries: ServerAuditEntry[] | null;
  agents: readonly RoleAgent[];
  loadError: string | null;
}

export interface ServerAuditSection {
  available: () => boolean;
  Panel: () => JSX.Element;
  resetForServer(): void;
}

export function createServerAuditSection(host: ServerSettingsSectionHost, visible: () => boolean): ServerAuditSection {
  const { t, errorMessage } = useText();
  const { props, configured, actionsAvailable } = host;
  const calls = (): HostServerAuditCalls => props.serverAudit?.calls ?? window.openbot.hostAdmin;
  const [state, setState] = createStore<AuditState>({ entries: null, agents: [], loadError: null });
  let generation = 0;

  const available = () =>
    Boolean(props.serverAudit) &&
    configured() &&
    actionsAvailable() &&
    serverCanAdminister(props.server, SERVER_AUDIT_CAPABILITY);

  function load(serverId: string): void {
    const options = props.serverAudit;
    if (!options) return;
    const current = ++generation;
    const agents = options.listAgents().catch((): readonly RoleAgent[] => []);
    Promise.all([calls().getAuditLog(serverId), agents]).then(
      ([log, agents]) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.entries = log.entries;
          draft.agents = [...agents];
          draft.loadError = null;
        });
      },
      (error: unknown) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.loadError = errorMessage(error, t("server.audit.loadFailed"));
        });
      },
    );
  }

  createEffect(
    () => (props.open && visible() && available() ? props.server.id : null),
    (serverId) => {
      if (serverId) untrack(() => load(serverId));
    },
  );

  function Panel() {
    return (
      <>
        <Show when={state.loadError}>
          {(message) => (
            <Alert tone="danger" role="alert">
              <AlertContent>
                <AlertDescription>{message()}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </Show>
        <Show when={state.entries}>
          {(entries) => (
            <ServerAuditLogPanel entries={entries()} agents={[...state.agents]} menuMount={host.menuMount()} />
          )}
        </Show>
      </>
    );
  }

  return {
    available,
    Panel,
    resetForServer() {
      generation++;
      setState((draft) => {
        draft.entries = null;
        draft.agents = [];
        draft.loadError = null;
      });
    },
  };
}
