import type {
  CrmActivityPage,
  CrmActivityPageInput,
  CrmApplyResult,
  CrmChange,
  CrmCustomerPage,
  CrmOverview,
  CrmPaymentPage,
  CrmPaymentPageInput,
  CrmSettings,
  CrmSourceConnectInput,
  CrmSourceInput,
} from "@openbot/contracts/ipc";
import { CRM_CUSTOMERS_SYNC_COLLECTION } from "@openbot/contracts/team-protocol/sync-collections";
import { appPort } from "../../app-port";

export type CrmChangeCause = "change" | "resync";

export interface CrmHost {
  overview(): Promise<CrmOverview>;
  customers(after?: number): Promise<CrmCustomerPage>;
  payments(input: CrmPaymentPageInput): Promise<CrmPaymentPage>;
  activity(input: CrmActivityPageInput): Promise<CrmActivityPage>;
  apply(change: CrmChange): Promise<CrmApplyResult>;
  sourceConnect(input: CrmSourceConnectInput): Promise<CrmApplyResult>;
  sourceDisconnect(input: CrmSourceInput): Promise<CrmApplyResult>;
  sourceSync(input: CrmSourceInput): Promise<CrmApplyResult>;
  settings(): Promise<CrmSettings>;
  setSettings(input: CrmSettings): Promise<CrmSettings>;
  openUrl(url: string): void;
  onChanged(listener: (cause: CrmChangeCause) => void): () => void;
}

export function desktopCrmHost(serverId: string): CrmHost {
  const api = () => window.openbot.crm;
  return {
    overview: () => api().overview(serverId),
    customers: (after) => api().customers(after === undefined ? {} : { after }, serverId),
    payments: (input) => api().payments(input, serverId),
    activity: (input) => api().activity(input, serverId),
    apply: (change) => api().apply(change, serverId),
    sourceConnect: (input) => api().sourceConnect(input, serverId),
    sourceDisconnect: (input) => api().sourceDisconnect(input, serverId),
    sourceSync: (input) => api().sourceSync(input, serverId),
    settings: () => api().settings(serverId),
    setSettings: (input) => api().setSettings(input, serverId),
    openUrl: (url) => void appPort().openUrl(url),
    onChanged(listener) {
      const events = window.openbot.agent.onScopedEvent((scoped) => {
        if (scoped.serverId === serverId && scoped.event.type === "crm-changed") listener("change");
      });
      const synced = window.openbot.agent.onSyncChanged((change) => {
        if (change.serverId === serverId && change.name === CRM_CUSTOMERS_SYNC_COLLECTION.name) listener("change");
      });
      let online: boolean | undefined;
      const reconnect = window.openbot.servers.onEvent((servers) => {
        const now = servers.some((server) => server.id === serverId && server.state === "online");
        if (now && online === false) listener("resync");
        online = now;
      });
      return () => {
        events();
        synced();
        reconnect();
      };
    },
  };
}
