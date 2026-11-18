import { skipToken, useQuery } from "@tanstack/react-query";
import { MobileSessionExpiredError } from "@/features/auth/api/mobile-auth";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { readBillingState } from "@/features/settings/api/billing";
import { queryKeys } from "@/features/workspace/model/query-keys";

/**
 * The plans of the account's hosted servers, as Settings > Billing and its row read them. `enabled`
 * is the cloudServers feature flag: with the flag off, the phone does not read billing.
 */
export function useBillingState(enabled: boolean) {
  const { session, handleSessionError } = useMobileSession();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.billing(queryScope),
    queryFn:
      session && enabled
        ? async () => {
            try {
              return await readBillingState(session);
            } catch (error) {
              handleSessionError(error, session);
              throw error;
            }
          }
        : skipToken,
    retry: (count, error) => !(error instanceof MobileSessionExpiredError) && count < 2,
  });
}
