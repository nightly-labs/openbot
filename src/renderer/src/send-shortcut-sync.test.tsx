import { render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { setSendShortcutMode, useSendShortcutMode } from "./send-shortcut-preference";

const STORAGE_KEY = "openbot:send-shortcut-mode";

/** A reactive reader like the settings display and the composers: one shared signal. */
function ModeProbe() {
  const mode = useSendShortcutMode();
  return <output aria-label="Send mode">{mode() === "mod-enter" ? "Modifier to send" : "Enter to send"}</output>;
}

describe("send shortcut cross-window sync", () => {
  it("shows another window's change and reselects through the same signal", async () => {
    setSendShortcutMode("enter");
    render(() => <ModeProbe />);
    expect(screen.getByRole("status", { name: "Send mode" })).toHaveTextContent("Enter to send");

    // Another window writes directly, the way a second window's setter does. The storage
    // event is the only notice this document gets.
    window.localStorage.setItem(STORAGE_KEY, "mod-enter");
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Send mode" })).toHaveTextContent("Modifier to send"),
    );

    // Reselecting through the same setter the settings UI uses writes storage and updates
    // the display, so the old displayed choice never goes stale.
    setSendShortcutMode("enter");
    await waitFor(() => expect(screen.getByRole("status", { name: "Send mode" })).toHaveTextContent("Enter to send"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("enter");
  });
});
