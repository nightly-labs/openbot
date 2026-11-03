import { createFileRoute } from "@tanstack/solid-router";
import { handleBrowserApi } from "../../../server/browser-api";
import { readHostLogo } from "../../../server/host-logo";
import {
  hostedServerErrorResponse,
  requestAccountAttribution,
  requestAuthService,
  requestAvatarBucket,
  requestBillingService,
  requestHostedServerService,
  requestHostedSiteService,
  requestRemoteControlPlane,
  requestTeamInviteEmailDelivery,
} from "../../../server/request-auth";
import { requestSourceIp } from "../../../server/source-ip";

function handle({ request }: { request: Request }) {
  return handleBrowserApi(request, {
    auth: requestAuthService(),
    remote: requestRemoteControlPlane(),
    hostLogo: (hostId, version) => readHostLogo(requestAvatarBucket(), hostId, version),
    hosting: requestHostedServerService,
    inviteEmailDelivery: requestTeamInviteEmailDelivery,
    attribution: requestAccountAttribution,
    billing: requestBillingService,
    avatarBucket: requestAvatarBucket,
    hostedSites: requestHostedSiteService,
    sourceIp: requestSourceIp,
    errorResponse: hostedServerErrorResponse,
  });
}

export const Route = createFileRoute("/api/browser/$")({ server: { handlers: { ANY: handle } } });
