import { acceptDevelopmentConnectLink } from "@/features/auth/model/development-connect-link";
import { redirectIncomingLink } from "@/features/links/model/incoming-links";
import { isLiveActivityLink, liveActivityRoute } from "@/features/live-activity/model/live-activity-link";
import { isMessagingInstallReturn } from "@/features/servers/model/connectors";
import { isIncomingShareLink } from "@/features/share/model/share-link";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  // `bun run dev:mobile` pairs a simulator without a tap. DevelopmentConnectLinkHandler redeems it.
  if (acceptDevelopmentConnectLink(path, __DEV__)) return null;
  // The browser session of Server settings › Connectors takes the return of a Slack or Discord install.
  // The same link from another place has no install to finish, so it opens nothing.
  if (isMessagingInstallReturn(path)) return null;
  try {
    if (isLiveActivityLink(path)) return liveActivityRoute(path, initial);
    if (isIncomingShareLink(path)) return "/incoming-share";
    return redirectIncomingLink(path);
  } catch {
    return "/incoming-link";
  }
}
