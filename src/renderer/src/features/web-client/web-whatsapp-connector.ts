// The WhatsApp numbers of the joined server in the browser client (`whatsapp-connector-v1`). The
// host's session gets the QR code or the pairing code, and this tab shows it.

import { runTeamEffect } from "@openbot/team-client";
import {
  type TeamAdminRequestError,
  whatsappConnectorAddOrchestrator,
  whatsappConnectorAddSender,
  whatsappConnectorAnswerRequest,
  whatsappConnectorCancelLink,
  whatsappConnectorDisconnect,
  whatsappConnectorGroups,
  whatsappConnectorLinkState,
  whatsappConnectorOverview,
  whatsappConnectorReconnect,
  whatsappConnectorRemoveSender,
  whatsappConnectorSetEnabled,
  whatsappConnectorSetOwnNumber,
  whatsappConnectorStartLink,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import type { HostWhatsAppApi } from "../connectors/whatsapp-connector";

/** `request` throws for a server that is not connected. */
export function webHostWhatsApp(request: (serverId: string) => TeamApiRequest): HostWhatsAppApi {
  /** `request` can throw, so it runs inside the Effect and a failure rejects the promise. */
  const run = <T>(serverId: string, call: (target: TeamApiRequest) => Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(Effect.suspend(() => call(request(serverId))).pipe(Effect.mapError((error) => error.cause)));
  return {
    hostGetWhatsAppOverview: (serverId) => run(serverId, whatsappConnectorOverview),
    hostStartWhatsAppLink: (input, serverId) => run(serverId, (target) => whatsappConnectorStartLink(target, input)),
    hostGetWhatsAppLinkState: (serverId) => run(serverId, whatsappConnectorLinkState),
    hostCancelWhatsAppLink: (serverId) => run(serverId, whatsappConnectorCancelLink),
    hostDisconnectWhatsAppNumber: (input, serverId) =>
      run(serverId, (target) => whatsappConnectorDisconnect(target, input)),
    hostReconnectWhatsAppNumber: (input, serverId) =>
      run(serverId, (target) => whatsappConnectorReconnect(target, input)),
    hostSetWhatsAppEnabled: (input, serverId) => run(serverId, (target) => whatsappConnectorSetEnabled(target, input)),
    hostAddWhatsAppOrchestrator: (serverId) => run(serverId, whatsappConnectorAddOrchestrator),
    hostListWhatsAppGroups: (input, serverId) => run(serverId, (target) => whatsappConnectorGroups(target, input)),
    hostAddWhatsAppSender: (input, serverId) => run(serverId, (target) => whatsappConnectorAddSender(target, input)),
    hostRemoveWhatsAppSender: (input, serverId) =>
      run(serverId, (target) => whatsappConnectorRemoveSender(target, input)),
    hostAnswerWhatsAppRequest: (input, serverId) =>
      run(serverId, (target) => whatsappConnectorAnswerRequest(target, input)),
    hostSetWhatsAppOwnNumber: (input, serverId) =>
      run(serverId, (target) => whatsappConnectorSetOwnNumber(target, input)),
  };
}
