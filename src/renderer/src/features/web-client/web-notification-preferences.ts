import { SERVER_NOTIFICATION_LEVELS, type ServerNotificationLevel } from "@openbot/contracts/ipc";
import { createSignal, onCleanup } from "solid-js";
import { z } from "zod";

type NotificationStorage = Pick<Storage, "getItem" | "setItem">;

/** `mutedUntil` null is a mute without an end. An absent `mutedUntil` is no mute. */
const storedSchema = z.record(
  z.string(),
  z.object({
    level: z
      .string()
      .refine((value): value is ServerNotificationLevel => SERVER_NOTIFICATION_LEVELS.some((level) => level === value))
      .optional(),
    mutedUntil: z.number().nullable().optional(),
  }),
);
type Stored = z.infer<typeof storedSchema>;

export interface WebServerNotificationState {
  muted: boolean;
  mutedUntil: number | null;
  level: ServerNotificationLevel;
}

function storageKey(accountId: string): string {
  return `openbot.web.server-notifications:${accountId}`;
}

function read(accountId: string, storage: NotificationStorage): Stored {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(storage.getItem(storageKey(accountId)) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Mute and notification level of each host, as the desktop keeps them for each server. The web client
 * has no main process, so this browser keeps them for the account. Other tabs follow through `storage`.
 */
export function createWebServerNotifications(accountId: string, storage: NotificationStorage = window.localStorage) {
  const [stored, setStored] = createSignal<Stored>(read(accountId, storage));
  // A timed mute ends with no stored change, so the rail reads the state again at its end.
  const [tick, setTick] = createSignal(0);
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function scheduleExpiry(value: Stored): void {
    clearTimeout(expiry);
    const now = Date.now();
    const next = Math.min(
      ...Object.values(value).map((entry) =>
        typeof entry.mutedUntil === "number" && entry.mutedUntil > now ? entry.mutedUntil : Number.POSITIVE_INFINITY,
      ),
    );
    if (!Number.isFinite(next)) return;
    expiry = setTimeout(() => {
      setTick((value) => value + 1);
      scheduleExpiry(stored());
    }, next - now);
  }
  function write(next: Stored): void {
    setStored(next);
    scheduleExpiry(next);
    try {
      storage.setItem(storageKey(accountId), JSON.stringify(next));
    } catch {
      // The choice holds for this tab when browser storage is unavailable.
    }
  }
  function update(hostId: string, change: Stored[string]): void {
    const current = stored();
    write({ ...current, [hostId]: { ...current[hostId], ...change } });
  }
  function listen(event: StorageEvent): void {
    if (event.key !== storageKey(accountId)) return;
    const next = read(accountId, storage);
    setStored(next);
    scheduleExpiry(next);
  }
  window.addEventListener("storage", listen);
  scheduleExpiry(stored());
  onCleanup(() => {
    clearTimeout(expiry);
    window.removeEventListener("storage", listen);
  });

  return {
    state(hostId: string): WebServerNotificationState {
      tick();
      const entry = stored()[hostId];
      const mutedUntil = entry?.mutedUntil;
      // An expired timed mute is no mute, as on desktop.
      const muted = mutedUntil === null || (typeof mutedUntil === "number" && mutedUntil > Date.now());
      return {
        muted,
        mutedUntil: muted && typeof mutedUntil === "number" ? mutedUntil : null,
        level: entry?.level ?? "all",
      };
    },
    setMuted(hostId: string, muted: boolean, durationMs?: number): void {
      update(hostId, { mutedUntil: muted ? (durationMs === undefined ? null : Date.now() + durationMs) : undefined });
    },
    setLevel(hostId: string, level: ServerNotificationLevel): void {
      update(hostId, { level });
    },
  };
}

export type WebServerNotifications = ReturnType<typeof createWebServerNotifications>;
