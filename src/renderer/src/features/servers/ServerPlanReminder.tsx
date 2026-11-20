import type { ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import {
  type ServerPlanEnd,
  ServerPlanEndedDialog,
  serverPlanDaysLeft,
  serverPlanEnds,
} from "@openbot/ui/features/servers/ServerPlanEnd";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { z } from "zod";
import { actionToast } from "../../action-toast";

const REMINDER_STORAGE_KEY = "openbot:server-plan-reminders";
const REMINDER_INTERVAL_MS = 24 * 60 * 60_000;
const DAILY_START_REMINDER_DAYS = 3;
const sessionStartedAt = Date.now();

const reminderTimesSchema = z.record(z.string(), z.number());

type ReminderTimes = z.infer<typeof reminderTimesSchema>;

export async function openServerPlanCheckout(
  openCheckout: (serverId: string) => Promise<unknown>,
  serverId: string,
): Promise<void> {
  try {
    await openCheckout(serverId);
  } catch (error) {
    const text = currentText();
    actionToast.error(text.errorMessage(error, text.t("settings.hostedServers.checkoutFailed")), {
      report: { operation: "settings", source: "action", cause_code: classifyFailure(error) },
    });
  }
}

function readReminderTimes(): ReminderTimes {
  try {
    const parsed = reminderTimesSchema.safeParse(JSON.parse(window.localStorage.getItem(REMINDER_STORAGE_KEY) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writeReminderTime(serverId: string, shownAt: number): void {
  try {
    window.localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify({ ...readReminderTimes(), [serverId]: shownAt }));
  } catch {}
}

function reminderDue(end: ServerPlanEnd, times: ReminderTimes, now: number): boolean {
  const shownAt = times[end.server.id];
  if (shownAt === undefined || now - shownAt >= REMINDER_INTERVAL_MS) return true;
  return serverPlanDaysLeft(end.deleteAt, now) <= DAILY_START_REMINDER_DAYS && shownAt < sessionStartedAt;
}

export function ServerPlanReminder(props: {
  servers: readonly ServerSummary[];
  planDeletesAt: (serverId: string) => number | null;
  onRenew: (serverId: string) => Promise<void>;
}) {
  const [state, setState] = createStore<{ open: boolean; end: ServerPlanEnd | null }>({ open: false, end: null });

  createEffect(
    () => ({
      ends: serverPlanEnds(props.servers, props.planDeletesAt),
      open: state.open,
      shownId: state.end?.server.id,
    }),
    ({ ends, open, shownId }) => {
      if (open) {
        if (!ends.some((end) => end.server.id === shownId))
          setState((draft) => {
            draft.open = false;
          });
        return;
      }
      const now = Date.now();
      const times = readReminderTimes();
      const due = ends.find((end) => reminderDue(end, times, now));
      if (!due) return;
      writeReminderTime(due.server.id, now);
      setState((draft) => {
        draft.end = due;
        draft.open = true;
      });
    },
  );

  function close(): void {
    setState((draft) => {
      draft.open = false;
    });
  }

  return (
    <ServerPlanEndedDialog
      open={state.open}
      end={state.end}
      onLater={close}
      onRenew={async (serverId) => {
        await props.onRenew(serverId);
        close();
      }}
    />
  );
}
