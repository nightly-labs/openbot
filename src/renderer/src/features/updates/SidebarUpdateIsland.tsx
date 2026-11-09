import { AccountUpdateIsland } from "@openbot/ui/features/account/AccountUpdateIsland";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { beam } from "../../theme-sweep";
import { useUpdates } from "./updates-context";

/** How long "Restarting" stays after the Restart ring has left the window, before the app quits. */
const RESTART_HOLD_MS = 600;

/**
 * The update island of the old account box, at the end of the sidebar. It shows only while an update
 * is available, downloads or waits for a restart, and keeps the failure of the last action until the
 * updater moves to another phase.
 */
export function SidebarUpdateIsland() {
  const { t, errorMessage } = useText();
  const updates = useUpdates();
  const [updateError, setUpdateError] = createSignal<string | null>(null);
  const [actionButton, setActionButton] = createSignal<HTMLButtonElement>();
  /** True when the current download already showed its ring, because Download was clicked or it started on its own. */
  let downloadRingShown = false;

  createEffect(
    () => updates.status().phase,
    (phase) => {
      setUpdateError(null);
      if (phase !== "available" && phase !== "downloading") downloadRingShown = false;
    },
  );

  // A download that starts without a click (automatic downloads) shows the same ring as Download.
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

  /**
   * The island slides in when the download opens it, so the ring waits until the island is still and
   * the button is where the ring ends.
   */
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
    // Restart waits until the ring that goes out from the button has left the window, holds
    // "Restarting" for a moment, then the app quits.
    const ring = showUpdateRing(button);
    if (ring) {
      await ring;
      await new Promise((resolve) => setTimeout(resolve, RESTART_HOLD_MS));
    }
    try {
      await updates.runAction();
    } catch (cause) {
      setUpdateError(errorMessage(cause, t("account.menu.updateFailed")));
    }
  }

  /**
   * The ring closes in on the button for Download, and goes out from it for Restart. Returns the end of
   * the Restart ring, so the restart waits for it. The ring only shows the click: when it fails, the
   * error is reported and the update action still runs.
   */
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
