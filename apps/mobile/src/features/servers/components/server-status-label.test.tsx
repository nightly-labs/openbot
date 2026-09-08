import { screen } from "@testing-library/dom";
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobileServer, MobileServerState } from "../../workspace/model/workspace-types";
import { ServerStatusLabel } from "./server-status-label";

// HeroUI's native text boundary is represented by an accessible text status in jsdom.
vi.mock("heroui-native", () => ({
  Typography: {
    Paragraph: ({
      children,
      accessibilityLabel,
      accessibilityLiveRegion,
    }: PropsWithChildren<{
      accessibilityLabel: string;
      accessibilityLiveRegion: "polite";
    }>) => (
      <span role="status" aria-label={accessibilityLabel} aria-live={accessibilityLiveRegion}>
        {children}
      </span>
    ),
  },
}));

const server: MobileServer = {
  id: "desktop",
  name: "My desktop",
  kind: "local",
  state: "unknown",
  initialConnectionPending: true,
  connectionMessage: null,
  address: null,
  accent: "",
  publicKey: "key",
  membershipId: "member",
  role: "owner",
};
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
});

describe("server status indicator", () => {
  it("updates visible and accessible status through connection loss and recovery", async () => {
    const states: [MobileServerState, boolean, string][] = [
      ["unknown", true, "Not connected"],
      ["connecting", true, "Connecting…"],
      ["online", false, "Online"],
      ["offline", false, "Offline"],
      ["connecting", false, "Offline"],
      ["error", false, "Connection error"],
      ["connecting", false, "Offline"],
      ["online", false, "Online"],
      ["unknown", true, "Not connected"],
    ];
    for (const [state, initialConnectionPending, label] of states) {
      await act(() =>
        root.render(<ServerStatusLabel server={{ ...server, state, initialConnectionPending }} prefix="Local · " />),
      );
      expect(screen.getByRole("status", { name: `My desktop: ${label}` }).textContent).toBe(`Local · ${label}`);
    }
  });
});
