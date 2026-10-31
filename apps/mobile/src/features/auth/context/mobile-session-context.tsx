import { createRemoteAccountRefresh, runTeamEffect } from "@openbot/team-client";
import { Effect } from "effect";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import {
  followAccountAnalytics,
  loadAnalyticsPreference,
  type SendAnalyticsChoice,
  sendAnalyticsChoice,
} from "@/features/analytics/preference";
import {
  logoutMobileSession,
  type MobileProfileChange,
  type MobileSession,
  MobileSessionExpiredError,
  readMobileSession,
  retryMobileSessionRevocations,
  updateMobileProfile,
  validateMobileSession,
} from "@/features/auth/api/mobile-auth";
import { deleteAgentAvatars } from "@/features/workspace/model/agent-avatar-cache";
import { type QueryScope, queryKeys } from "@/features/workspace/model/query-keys";
import { queryClient } from "@/shared/lib/query-client";
import { untilForeground } from "@/shared/lib/until-foreground";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

import { resolveSessionValidation } from "./session-validation";

interface MobileSessionContextValue {
  loading: boolean;
  session: MobileSession | null;
  sessionScope: number;
  refreshProfile: () => Promise<void>;
  handleSessionError: (error: unknown, initiatingSession: MobileSession) => void;
  connect: (session: MobileSession) => void;
  signOut: () => Promise<void>;
  updateProfile: (change: MobileProfileChange) => Promise<MobileSession>;
  /** Sends this phone's unsent analytics choice to the account. */
  sendAnalyticsChoice: () => Promise<void>;
}

const MobileSessionContext = createContext<MobileSessionContextValue | null>(null);

