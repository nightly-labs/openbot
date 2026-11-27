import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type Href, router, unstable_enablePerformanceIntegration, unstable_PerformanceObserver } from "expo-router";
import { Platform } from "react-native";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";

const PROBE_GLOBAL = "__openbotScreenOpen";
const PAGE_FOCUSED = "expo-router:page-focused";
const PAINT_FRAMES = 2;
const SETTLE_FRAMES = 30;
const HOME_PATHNAME = "/connected";
const WAIT_MS = 15_000;

type WorkspaceReader = () => MobileWorkspaceContextValue;

interface FocusWait {
  pathname: string;
  after: number;
  resolve: (focusedAt: number) => void;
}

function focusedPathnameOf(entry: PerformanceEntry): string | null {
  if (!("detail" in entry)) return null;
  const { detail } = entry;
  return isDynamicRecord(detail) && isString(detail.pathname) ? detail.pathname : null;
}

function afterFrames(count: number): Promise<number> {
  return new Promise((resolve) => {
    const step = (left: number) =>
      requestAnimationFrame(() => (left <= 1 ? resolve(performance.now()) : step(left - 1)));
    step(count);
  });
}

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} took longer than ${WAIT_MS} ms.`)), WAIT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createScreenOpenProbe() {
  unstable_enablePerformanceIntegration();
  let workspace: WorkspaceReader | null = null;
  let focusedPathname: string | null = null;
  let focusWait: FocusWait | null = null;

  const observer = new unstable_PerformanceObserver((list) => {
    for (const entry of list.getEntriesByName(PAGE_FOCUSED)) {
      const pathname = focusedPathnameOf(entry);
      if (pathname === null) continue;
      focusedPathname = pathname;
      const wait = focusWait;
      if (!wait || entry.startTime < wait.after || pathname !== wait.pathname) continue;
      focusWait = null;
      wait.resolve(entry.startTime);
    }
  });
  observer.observe({ type: "mark", buffered: true });

  const focusOf = (pathname: string, after: number) =>
    withDeadline(
      new Promise<number>((resolve) => {
        focusWait = { pathname, after, resolve };
      }),
      `Focus of ${pathname}`,
    );

  const probe = {
    info: () =>
      JSON.stringify({
        dev: __DEV__,
        platform: Platform.OS,
        ready: Boolean(workspace),
        focused: focusedPathname,
      }),
    targets: () => {
      const state = workspace?.();
      if (!state) return JSON.stringify(null);
      const agent = state.agents.find((item) => item.serverId === state.activeServer.id) ?? state.agents[0];
      return JSON.stringify({
        agentId: agent?.id ?? null,
        agentServerId: agent?.serverId ?? null,
        serverId: state.activeServer.id || null,
      });
    },
    open: async (href: Href, pathname: string) => {
      const startedAt = performance.now();
      const focused = focusOf(pathname, startedAt);
      router.push(href);
      const focusedAt = await focused;
      const paintedAt = await afterFrames(PAINT_FRAMES);
      return JSON.stringify({ focusMs: focusedAt - startedAt, paintMs: paintedAt - startedAt });
    },
    home: async () => {
      if (router.canDismiss()) {
        const focused = focusOf(HOME_PATHNAME, performance.now());
        router.dismissAll();
        await focused;
      }
      await afterFrames(SETTLE_FRAMES);
      return HOME_PATHNAME;
    },
  };
  Object.assign(globalThis, { [PROBE_GLOBAL]: probe });

  return {
    readWorkspace: (reader: WorkspaceReader) => {
      workspace = reader;
      return () => {
        if (workspace === reader) workspace = null;
      };
    },
  };
}

const screenMetricsEnabled = __DEV__ || process.env.EXPO_PUBLIC_OPENBOT_SCREEN_METRICS === "1";

export const screenOpenProbe = screenMetricsEnabled ? createScreenOpenProbe() : null;
