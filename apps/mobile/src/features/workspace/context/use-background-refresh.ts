import type { RemoteRecoveryStatus } from "@openbot/team-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { backgroundRefreshNative } from "@/features/background-refresh/background-refresh-native";
import { supportLog } from "@/features/support/model/support-log";

const REFRESH_DEADLINE_MS = 25_000;

interface RefreshWindow {
  readonly pending: Set<string>;
  readonly attempted: Set<string>;
  readonly loaded: Set<string>;
  end(): void;
}

interface BackgroundRefreshInput {
  foreground: boolean;
  serverIds(): readonly string[];
  loaded(): Promise<void>;
  saved(): Promise<void>;
}

export interface BackgroundRefresh {
  refreshing: boolean;
  connectionStatus(hostId: string, status: RemoteRecoveryStatus): void;
}

function settlesServer(refresh: RefreshWindow, hostId: string, status: RemoteRecoveryStatus): boolean {
  if (status.phase === "online" || status.phase === "suspended") return true;
  return status.phase === "cooldown" && refresh.attempted.has(hostId);
}

type SkipReason = "ended by the system" | "app in foreground" | "a refresh is running" | "no servers";

function skipReason(ended: AbortSignal, foreground: boolean, running: boolean, servers: number): SkipReason | null {
  if (ended.aborted) return "ended by the system";
  if (foreground) return "app in foreground";
  if (running) return "a refresh is running";
  if (servers === 0) return "no servers";
  return null;
}

export function useBackgroundRefresh(input: BackgroundRefreshInput): BackgroundRefresh {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [state, setState] = useState({ refreshing: false });
  const openWindow = useRef<RefreshWindow | null>(null);
  const committed = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (state.refreshing) return;
    committed.current?.();
    committed.current = null;
  }, [state]);

  useEffect(() => {
    if (input.foreground) openWindow.current?.end();
  }, [input.foreground]);

  const connectionStatus = useCallback((hostId: string, status: RemoteRecoveryStatus) => {
    const refresh = openWindow.current;
    if (!refresh?.pending.has(hostId)) return;
    if (status.phase === "connecting") refresh.attempted.add(hostId);
    if (!settlesServer(refresh, hostId, status)) return;
    refresh.pending.delete(hostId);
    if (status.phase === "online") refresh.loaded.add(hostId);
    if (refresh.pending.size === 0) void inputRef.current.loaded().then(refresh.end);
  }, []);

  useEffect(() => {
    const native = backgroundRefreshNative;
    if (!native) return;
    let disposed = false;
    const disable = native.enable(async (ended) => {
      const serverIds = inputRef.current.serverIds();
      const skipped = skipReason(ended, inputRef.current.foreground, openWindow.current !== null, serverIds.length);
      if (skipped) {
        supportLog.add("info", "app", `Background refresh skipped: ${skipped}`);
        return true;
      }
      const started = Date.now();
      supportLog.add("info", "app", `Background refresh started, ${serverIds.length} servers`);
      const finished = await new Promise<RefreshWindow>((resolve) => {
        const opened: RefreshWindow = {
          pending: new Set(serverIds),
          attempted: new Set(),
          loaded: new Set(),
          end: () => {
            if (openWindow.current !== opened) return;
            openWindow.current = null;
            clearTimeout(deadline);
            ended.removeEventListener("abort", opened.end);
            resolve(opened);
          },
        };
        const deadline = setTimeout(opened.end, REFRESH_DEADLINE_MS);
        ended.addEventListener("abort", opened.end);
        openWindow.current = opened;
        setState({ refreshing: true });
      });
      if (!disposed)
        await new Promise<void>((resolve) => {
          committed.current = resolve;
          setState({ refreshing: false });
        });
      await inputRef.current.saved();
      supportLog.add(
        finished.loaded.size === serverIds.length ? "info" : "warn",
        "app",
        `Background refresh loaded ${finished.loaded.size} of ${serverIds.length} servers in ${Date.now() - started} ms${ended.aborted ? ", ended by the system" : ""}`,
      );
      return finished.loaded.size === serverIds.length;
    });
    return () => {
      disposed = true;
      disable();
      openWindow.current?.end();
      committed.current?.();
      committed.current = null;
    };
  }, []);

  return { refreshing: state.refreshing, connectionStatus };
}
