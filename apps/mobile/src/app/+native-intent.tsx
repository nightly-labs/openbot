import { redirectIncomingLink } from "@/features/links/model/incoming-links";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return redirectIncomingLink(path);
  } catch {
    return "/incoming-link";
  }
}
