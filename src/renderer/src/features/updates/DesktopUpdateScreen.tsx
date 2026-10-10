import { restartReasonKey } from "@openbot/ui/features/updates/restart-reasons";
import { type UpdateReadyPhase, UpdateReadyScreen } from "@openbot/ui/features/updates/UpdateReadyScreen";
import { useText } from "@openbot/ui/text";
import { createStore, Show } from "solid-js";
import { useUpdates } from "./updates-context";

export function DesktopUpdateScreen() {
  const updates = useUpdates();
  const { t, format, errorMessage } = useText();
  const [action, setAction] = createStore<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const phase = (): UpdateReadyPhase =>
    updates.screen.outcome ??
    (updates.status().phase === "installing"
      ? "installing"
      : updates.status().errorCode === "install_failed"
        ? "failed"
        : "ready");
  const waiting = () => {
    const current = updates.status();
    const restart = current.idleRestart ?? current.scheduledRestart;
    if (!restart || (current.idleRestart && current.idleRestart.error !== undefined)) return null;
    return `${t("update.idleRestart.updateTitle")}. ${t("update.idleRestart.description")} ${
      restart.waitingFor.length
        ? t("update.idleRestart.waitingFor", {
            reasons: format.list(restart.waitingFor.map((reason) => t(restartReasonKey(reason)))),
          })
        : ""
    }`;
  };
  async function run(operation: () => Promise<void>): Promise<void> {
    if (action.pending) return;
    setAction((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      await operation();
    } catch (error) {
      setAction((draft) => {
        draft.error = errorMessage(error, t("update.screen.actionFailed"));
      });
    } finally {
      setAction((draft) => {
        draft.pending = false;
      });
    }
  }
  return (
    <Show when={updates.screen.open}>
      <UpdateReadyScreen
        phase={phase()}
        currentVersion={updates.status().currentVersion}
        targetVersion={updates.screen.outcome ? updates.screen.target : updates.status().availableVersion}
        pending={action.pending}
        error={
          action.error ??
          (updates.status().idleRestart?.error
            ? errorMessage(updates.status().idleRestart?.error, t("update.screen.actionFailed"))
            : null)
        }
        waiting={waiting()}
        onRestart={() => void run(updates.runAction)}
        onRestartWhenIdle={() => void run(updates.restartWhenIdle)}
        onCancelRestart={() =>
          void run(async () => {
            if (updates.status().idleRestart) await updates.cancelIdleRestart();
            if (updates.status().scheduledRestart) await updates.cancelScheduledRestart();
          })
        }
        onDismiss={() => {
          setAction((draft) => {
            draft.error = null;
          });
          updates.dismissScreen();
        }}
      />
    </Show>
  );
}
