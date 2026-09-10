import { createRemoteAccountRefresh } from "@openbot/team-client";
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
import { queryClient } from "@/shared/lib/query-client";
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
  updateProfile: (change: MobileProfileChange) => Promise<void>;
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
      queryClient.removeQueries({ queryKey: ["account-sessions"] });
    }
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
    void readMobileSession()
      .then((stored) => {
        if (active && scope === sessionScope.current) setCurrentSession(stored);
      })
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
    const controller = createRemoteAccountRefresh(async () => {
      const current = sessionRef.current;
      if (!current) return;
      await validateMobileSession(current, (validated) => {
        if (!active) return;
        const next = resolveSessionValidation(sessionRef.current, current, validated);
        if (next !== sessionRef.current) setCurrentSession(next);
      });
    });
    validation.current = controller;
    refreshProfileRef.current = () => {
      controller.invalidate();
      return controller.refresh().catch(() => undefined);
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
    await logoutMobileSession(current);
    if (sessionRef.current?.sessionToken === current.sessionToken && sessionRef.current?.apiUrl === current.apiUrl) {
      setCurrentSession(null);
    }
  }, [setCurrentSession]);

  const updateProfile = useCallback(
    async (change: MobileProfileChange) => {
      const current = sessionRef.current;
      if (!current) throw new MobileSessionExpiredError();
      try {
        await updateMobileProfile(current, change, (updated) => {
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
    }),
    [sessionState, setCurrentSession, signOut, updateProfile, handleSessionError, refreshProfile],
  );

  return <MobileSessionContext.Provider value={value}>{children}</MobileSessionContext.Provider>;
}

export function useMobileSession(): MobileSessionContextValue {
  const value = useContext(MobileSessionContext);
  if (!value) throw new Error("useMobileSession must be used within MobileSessionProvider.");
  return value;
}
