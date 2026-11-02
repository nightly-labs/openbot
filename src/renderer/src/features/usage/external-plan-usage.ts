import { usageRemainingPercent, usageTone } from "@openbot/team-client/plan-limits";
import {
  type AccountUsageProviderRow,
  type AccountUsageWindowRow,
  formatUsageReset,
  usageWindowLabel,
} from "@openbot/ui/features/account/account-usage-view";
import { type Accessor, createMemo, createSignal, flush, onSettled } from "solid-js";

// Plan limits of providers OpenBot does not read itself (a z.ai GLM Coding Plan, a MiniMax coding
// plan). `scripts/usage-feed.cjs` of this checkout polls their usage endpoints and serves the
// readings on a loopback WebSocket (`ws://127.0.0.1:47831`); the renderer CSP allows
// `ws://127.0.0.1:*`, not plain http. With no feed running there are simply no extra rings.
// Payload, one JSON text per message:
// { rows: [{ id, name, ok: true, windows: [{ durationMins, usedPercent, resetsAt }] }] }.

const FEED_URL = "ws://127.0.0.1:47831";
const RECONNECT_MS = 30_000;

interface FeedWindow {
  durationMins: number;
  usedPercent: number;
  /** Unix seconds. */
  resetsAt: number | null;
}

interface FeedRow {
  id: string;
  name: string;
  ok: true;
  windows: FeedWindow[];
}

function isFeedWindow(value: unknown): value is FeedWindow {
  return (
    typeof value === "object" &&
    value !== null &&
    "durationMins" in value &&
    typeof value.durationMins === "number" &&
    "usedPercent" in value &&
    typeof value.usedPercent === "number" &&
    "resetsAt" in value &&
    (value.resetsAt === null || typeof value.resetsAt === "number")
  );
}

function isFeedRow(value: unknown): value is FeedRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "ok" in value &&
    value.ok === true &&
    "windows" in value &&
    Array.isArray(value.windows) &&
    value.windows.every(isFeedWindow)
  );
}

function parseFeed(data: unknown): FeedRow[] {
  if (typeof data !== "string") return [];
  try {
    const rows = JSON.parse(data)?.rows;
    return Array.isArray(rows) ? rows.filter(isFeedRow) : [];
  } catch {
    return [];
  }
}

function windowRow(window: FeedWindow): AccountUsageWindowRow {
  const remainingPercent = usageRemainingPercent(window.usedPercent);
  return {
    label: usageWindowLabel(window.durationMins),
    remainingPercent,
    tone: usageTone(remainingPercent),
    resetsAt: window.resetsAt,
    resetsAtLabel: formatUsageReset(window.resetsAt),
  };
}

/** Rail rows for the feed, shaped like the provider rows so the rail draws the same rings and hover card. */
function feedRowToUsageRow(row: FeedRow): AccountUsageProviderRow {
  // The shortest window first, as the rail expects.
  const windows = [...row.windows].sort((a, b) => a.durationMins - b.durationMins).map(windowRow);
  const remainingPercent = windows.reduce<number | null>(
    (lowest, window) => (lowest === null || window.remainingPercent < lowest ? window.remainingPercent : lowest),
    null,
  );
  return {
    provider: "opencode",
    accountId: row.id,
    name: row.name,
    remainingPercent,
    tone: usageTone(remainingPercent),
    windows,
    ringWindows: windows,
    reportsUsage: true,
    sharedQuotaWith: null,
  };
}

/** The extra rings: one per feed source with a reading. Empty while the feed is not running. */
export function useExternalPlanUsageRows(): Accessor<AccountUsageProviderRow[]> {
  const [rows, setRows] = createSignal<FeedRow[]>([]);
  onSettled(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(FEED_URL);
      } catch {
        retry = setTimeout(connect, RECONNECT_MS);
        return;
      }
      socket.onmessage = (event) => flush(() => setRows(parseFeed(event.data)));
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, RECONNECT_MS);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  });
  return createMemo(() => rows().map(feedRowToUsageRow));
}
