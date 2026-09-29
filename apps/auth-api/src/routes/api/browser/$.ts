import { createFileRoute } from "@tanstack/solid-router";
import { handleBrowserApi } from "../../../server/browser-api";
import { readHostLogo } from "../../../server/host-logo";
import {
  hostedServerErrorResponse,
  requestAuthService,
  requestAvatarBucket,
  requestBillingService,
  requestHostedServerService,
  requestRemoteControlPlane,
  requestRemoteSignalUrl,
  requestSourceIp,
  requestTeamInviteEmailDelivery,
} from "../../../server/request-auth";

function handle({ request }: { request: Request }) {
  return handleBrowserApi(request, {
    auth: requestAuthService(),
    remote: requestRemoteControlPlane(),
    hostLogo: (hostId, version) => readHostLogo(requestAvatarBucket(), hostId, version),
    hosting: requestHostedServerService,
    inviteEmailDelivery: requestTeamInviteEmailDelivery,
    billing: requestBillingService,
    avatarBucket: requestAvatarBucket,
    signalUrl: requestRemoteSignalUrl,
    sourceIp: requestSourceIp,
    errorResponse: hostedServerErrorResponse,
  });
}

export const Route = createFileRoute("/api/browser/$")({ server: { handlers: { ANY: handle } } });
