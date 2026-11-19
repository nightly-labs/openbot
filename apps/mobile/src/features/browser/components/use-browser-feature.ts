import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useRefreshedMobileFeature } from "@/shared/lib/mobile-features";

export function useBrowserFeature(): boolean {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const allowed = useRefreshedMobileFeature(apiUrl ?? "", "browser");
  return apiUrl !== null && allowed;
}
