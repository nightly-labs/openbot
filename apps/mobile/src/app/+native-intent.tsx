import { isCompanySignInReturn } from "@/features/auth/model/company-sign-in-return";
import { acceptDevelopmentConnectLink } from "@/features/auth/model/development-connect-link";
import { redirectIncomingLink } from "@/features/links/model/incoming-links";
import { isLiveActivityLink, liveActivityRoute } from "@/features/live-activity/model/live-activity-link";
import { isMessagingInstallReturn } from "@/features/servers/model/connectors";
import { isIncomingShareLink } from "@/features/share/model/share-link";
import { holdShareSheet } from "@/features/share/model/share-sheet-opener";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (acceptDevelopmentConnectLink(path, __DEV__)) return null;
  if (isMessagingInstallReturn(path)) return null;
  if (isCompanySignInReturn(path)) return null;
  try {
    if (isLiveActivityLink(path)) return liveActivityRoute(path, initial);
    if (isIncomingShareLink(path)) {
      holdShareSheet();
      return "/incoming-share";
    }
    return redirectIncomingLink(path, initial);
  } catch {
    return "/incoming-link";
  }
}
