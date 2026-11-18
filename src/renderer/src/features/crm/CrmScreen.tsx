import { CrmView } from "@openbot/ui/features/crm/CrmView";
import type { CrmAgent } from "@openbot/ui/features/crm/crm-model";
import type { CrmConnectorsRequest } from "@openbot/ui/features/crm/crm-state";
import { createCrmController } from "./crm-controller";
import type { CrmHost } from "./crm-port";

/**
 * The CRM page with the data of `host`, for the desktop and the web client. Mount it again for
 * another server: it reads one server.
 */
export function CrmScreen(props: {
  serverId: string;
  host: CrmHost;
  agents: readonly CrmAgent[];
  connectors?: CrmConnectorsRequest | undefined;
}) {
  const crm = createCrmController(props.host, props.serverId);
  return (
    <div class="crm-window-page">
      <CrmView
        data={crm.data}
        agents={props.agents}
        selected={crm.selected}
        drawer={crm.drawer}
        initialLayout={crm.initialLayout}
        onLayoutChange={crm.onLayoutChange}
        apply={crm.apply}
        sources={crm.sources}
        onLoadPaid={crm.onLoadPaid}
        onSelect={crm.onSelect}
        connectors={props.connectors}
      />
    </div>
  );
}
