import type { CreditTransferRequest } from "@openbot/contracts/credits";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MobileSessionExpiredError } from "@/features/auth/api/mobile-auth";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { moveCredits, readCreditActivity, readCreditsState } from "@/features/settings/api/credits";
import { queryKeys } from "@/features/workspace/model/query-keys";

function retryUnlessSignedOut(count: number, error: Error) {
  return !(error instanceof MobileSessionExpiredError) && count < 2;
}

export function useCreditsState() {
  const { session, handleSessionError } = useMobileSession();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.credits(queryScope),
    queryFn: session
      ? async () => {
          try {
            return await readCreditsState(session);
          } catch (error) {
            handleSessionError(error, session);
            throw error;
          }
        }
      : skipToken,
    retry: retryUnlessSignedOut,
  });
}

export function useCreditActivity(enabled: boolean) {
  const { session, handleSessionError } = useMobileSession();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.creditActivity(queryScope),
    queryFn:
      session && enabled
        ? async () => {
            try {
              return await readCreditActivity(session);
            } catch (error) {
              handleSessionError(error, session);
              throw error;
            }
          }
        : skipToken,
    retry: retryUnlessSignedOut,
  });
}

export function useMoveCredits() {
  const { session, handleSessionError } = useMobileSession();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: CreditTransferRequest) => {
      if (!session) throw new MobileSessionExpiredError();
      try {
        return await moveCredits(session, request);
      } catch (error) {
        handleSessionError(error, session);
        throw error;
      }
    },
    onSuccess: (state) => {
      queryClient.setQueryData(queryKeys.credits(queryScope), state);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.credits(queryScope) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.creditActivity(queryScope) });
    },
  });
}
