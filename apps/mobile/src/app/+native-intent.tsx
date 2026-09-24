import { acceptDevelopmentConnectLink } from "@/features/auth/model/development-connect-link";
import { redirectIncomingLink } from "@/features/links/model/incoming-links";
import { isLiveActivityLink, liveActivityRoute } from "@/features/live-activity/model/live-activity-link";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  // `bun run dev:mobile` pairs a simulator without a tap. DevelopmentConnectLinkHandler redeems it.
  if (acceptDevelopmentConnectLink(path, __DEV__)) return null;
  try {
    if (isLiveActivityLink(path)) return liveActivityRoute(path, initial);
    return redirectIncomingLink(path);
  } catch {
    return "/incoming-link";
  }
}
