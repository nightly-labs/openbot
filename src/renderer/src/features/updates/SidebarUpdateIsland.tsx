import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { AccountUpdateIsland } from "@openbot/ui/features/account/AccountUpdateIsland";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { actionToast } from "../../action-toast";
import { beam } from "../../theme-sweep";
import { useUpdates } from "./updates-context";

const RESTART_HOLD_MS = 600;

const UPDATE_FAILED_TOAST_ID = "app-update-action-failed";

export function SidebarUpdateIsland() {
  const { t, errorMessage } = useText();
  const updates = useUpdates();
  const [updateError, setUpdateError] = createSignal<string | null>(null);
  const [actionButton, setActionButton] = createSignal<HTMLButtonElement>();
  let downloadRingShown = false;

  createEffect(
    () => updates.status().phase,
    (phase) => {
      setUpdateError(null);
      toast.dismiss(UPDATE_FAILED_TOAST_ID);
      if (phase !== "available" && phase !== "downloading") downloadRingShown = false;
    },
  );

  createEffect(
    () => {
      const current = updates.status();
      return current.phase === "downloading" && current.managedByHost !== true ? actionButton() : undefined;
    },
    (button) => {
      if (!button || downloadRingShown) return;
      downloadRingShown = true;
      void showDownloadStartRing(button);
    },
  );

  async function showDownloadStartRing(button: HTMLButtonElement): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const island = button.closest(".account-update-island");
    await Promise.allSettled(island?.getAnimations().map((animation) => animation.finished) ?? []);
    if (!button.isConnected || updates.status().phase !== "downloading") return;
    try {
      void beam(button, "in");
    } catch (cause) {
      reportError(cause);
    }
  }

  async function runUpdateAction(button: HTMLButtonElement): Promise<void> {
    setUpdateError(null);
    const ring = showUpdateRing(button);
    if (ring) {
      await ring;
      await new Promise((resolve) => setTimeout(resolve, RESTART_HOLD_MS));
    }
    try {
      await updates.runAction();
    } catch (cause) {
      const title = t("account.menu.updateFailed");
      const reason = errorMessage(cause, title);
      setUpdateError(title);
      if (reason === title) return;
      actionToast.error(title, {
        id: UPDATE_FAILED_TOAST_ID,
        error: cause,
        fallback: title,
        duration: Number.POSITIVE_INFINITY,
        report: { operation: "update", source: "action", cause_code: classifyFailure(cause) },
      });
    }
  }

  function showUpdateRing(button: HTMLButtonElement): Promise<void> | null {
    const current = updates.status();
    if (current.managedByHost === true) return null;
    try {
      if (current.phase === "available") {
        downloadRingShown = true;
        void beam(button, "in");
      } else if (current.phase === "ready") return beam(button, "out");
    } catch (cause) {
      reportError(cause);
    }
    return null;
  }

  return (
    <div class="sidebar-update-island">
      <AccountUpdateIsland
        updateStatus={updates.status()}
        errorMessage={updateError()}
        onUpdateAction={runUpdateAction}
        actionRef={setActionButton}
      />
    </div>
  );
}
