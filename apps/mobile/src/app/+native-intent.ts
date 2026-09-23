import { receiveMobileConnectLink } from "@/features/auth/model/development-connect-link";

// Mobile Connect links carry a one-time ticket, not a screen. Keep them out of
// navigation; DevelopmentConnectLinkHandler redeems the ones a dev build accepts.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  return receiveMobileConnectLink(path, __DEV__) ? null : path;
}
