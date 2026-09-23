import { acceptDevelopmentConnectLink } from "@/features/auth/model/development-connect-link";
import { redirectIncomingLink } from "@/features/links/model/incoming-links";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // `bun run dev:mobile` pairs a simulator without a tap. DevelopmentConnectLinkHandler redeems it.
  if (acceptDevelopmentConnectLink(path, __DEV__)) return null;
  try {
    return redirectIncomingLink(path);
  } catch {
    return "/incoming-link";
  }
}
