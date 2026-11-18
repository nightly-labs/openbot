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
import { appPort } from "../../app-port";

/**
 * The CRM of one server. The desktop reads it through main (`window.openbot.crm`); the web client
 * reads it through the `crm-v1` routes of the connected host.
 */
export interface CrmHost {
  overview(): Promise<CrmOverview>;
  /** The customers after the number `after`, at most 500. */
  customers(after?: number): Promise<CrmCustomerPage>;
  payments(input: CrmPaymentPageInput): Promise<CrmPaymentPage>;
  activity(input: CrmActivityPageInput): Promise<CrmActivityPage>;
  apply(change: CrmChange): Promise<CrmApplyResult>;
  /** Connects a payment source with a restricted read-only key. The key never comes back. */
  sourceConnect(input: CrmSourceConnectInput): Promise<CrmApplyResult>;
  sourceDisconnect(input: CrmSourceInput): Promise<CrmApplyResult>;
  /** Starts a sync now. The CRM changes when it ends. */
  sourceSync(input: CrmSourceInput): Promise<CrmApplyResult>;
  /** The Server Settings > Experimental switch. Off hides the CRM and stops its agents and sync. */
  settings(): Promise<CrmSettings>;
  setSettings(input: CrmSettings): Promise<CrmSettings>;
  /** Opens a web page in the browser of this computer. */
  openUrl(url: string): void;
  /**
   * Calls `listener` when the CRM changes on the host, from any device or agent, and when the host is
   * online again. Returns the unsubscribe.
   */
  onChanged(listener: () => void): () => void;
}

/** The CRM of `serverId` on the desktop. Main answers a joined server through `crm-v1`. */
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
        if (scoped.serverId === serverId && scoped.event.type === "crm-changed") listener();
      });
      // A change while the server was offline sends no event, so the CRM reads again when it is back.
      let online: boolean | undefined;
      const reconnect = window.openbot.servers.onEvent((servers) => {
        const now = servers.some((server) => server.id === serverId && server.state === "online");
        if (now && online === false) listener();
        online = now;
      });
      return () => {
        events();
        reconnect();
      };
    },
  };
}
