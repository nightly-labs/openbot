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
import { AppState, type AppStateStatus } from "react-native";

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
    void readMobileSession()
      .then(async (stored) => {
        if (!active) return;
        if (!stored) {
          setCurrentSession(null);
          return;
        }
        try {
          const validated = await validateMobileSession(stored);
          if (active) setCurrentSession(validated);
        } catch {
          if (active) setCurrentSession(stored);
        }
      })
      .catch(() => {
        if (active) setCurrentSession(null);
      });
    return () => {
      active = false;
    };
  }, [setCurrentSession]);

  useEffect(() => {
    let active = true;
    let checking = false;
    let refreshAgain = false;
    let appState: AppStateStatus = AppState.currentState;

    async function checkSession(): Promise<void> {
      const current = sessionRef.current;
      if (!active || appState !== "active" || !current) return;
      if (checking) {
        refreshAgain = true;
        return;
      }
      checking = true;
      try {
        await validateMobileSession(current, (validated) => {
          if (active) {
            const next = resolveSessionValidation(sessionRef.current, current, validated);
            if (next !== sessionRef.current) setCurrentSession(next);
          }
        });
      } catch {
        // A temporary network failure must not sign the user out locally.
      } finally {
        checking = false;
        if (refreshAgain) {
          refreshAgain = false;
          void checkSession();
        }
      }
    }

    const appStateSubscription = AppState.addEventListener("change", (nextAppState) => {
      const resumed = (appState === "background" || appState === "inactive") && nextAppState === "active";
      appState = nextAppState;
      if (resumed) {
        void retryMobileSessionRevocations();
        void checkSession();
      }
    });
    refreshProfileRef.current = checkSession;

    return () => {
      active = false;
      appStateSubscription.remove();
    };
  }, [setCurrentSession]);

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
