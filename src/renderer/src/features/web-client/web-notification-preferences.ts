import { SERVER_NOTIFICATION_LEVELS, type ServerNotificationLevel } from "@openbot/contracts/ipc";
import { createSignal, onCleanup } from "solid-js";
import { z } from "zod";

type NotificationStorage = Pick<Storage, "getItem" | "setItem">;

const storedSchema = z.record(
  z.string(),
  z
    .object({
      level: z
        .string()
        .refine((value): value is ServerNotificationLevel =>
          SERVER_NOTIFICATION_LEVELS.some((level) => level === value),
        )
        .optional()
        .catch(undefined),
      mutedUntil: z.number().nullable().optional().catch(undefined),
    })
    .catch({}),
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

export function createWebServerNotifications(accountId: string, storage: NotificationStorage = window.localStorage) {
  const [stored, setStored] = createSignal<Stored>(read(accountId, storage));
  const [synced, setSynced] = createSignal<Readonly<Record<string, ServerNotificationLevel | null>>>({});
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
    } catch {}
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
      const muted = mutedUntil === null || (typeof mutedUntil === "number" && mutedUntil > Date.now());
      return {
        muted,
        mutedUntil: muted && typeof mutedUntil === "number" ? mutedUntil : null,
        level: synced()[hostId] ?? entry?.level ?? "all",
      };
    },
    setMuted(hostId: string, muted: boolean, durationMs?: number): void {
      update(hostId, { mutedUntil: muted ? (durationMs === undefined ? null : Date.now() + durationMs) : undefined });
    },
    setLevel(hostId: string, level: ServerNotificationLevel): void {
      update(hostId, { level });
    },
    setSyncedLevel(hostId: string, level: ServerNotificationLevel | null): void {
      if ((synced()[hostId] ?? null) === level) return;
      setSynced((current) => ({ ...current, [hostId]: level }));
    },
  };
}
