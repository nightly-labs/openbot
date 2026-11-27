import type { CrmActor } from "@openbot/contracts/ipc";
import { CRM_CAPABILITY, CRM_ROUTES } from "@openbot/contracts/team-protocol/crm-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  decodeRemoteCrmActivityPage,
  decodeRemoteCrmApplyResult,
  decodeRemoteCrmCustomerPage,
  decodeRemoteCrmOverview,
  decodeRemoteCrmPaymentPage,
  decodeRemoteCrmSettings,
} from "@openbot/team-client/crm-decoding";
import { Effect } from "effect";
import type { CrmPeopleOperations } from "../../backend/crm/crm-handle";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteServerSync } from "../remote-server-sync";
import type { RemoteWorkflowError } from "../remote-service-effects";
import {
  parseCrmActivityPage,
  parseCrmChange,
  parseCrmCustomerPage,
  parseCrmPaymentPage,
  parseCrmSettings,
  parseCrmSource,
  parseCrmSourceConnect,
} from "./crm-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

interface CrmRemoteServers {
  supportsCapability(serverId: string, capability: typeof CRM_CAPABILITY): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
  readonly sync: Pick<RemoteServerSync, "crmCustomerPage">;
}

interface CrmIpcDependencies {
  crm: CrmPeopleOperations;
  remoteServers: CrmRemoteServers;
}

const LOCAL_PERSON: CrmActor = { kind: "person", id: null, name: null };

export function crmIpcHandlers({ crm, remoteServers }: CrmIpcDependencies): Pick<IpcGroupHandlers, "crm"> {
  function remote<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: unknown): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, CRM_CAPABILITY))
      throw new Error(sourceText("error.crm.serverTooOld"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    crm: {
      overview: scopedQueryHandler({
        local: () => Effect.runPromise(crm.overview()),
        remote: (serverId) => remote(serverId, CRM_ROUTES.overview, decodeRemoteCrmOverview, {}),
      }),
      customers: scopedHandler(parseCrmCustomerPage, {
        local: (input) => Effect.runPromise(crm.customers(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CRM_CAPABILITY))
            throw new Error(sourceText("error.crm.serverTooOld"));
          return (
            remoteServers.sync.crmCustomerPage(serverId, input) ??
            remote(serverId, CRM_ROUTES.customers, decodeRemoteCrmCustomerPage, input)
          );
        },
      }),
      payments: scopedHandler(parseCrmPaymentPage, {
        local: (input) => Effect.runPromise(crm.payments(input)),
        remote: (input, serverId) => remote(serverId, CRM_ROUTES.payments, decodeRemoteCrmPaymentPage, input),
      }),
      activity: scopedHandler(parseCrmActivityPage, {
        local: (input) => Effect.runPromise(crm.activity(input)),
        remote: (input, serverId) => remote(serverId, CRM_ROUTES.activity, decodeRemoteCrmActivityPage, input),
      }),
      apply: scopedHandler(parseCrmChange, {
        local: (change) => Effect.runPromise(crm.apply(change, LOCAL_PERSON)),
        remote: (change, serverId) => remote(serverId, CRM_ROUTES.apply, decodeRemoteCrmApplyResult, change),
      }),
      sourceConnect: scopedHandler(parseCrmSourceConnect, {
        local: (input) => Effect.runPromise(crm.sourceConnect(input)),
        remote: (input, serverId) => remote(serverId, CRM_ROUTES.sourceConnect, decodeRemoteCrmApplyResult, input),
      }),
      sourceDisconnect: scopedHandler(parseCrmSource, {
        local: (input) => Effect.runPromise(crm.sourceDisconnect(input)),
        remote: (input, serverId) => remote(serverId, CRM_ROUTES.sourceDisconnect, decodeRemoteCrmApplyResult, input),
      }),
      sourceSync: scopedHandler(parseCrmSource, {
        local: (input) => Effect.runPromise(crm.sourceSync(input)),
        remote: (input, serverId) => remote(serverId, CRM_ROUTES.sourceSync, decodeRemoteCrmApplyResult, input),
      }),
      settings: scopedQueryHandler({
        local: () => Effect.runPromise(crm.settings()),
        remote: (serverId) => remote(serverId, CRM_ROUTES.settings, decodeRemoteCrmSettings, {}),
      }),
      setSettings: scopedHandler(parseCrmSettings, {
        local: (input) => Effect.runPromise(crm.setSettings(input)),
        remote: (input, serverId) => remote(serverId, CRM_ROUTES.setSettings, decodeRemoteCrmSettings, input),
      }),
    },
  };
}
