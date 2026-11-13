import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { Button, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, Show } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useServerSelection } from "./server-selection";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";
import { serversPort } from "./servers-port";

/**
 * One view of the agents of every server this user can reach.
 *
 * The workspace itself shows one server at a time, and everything per-server is disposed on a
 * switch. This sits above that boundary, beside the server list: for each online server it reads
 * the roster through the same `listAgents(serverId)` call the workspace uses, so an offline or
 * older host simply contributes no rows. Agent ids are only unique per server, so every row is
 * keyed by (server, agent) and labelled with its server. Selecting a row switches to its server
 * with that agent pending, as an agent opened from the marketplace does.
 */
export interface AllAgentRow {
  serverId: string;
  serverName: string;
  active: boolean;
  agent: ClientAgentSummary;
}

const AllAgents = createSimpleContext({
  name: "All agents",
  init: () => {
    const { servers } = useServers();
    const [rows, setRows] = createSignal<AllAgentRow[]>([]);
    let generation = 0;

    createEffect(
      () =>
        servers()
          .map((server) => `${server.id}:${server.state}:${server.connectionSequence}:${server.capabilitiesPending}`)
          .join("|"),
      (signature) => {
        if (!signature) return;
        const current = ++generation;
        const online = servers().filter((server) => server.state === "online" && !server.capabilitiesPending);
        void Promise.all(
          online.map(async (server) => {
            const agents = await serversPort()
              .agent.listAgents(server.id)
              .catch((): ClientAgentSummary[] => []);
            return agents.map((agent) => ({
              serverId: server.id,
              serverName: server.name,
              active: server.active,
              agent,
            }));
          }),
        ).then((perServer) => {
          if (current === generation) setRows(perServer.flat());
        });
      },
    );

    return { rows };
  },
});

export const AllAgentsProvider = AllAgents.provider;
export const useAllAgents = AllAgents.use;

/** The cross-server section: agents of the servers that are not open, each under its server name. */
export function AllAgentsSection() {
  const { t } = useText();
  const { rows } = useAllAgents();
  const { servers } = useServers();
  const { selectServer } = useServerSelection();
  const { setPendingAgentSelection } = useServerSwitch();
  const others = () => rows().filter((row) => !row.active);
  return (
    <Show when={servers().length > 1 && others().length > 0}>
      <section aria-label={t("sidebar.allAgents.title")} class="all-agents-section">
        <Text variant="label">{t("sidebar.allAgents.title")}</Text>
        <For each={others()}>
          {(row) => (
            <Button
              variant="ghost"
              onClick={() => {
                setPendingAgentSelection(row.agent.id);
                void selectServer(row.serverId);
              }}
            >
              <Text>{row.agent.name}</Text>
              <Text variant="caption">{t("sidebar.allAgents.onServer", { server: row.serverName })}</Text>
            </Button>
          )}
        </For>
      </section>
    </Show>
  );
}
