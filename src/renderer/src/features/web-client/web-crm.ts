import type { AgentEvent, CrmCustomer, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { CRM_ROUTES, crmEvent } from "@openbot/contracts/team-protocol/crm-v1";
import { decodeTeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import {
  decodeRemoteCrmActivityPage,
  decodeRemoteCrmApplyResult,
  decodeRemoteCrmCustomerPage,
  decodeRemoteCrmOverview,
  decodeRemoteCrmPaymentPage,
  decodeRemoteCrmSettings,
} from "@openbot/team-client/crm-decoding";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { CrmHost } from "../crm/crm-port";

export interface WebCrmHostOptions {
  request: () => TeamApiRequest;
  onHostEvent: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;
  syncedCustomers?: () => Promise<CrmCustomer[] | null>;
}

export function webCrmHost(options: WebCrmHostOptions): CrmHost {
  const post = <T>(path: string, decode: (value: unknown) => T, body: unknown): Promise<T> =>
    options.request()("POST", path, decode, decodeTeamProtocolV2Json(body));
  return {
    overview: () => post(CRM_ROUTES.overview, decodeRemoteCrmOverview, {}),
    async customers(after) {
      const synced = after === undefined ? await options.syncedCustomers?.() : null;
      if (synced) return { customers: synced, next: null };
      return post(CRM_ROUTES.customers, decodeRemoteCrmCustomerPage, after === undefined ? {} : { after });
    },
    payments: (input) => post(CRM_ROUTES.payments, decodeRemoteCrmPaymentPage, input),
    activity: (input) => post(CRM_ROUTES.activity, decodeRemoteCrmActivityPage, input),
    apply: (change) => post(CRM_ROUTES.apply, decodeRemoteCrmApplyResult, change),
    sourceConnect: (input) => post(CRM_ROUTES.sourceConnect, decodeRemoteCrmApplyResult, input),
    sourceDisconnect: (input) => post(CRM_ROUTES.sourceDisconnect, decodeRemoteCrmApplyResult, input),
    sourceSync: (input) => post(CRM_ROUTES.sourceSync, decodeRemoteCrmApplyResult, input),
    settings: () => post(CRM_ROUTES.settings, decodeRemoteCrmSettings, {}),
    setSettings: (input) => post(CRM_ROUTES.setSettings, decodeRemoteCrmSettings, input),
    openUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
    onChanged: (listener) =>
      options.onHostEvent((event) => {
        if (event.type === "runtime-snapshot") listener("resync");
        else if (crmEvent(event)) listener("change");
      }),
  };
}