export function MobileSessionProvider({ children }: PropsWithChildren) {
  const [sessionState, setSessionState] = useState<MobileSession | null | undefined>(undefined);
  const sessionRef = useRef<MobileSession | null>(null);
  const sessionScope = useRef(0);
  const foreground = useAppForeground();
  const foregroundRef = useRef(foreground);
  foregroundRef.current = foreground;
  const validation = useRef<ReturnType<typeof createRemoteAccountRefresh> | null>(null);
  const refreshProfileRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshProfile = useCallback(() => refreshProfileRef.current(), []);

  const setCurrentSession = useCallback((session: MobileSession | null) => {
    if (sessionRef.current?.sessionToken !== session?.sessionToken || sessionRef.current?.apiUrl !== session?.apiUrl) {
      sessionScope.current += 1;
      queryClient.removeQueries({ queryKey: queryKeys.accountSessions() });
      // The hosted server plans keep the last answer for the life of the app; a new session drops it.
      queryClient.removeQueries({ queryKey: queryKeys.hostedServerPlans() });
    }
    mobileAnalytics.setUser(session?.user ?? null);
    sessionRef.current = session;
    setSessionState(session);
  }, []);

  const handleSessionError = useCallback(
    (error: unknown, initiatingSession: MobileSession) => {
      if (
        error instanceof MobileSessionExpiredError &&
        sessionRef.current?.sessionToken === initiatingSession.sessionToken &&
        sessionRef.current?.apiUrl === initiatingSession.apiUrl
      )
        setCurrentSession(null);
    },
    [setCurrentSession],
  );

  useEffect(() => {
    let active = true;
    const scope = sessionScope.current;
    void untilForeground().then(loadAnalyticsPreference);
    const read = () =>
      readMobileSession().then((stored) => {
        if (active && scope === sessionScope.current) setCurrentSession(stored);
      });
    // A start in the background can find the keychain closed. The app reads again when the user
    // opens it, so it does not show sign-in for a session that it still has.
    void read()
      .catch(() => untilForeground().then(read))
      .catch(() => {
        if (active && scope === sessionScope.current) setCurrentSession(null);
      });
    return () => {
      active = false;
    };
  }, [setCurrentSession]);

  const credentialToken = sessionState?.sessionToken;
  const credentialApiUrl = sessionState?.apiUrl;
  useEffect(() => {
    if (!credentialToken || !credentialApiUrl) return;
    let active = true;
    const controller = createRemoteAccountRefresh(() =>
      Effect.tryPromise(async () => {
        const current = sessionRef.current;
        if (!current) return;
        await validateMobileSession(current, (validated) => {
          if (!active) return;
          const next = resolveSessionValidation(sessionRef.current, current, validated);
          if (next !== sessionRef.current) setCurrentSession(next);
        });
      }),
    );
    validation.current = controller;
    refreshProfileRef.current = () => {
      controller.invalidate();
      return runTeamEffect(controller.refresh()).catch(() => undefined);
    };
    controller.setActive(foregroundRef.current);
    return () => {
      active = false;
      controller.dispose();
      validation.current = null;
      refreshProfileRef.current = async () => undefined;
    };
  }, [credentialToken, credentialApiUrl, setCurrentSession]);

  useEffect(() => {
    validation.current?.setActive(foreground);
    if (foreground) void retryMobileSessionRevocations();
  }, [foreground]);

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    await mobileAnalytics.operation("account_sign_out", {}, () => logoutMobileSession(current));
    deleteAgentAvatars();
    if (sessionRef.current?.sessionToken === current.sessionToken && sessionRef.current?.apiUrl === current.apiUrl) {
      setCurrentSession(null);
    }
  }, [setCurrentSession]);

  const updateProfile = useCallback(
    async (change: MobileProfileChange) => {
      const current = sessionRef.current;
      if (!current) throw new MobileSessionExpiredError();
      try {
        return await updateMobileProfile(current, change, (updated) => {
          const next = resolveSessionValidation(sessionRef.current, current, updated);
          if (next !== sessionRef.current) setCurrentSession(next);
        });
      } catch (error) {
        handleSessionError(error, current);
        throw error;
      }
    },
    [handleSessionError, setCurrentSession],
  );

  const sendAnalytics = useCallback<SendAnalyticsChoice>(
    async (enabled, ageMs) => (await updateProfile({ analyticsEnabled: enabled, ageMs })).user.analyticsEnabled ?? null,
    [updateProfile],
  );
  const sendUnsentAnalytics = useCallback(() => sendAnalyticsChoice(sendAnalytics), [sendAnalytics]);

  // The account keeps the user's latest analytics answer. This phone sends its unsent choice, or
  // follows the account. A failed send stays marked for the next profile refresh.
  const accountAnalytics = sessionState?.user.analyticsEnabled;
  const signedIn = Boolean(sessionState);
  useEffect(() => {
    if (!signedIn) return;
    void followAccountAnalytics(accountAnalytics, sendAnalytics).catch(() => undefined);
  }, [signedIn, accountAnalytics, sendAnalytics]);

  const value = useMemo<MobileSessionContextValue>(
    () => ({
      loading: sessionState === undefined,
      session: sessionState ?? null,
      sessionScope: sessionScope.current,
      refreshProfile,
      handleSessionError,
      connect: setCurrentSession,
      signOut,
      updateProfile,
      sendAnalyticsChoice: sendUnsentAnalytics,
    }),
    [sessionState, setCurrentSession, signOut, updateProfile, sendUnsentAnalytics, handleSessionError, refreshProfile],
  );

  return <MobileSessionContext.Provider value={value}>{children}</MobileSessionContext.Provider>;
}

export function useMobileSession(): MobileSessionContextValue {
  const value = useContext(MobileSessionContext);
  if (!value) throw new Error("useMobileSession must be used within MobileSessionProvider.");
  return value;
}

/** The account part of the query keys (`queryKeys`). */
export function useQueryScope(): QueryScope {
  const { session, sessionScope } = useMobileSession();
  return [session?.apiUrl, session?.user.id, sessionScope];
}
