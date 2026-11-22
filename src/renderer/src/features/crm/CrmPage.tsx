import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import { Show } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { serverCanAdminister } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import { CrmScreen } from "./CrmScreen";
import { desktopCrmHost } from "./crm-port";

export function CrmPage(props: { serverId: string }) {
  const { servers } = useServers();
  const { agentList } = useAgents();
  const usage = useUsage();
  const allowed = () =>
    usage.crmEnabled() === true &&
    serverCanAdminister(
      servers().find((server) => server.id === props.serverId),
      CRM_CAPABILITY,
    );
  return (
    <Show when={allowed() ? props.serverId : null} keyed>
      {(serverId) => (
        <CrmScreen
          serverId={serverId}
          host={desktopCrmHost(serverId)}
          agents={agentList()}
          connectors={{
            requested: () => usage.crmConnectorsRequest() === serverId,
            taken: usage.takeCrmConnectorsRequest,
          }}
        />
      )}
    </Show>
  );
}
