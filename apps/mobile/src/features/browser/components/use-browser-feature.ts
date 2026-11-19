import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useRefreshedMobileFeature } from "@/shared/lib/mobile-features";

/**
 * Whether this app version may show a host's browser: the `browser` flag of the account server the
 * phone signed in to. The flag is off until the first answer, and is read again at most once a minute.
 */
export function useBrowserFeature(): boolean {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const allowed = useRefreshedMobileFeature(apiUrl ?? "", "browser");
  return apiUrl !== null && allowed;
}
