import { createFileRoute } from "@tanstack/solid-router";
import { handleBrowserApi } from "../../../server/browser-api";
import { readHostLogo } from "../../../server/host-logo";
import {
  hostedServerErrorResponse,
  requestAccountAttribution,
  requestAuthService,
  requestAvatarBucket,
  requestBillingService,
  requestCompanySignIn,
  requestCustomServerOffers,
  requestHostedServerService,
  requestHostedSiteService,
  requestOwnerTransferEmailDelivery,
  requestReferrals,
  requestRemoteControlPlane,
  requestTeamInviteEmailDelivery,
  requestWatchSessions,
  schedule,
} from "../../../server/request-auth";
import { requestSourceIp } from "../../../server/source-ip";

function handle({ request }: { request: Request }) {
  return handleBrowserApi(request, {
    auth: requestAuthService(),
    remote: requestRemoteControlPlane(),
    companySignIn: requestCompanySignIn,
    hostLogo: (hostId, version) => readHostLogo(requestAvatarBucket(), hostId, version),
    hosting: requestHostedServerService,
    customServerOffers: requestCustomServerOffers,
    watchSessions: requestWatchSessions,
    inviteEmailDelivery: requestTeamInviteEmailDelivery,
    ownerTransferEmailDelivery: requestOwnerTransferEmailDelivery,
    schedule,
    attribution: requestAccountAttribution,
    billing: requestBillingService,
    referrals: requestReferrals,
    avatarBucket: requestAvatarBucket,
    hostedSites: requestHostedSiteService,
    sourceIp: requestSourceIp,
    errorResponse: hostedServerErrorResponse,
  });
}

export const Route = createFileRoute("/api/browser/$")({ server: { handlers: { ANY: handle } } });
