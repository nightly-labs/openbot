import { useEffect } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";

export function useBrowserFeature(): boolean {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const allowed = useMobileFeature(apiUrl ?? "", "browser");
  useEffect(() => {
    if (apiUrl) void refreshMobileFeatures(apiUrl);
  }, [apiUrl]);
  return apiUrl !== null && allowed;
}
