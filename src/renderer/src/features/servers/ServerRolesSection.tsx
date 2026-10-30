import type {
  AgentAccessChange,
  AgentAccessRole,
  AgentAccessSnapshot,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { Alert, AlertContent, AlertDescription } from "@openbot/ui";
import { type RoleAgent, type ServerRolePage, ServerRolesPanel } from "@openbot/ui/features/servers/ServerRoles";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, Show, untrack } from "solid-js";
import { serverCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

/** The role calls of one server's host. The desktop reaches them through main. */
export type HostAgentAccessCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getAgentAccess" | "setAgentAccess">;

export interface ServerAgentAccessOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostAgentAccessCalls;
  /** The agents of this dialog's server, in their order. */
  listAgents: () => Promise<readonly RoleAgent[]>;
}

interface RolesState {
  /** The roles as an owner or admin reads them, or null before they load. */
  snapshot: AgentAccessSnapshot | null;
  agents: readonly RoleAgent[];
  loadError: string | null;
  page: ServerRolePage;
}

export interface ServerRolesSection {
  /** True when this account manages the roles of this server: the Roles tab shows then. */
  available: () => boolean;
  Panel: () => JSX.Element;
  /** The role page, for the dialog header `Roles › Legal`. */
  crumb: () => { title: string; back: () => void } | null;
  /** The custom roles, for the role menu of each member row. Undefined before they load. */
  roles: () => readonly AgentAccessRole[] | undefined;
  setMemberRole(roleId: string, memberId: string, on: boolean): void;
  resetForServer(): void;
}

function copyChange(snapshot: AgentAccessSnapshot): AgentAccessChange {
  return {
    revision: snapshot.revision,
    everyone: { ...snapshot.everyone },
    roles: (snapshot.roles ?? []).map((role) => ({
      ...role,
      agents: { ...role.agents },
      memberIds: [...role.memberIds],
    })),
  };
}

/**
 * Server Settings > Roles (`agent-access-v1`), and the roles of the member rows. Each change saves
 * the whole set with the revision that it read; the host refuses a stale one, and the section reads
 * the roles again.
 */
export function createServerRolesSection(host: ServerSettingsSectionHost, visible: () => boolean): ServerRolesSection {
  const { t, errorMessage } = useText();
  const { props, configured, actionsAvailable, busy, run } = host;
  const calls = (): HostAgentAccessCalls => props.agentAccess?.calls ?? window.openbot.hostAdmin;
  const [state, setState] = createStore<RolesState>({
    snapshot: null,
    agents: [],
    loadError: null,
    page: { kind: "list" },
  });
  /** Bumped for each read, so an answer for an earlier server or read is dropped. */
  let generation = 0;

  const available = () =>
    Boolean(props.agentAccess) &&
    configured() &&
    actionsAvailable() &&
    serverCanAdminister(props.server, AGENT_ACCESS_CAPABILITY);

  function load(serverId: string): void {
    const options = props.agentAccess;
    if (!options) return;
    const current = ++generation;
    Promise.all([calls().getAgentAccess(serverId), options.listAgents()]).then(
      ([snapshot, agents]) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.snapshot = snapshot;
          draft.agents = [...agents];
          draft.loadError = null;
        });
      },
      (error: unknown) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.loadError = errorMessage(error, t("server.roles.loadFailed"));
        });
      },
    );
  }

  // Read again each time Roles or Members shows, so the changes of another admin appear.
  createEffect(
    () => (props.open && visible() && available() ? props.server.id : null),
    (serverId) => {
      if (serverId) untrack(() => load(serverId));
    },
  );

  function save(edit: (change: AgentAccessChange) => void, after?: () => void): void {
    const snapshot = state.snapshot;
    if (!snapshot?.everyone || !snapshot.roles) return;
    const change = copyChange(snapshot);
    edit(change);
    const serverId = props.server.id;
    const request = generation;
    void run("roles", async () => {
      try {
        const next = await calls().setAgentAccess(change, serverId);
        if (request !== generation) return;
        setState((draft) => {
          draft.snapshot = next;
        });
        after?.();
      } catch (error) {
        // Another admin saved first, or the host refused the change: show what it holds now.
        if (request === generation) load(serverId);
        throw error;
      }
    });
  }

  function setPage(page: ServerRolePage): void {
    setState((draft) => {
      draft.page = page;
    });
  }

  function editRole(roleId: string, edit: (role: AgentAccessRole) => void) {
    save((change) => {
      const role = change.roles.find((item) => item.id === roleId);
      if (role) edit(role);
    });
  }

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
        <Show when={state.snapshot}>
          {(snapshot) => (
            <ServerRolesPanel
              agents={[...state.agents]}
              everyone={snapshot().everyone ?? {}}
              roles={snapshot().roles ?? []}
              page={state.page}
              disabled={Boolean(busy())}
              menuMount={host.menuMount()}
              onPage={setPage}
              onCreate={() => {
                const id = crypto.randomUUID();
                save(
                  (change) => {
                    change.roles.push({ id, name: t("server.roles.newRole"), agents: {}, memberIds: [] });
                  },
                  () => setPage({ kind: "role", roleId: id }),
                );
              }}
              onRename={(roleId, name) =>
                editRole(roleId, (role) => {
                  role.name = name;
                })
              }
              onDelete={(roleId) =>
                save(
                  (change) => {
                    change.roles = change.roles.filter((role) => role.id !== roleId);
                  },
                  () => setPage({ kind: "list" }),
                )
              }
              onSetEveryoneLevel={(agentIds, level) =>
                save((change) => {
                  for (const agentId of agentIds) change.everyone[agentId] = level;
                })
              }
              onSetRoleLevel={(roleId, agentIds, level) =>
                editRole(roleId, (role) => {
                  for (const agentId of agentIds) role.agents[agentId] = level;
                })
              }
            />
          )}
        </Show>
      </>
    );
  }

  return {
    available,
    Panel,
    crumb() {
      const page = state.page;
      const back = () => setPage({ kind: "list" });
      if (page.kind === "everyone") return { title: t("server.roles.everyone"), back };
      if (page.kind !== "role") return null;
      const role = state.snapshot?.roles?.find((item) => item.id === page.roleId);
      return role ? { title: role.name, back } : null;
    },
    roles: () => (available() ? state.snapshot?.roles : undefined),
    setMemberRole(roleId, memberId, on) {
      editRole(roleId, (role) => {
        role.memberIds = on
          ? [...role.memberIds.filter((id) => id !== memberId), memberId]
          : role.memberIds.filter((id) => id !== memberId);
      });
    },
    resetForServer() {
      generation++;
      setState((draft) => {
        draft.snapshot = null;
        draft.agents = [];
        draft.loadError = null;
        draft.page = { kind: "list" };
      });
    },
  };
}
