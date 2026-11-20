import { skipToken, useQuery } from "@tanstack/react-query";
import { MobileSessionExpiredError } from "@/features/auth/api/mobile-auth";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { readReferralState } from "@/features/settings/api/referrals";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useReferralState() {
  const { session, handleSessionError } = useMobileSession();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.referrals(queryScope),
    queryFn: session
      ? async () => {
          try {
            return await readReferralState(session);
          } catch (error) {
            handleSessionError(error, session);
            throw error;
          }
        }
      : skipToken,
    retry: (count, error) => !(error instanceof MobileSessionExpiredError) && count < 2,
  });
}
