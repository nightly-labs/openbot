import { AccountUpdateIsland } from "@openbot/ui/features/account/AccountUpdateIsland";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { beam } from "../../theme-sweep";
import { useUpdates } from "./updates-context";

/** How long Restart waits, so the ring that goes out from the button is seen before the app quits. */
const RESTART_DELAY_MS = 500;

/**
 * The update island of the old account box, at the end of the sidebar. It shows only while an update
 * is available, downloads or waits for a restart, and keeps the failure of the last action until the
 * updater moves to another phase.
 */
export function SidebarUpdateIsland() {
  const { t, errorMessage } = useText();
  const updates = useUpdates();
  const [updateError, setUpdateError] = createSignal<string | null>(null);

  createEffect(
    () => updates.status().phase,
    () => {
      setUpdateError(null);
    },
  );

  async function runUpdateAction(button: HTMLButtonElement): Promise<void> {
    setUpdateError(null);
    if (showUpdateRing(button)) await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
    try {
      await updates.runAction();
    } catch (cause) {
      setUpdateError(errorMessage(cause, t("account.menu.updateFailed")));
    }
  }

  /**
   * The ring closes in on the button for Download, and goes out from it for Restart. True when the
   * Restart ring shows, so the restart waits for it. The ring only shows the click: when it fails,
   * the error is reported and the update action still runs.
   */
  function showUpdateRing(button: HTMLButtonElement): boolean {
    const current = updates.status();
    if (current.managedByHost === true) return false;
    try {
      if (current.phase === "available") beam(button, "in");
      else if (current.phase === "ready") return beam(button, "out");
    } catch (cause) {
      reportError(cause);
    }
    return false;
  }

  return (
    <div class="sidebar-update-island">
      <AccountUpdateIsland
        updateStatus={updates.status()}
        errorMessage={updateError()}
        onUpdateAction={runUpdateAction}
      />
    </div>
  );
}
