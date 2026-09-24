import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("ComposerErrorBanner", () => {
  it("announces the chat-scoped error and offers dismissal", async () => {
    const onDismiss = vi.fn();
    render(() => (
      <ComposerErrorBanner
        message="This queued message is no longer available."
        conversationKey="agent-a"
        onDismiss={onDismiss}
      />
    ));

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("This queued message is no longer available.");
    expect(banner).toHaveAttribute("data-conversation-key", "agent-a");

    const dismiss = screen.getByRole("button", { name: "Dismiss error" });
    await fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses via keyboard without stealing focus on appear", async () => {
    const onDismiss = vi.fn();
    render(() => (
      <ComposerErrorBanner message="Could not copy the message." conversationKey="agent-b" onDismiss={onDismiss} />
    ));

    // Appearing must not move focus: the dismiss button exists but is not focused.
    const dismiss = screen.getByRole("button", { name: "Dismiss error" });
    expect(dismiss).not.toHaveFocus();

    dismiss.focus();
    expect(dismiss).toHaveFocus();

    await fireEvent.keyDown(screen.getByRole("alert"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
